// Weekly prod -> test database copy, for debugging the test site against
// real data. Runs entirely on Render:
//
//  OFFICIAL (hit-confirmed-prod): startSnapshotServer() listens on a SEPARATE
//    port (DB_SNAPSHOT_PORT) that Render only exposes on its private network -
//    the public URL only ever reaches the main PORT. Every request must also
//    carry the shared DB_SNAPSHOT_SECRET and come from a private address. It
//    serves a consistent online backup (better-sqlite3 backup API, safe while
//    the app keeps writing) and never modifies anything.
//
//  TEST (hit-confirmed-test): scheduleWeeklyProdSnapshot() pulls that copy
//    every Monday at 4 AM Toronto time, checks integrity, scrubs it (below),
//    writes it to `<dbPath>.seed` and restarts the process; db/db.js's boot
//    seed hook swaps it in before the database is opened (keeping the old
//    copy as `<dbPath>.prev`). Any failure leaves the current test DB as-is.
//
// Scrubbing (the test site can send password-reset emails): every user's email
// becomes user-<id>@hitconfirmed.test except the addresses in
// DB_SNAPSHOT_KEEP_EMAILS (the owner's own account, to test resets). User ids
// are identical in both databases, so the real address is one lookup on prod
// away (SELECT email FROM users WHERE id = <id>). Pending reset tokens are
// dropped.
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const SNAPSHOT_PATH = '/snapshot';
const TORONTO = 'America/Toronto';

// --- prod side --------------------------------------------------------------

function isPrivateAddress(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '');
  return a === '::1' || /^127\./.test(a) || /^10\./.test(a) || /^192\.168\./.test(a)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^f[cd][0-9a-f]{2}:/i.test(a);
}

function secretMatches(header, secret) {
  const m = /^Bearer (.+)$/.exec(String(header || ''));
  if (!m || !secret) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function startSnapshotServer({ db, port, secret, tmpDir = '/tmp' }) {
  if (!secret || secret.length < 32) throw new Error('DB_SNAPSHOT_SECRET must be set (32+ chars) to serve snapshots');
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== SNAPSHOT_PATH) { res.statusCode = 404; return res.end(); }
    if (!isPrivateAddress(req.socket.remoteAddress) || !secretMatches(req.headers.authorization, secret)) {
      console.warn(`[db-snapshot] refused snapshot request from ${req.socket.remoteAddress}`);
      res.statusCode = 403;
      return res.end();
    }
    const tmp = `${tmpDir}/snapshot-${process.pid}-${Date.now()}.db`;
    try {
      await db.backup(tmp);
      const size = fs.statSync(tmp).size;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size });
      const stream = fs.createReadStream(tmp);
      stream.pipe(res);
      stream.on('close', () => fs.unlink(tmp, () => {}));
      console.log(`[db-snapshot] served a ${size}-byte snapshot to ${req.socket.remoteAddress}`);
    } catch (err) {
      fs.unlink(tmp, () => {});
      console.error(`[db-snapshot] snapshot failed: ${err.message}`);
      res.statusCode = 500;
      res.end();
    }
  });
  server.listen(port, () => console.log(`[db-snapshot] snapshot server on private port ${port}`));
  return server;
}

// --- test side --------------------------------------------------------------

// Check integrity and scrub personal contact data in a downloaded copy.
function scrubSnapshot(file, keepEmails = []) {
  const keep = keepEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const db = new Database(file);
  try {
    const ok = db.pragma('integrity_check', { simple: true });
    if (ok !== 'ok') throw new Error(`integrity_check failed: ${ok}`);
    const placeholders = keep.map(() => '?').join(',');
    const users = db.prepare(
      `UPDATE users SET email = 'user-' || id || '@hitconfirmed.test'
       ${keep.length ? `WHERE lower(email) NOT IN (${placeholders})` : ''}`
    ).run(...keep).changes;
    const hasTokens = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_tokens'`).get();
    if (hasTokens) db.prepare('DELETE FROM password_reset_tokens').run();
    // Fold the WAL into the main file so the single .db file is complete.
    db.pragma('wal_checkpoint(TRUNCATE)');
    return { scrubbedUsers: users };
  } finally {
    db.close();
  }
}

async function pullSnapshot({ url, secret, dbPath, keepEmails = [], fetchImpl = fetch }) {
  const incoming = `${dbPath}.incoming`;
  try {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${secret}` } });
    if (!res.ok) throw new Error(`snapshot request failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 4096 || buf.subarray(0, 15).toString() !== 'SQLite format 3') {
      throw new Error(`response is not a SQLite database (${buf.length} bytes)`);
    }
    fs.writeFileSync(incoming, buf);
    for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(`${incoming}${ext}`); } catch { /* none */ } }
    const { scrubbedUsers } = scrubSnapshot(incoming, keepEmails);
    for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(`${incoming}${ext}`); } catch { /* none */ } }
    fs.renameSync(incoming, `${dbPath}.seed`);
    return { bytes: buf.length, scrubbedUsers };
  } catch (err) {
    for (const f of [incoming, `${incoming}-wal`, `${incoming}-shm`]) { try { fs.unlinkSync(f); } catch { /* none */ } }
    throw err;
  }
}

// Monday 04:xx in Toronto, and no successful run in the last 6 days.
function isSnapshotDue(now = new Date(), lastRunMs = null) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TORONTO, weekday: 'short', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday !== 'Mon' || Number(parts.hour) !== 4) return false;
  return lastRunMs == null || now.getTime() - lastRunMs > 6 * 24 * 60 * 60 * 1000;
}

// The last-run marker lives in a plain file next to the DB, NOT in app_state:
// app_state is inside the database this job replaces, so it would be lost.
function scheduleWeeklyProdSnapshot({ url, secret, dbPath, keepEmails, exit = (code) => process.exit(code) }) {
  const marker = `${dbPath}.last-prod-snapshot`;
  const readLast = () => { try { return Date.parse(fs.readFileSync(marker, 'utf8').trim()); } catch { return null; } };
  let running = false;
  const tick = async () => {
    if (running || !isSnapshotDue(new Date(), readLast())) return;
    running = true;
    try {
      const r = await pullSnapshot({ url, secret, dbPath, keepEmails });
      fs.writeFileSync(marker, new Date().toISOString());
      console.log(`[db-snapshot] pulled prod snapshot (${r.bytes} bytes, ${r.scrubbedUsers} emails scrubbed); restarting to swap it in`);
      setTimeout(() => exit(1), 2000); // Render restarts the service; db/db.js swaps the .seed in on boot
    } catch (err) {
      console.error(`[db-snapshot] weekly prod snapshot failed, keeping current test DB: ${err.message}`);
    } finally {
      running = false;
    }
  };
  setInterval(tick, 10 * 60 * 1000);
  setTimeout(tick, 60 * 1000);
}

module.exports = {
  startSnapshotServer, scrubSnapshot, pullSnapshot, isSnapshotDue, scheduleWeeklyProdSnapshot,
  isPrivateAddress, secretMatches, SNAPSHOT_PATH,
};
