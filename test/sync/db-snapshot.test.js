const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const snap = require('../../scripts/db-snapshot');

// Weekly prod -> test DB copy (scripts/db-snapshot.js). The safety-critical
// parts: only private callers with the shared secret get a snapshot, real
// users' emails never reach the test site, and the swap keeps a rollback copy.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-snap-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const SECRET = 'x'.repeat(48);

function makeDb(file) {
  const db = new Database(file);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT UNIQUE NOT NULL, password TEXT, balance_cents INTEGER);
    CREATE TABLE password_reset_tokens (id INTEGER PRIMARY KEY, user_id INTEGER, token_hash TEXT);
    INSERT INTO users VALUES (1, 'owner', 'Owner@Example.com', 'h1', 100), (2, 'alice', 'alice@gmail.com', 'h2', 200), (3, 'bob', 'bob@yahoo.com', 'h3', 300);
    INSERT INTO password_reset_tokens VALUES (1, 2, 'abc');`);
  return db;
}

test('runs only Monday 4 AM Toronto time, once a week, across DST', () => {
  assert.equal(snap.isSnapshotDue(new Date('2026-11-16T09:30:00Z')), true); // Mon 4:30 EST
  assert.equal(snap.isSnapshotDue(new Date('2026-07-13T08:30:00Z')), true); // Mon 4:30 EDT
  assert.equal(snap.isSnapshotDue(new Date('2026-11-16T08:59:00Z')), false); // Mon 3:59 EST
  assert.equal(snap.isSnapshotDue(new Date('2026-11-16T10:00:00Z')), false); // Mon 5:00 EST
  assert.equal(snap.isSnapshotDue(new Date('2026-11-17T09:30:00Z')), false); // Tuesday
  const now = new Date('2026-11-16T09:40:00Z');
  assert.equal(snap.isSnapshotDue(now, now.getTime() - 10 * 60 * 1000), false); // already ran this morning
  assert.equal(snap.isSnapshotDue(now, now.getTime() - 7 * 24 * 3600 * 1000), true); // last week's run
});

test('only private-network callers with the exact secret are allowed', () => {
  for (const a of ['10.1.2.3', '::ffff:10.0.0.9', '172.20.1.1', '192.168.1.5', '127.0.0.1', '::1']) assert.ok(snap.isPrivateAddress(a), a);
  for (const a of ['8.8.8.8', '::ffff:34.12.0.1', '172.32.0.1', '2001:db8::1']) assert.ok(!snap.isPrivateAddress(a), a);
  assert.ok(snap.secretMatches(`Bearer ${SECRET}`, SECRET));
  assert.ok(!snap.secretMatches(`Bearer ${SECRET}x`, SECRET));
  assert.ok(!snap.secretMatches(SECRET, SECRET));
  assert.ok(!snap.secretMatches('Bearer ', ''));
  assert.throws(() => snap.startSnapshotServer({ db: null, port: 0, secret: 'short' }), /DB_SNAPSHOT_SECRET/);
});

test('scrub replaces every email except the kept ones and drops reset tokens', () => {
  const file = path.join(dir, 'scrub.db');
  makeDb(file).close();
  const r = snap.scrubSnapshot(file, ['owner@example.com ', '']);
  assert.equal(r.scrubbedUsers, 2);
  const db = new Database(file, { readonly: true });
  assert.deepEqual(db.prepare('SELECT id, email, balance_cents FROM users ORDER BY id').all(), [
    { id: 1, email: 'Owner@Example.com', balance_cents: 100 }, // kept (case-insensitive)
    { id: 2, email: 'user-2@hitconfirmed.test', balance_cents: 200 }, // id maps back to prod
    { id: 3, email: 'user-3@hitconfirmed.test', balance_cents: 300 },
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM password_reset_tokens').get().c, 0);
  db.close();
});

test('end to end: prod serves a live snapshot, test pulls, scrubs and stages it as .seed', async () => {
  const prodFile = path.join(dir, 'prod.db');
  const prod = makeDb(prodFile);
  prod.pragma('journal_mode = WAL');
  const server = snap.startSnapshotServer({ db: prod, port: 0, secret: SECRET, tmpDir: dir });
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/snapshot`;
  const testDbPath = path.join(dir, 'test.db');
  try {
    await assert.rejects(snap.pullSnapshot({ url, secret: 'y'.repeat(48), dbPath: testDbPath }), /HTTP 403/);
    assert.ok(!fs.existsSync(`${testDbPath}.seed`), 'a refused pull must not stage anything');

    const r = await snap.pullSnapshot({ url, secret: SECRET, dbPath: testDbPath, keepEmails: ['owner@example.com'] });
    assert.equal(r.scrubbedUsers, 2);
    const seed = new Database(`${testDbPath}.seed`, { readonly: true });
    assert.deepEqual(seed.prepare('SELECT email FROM users ORDER BY id').all().map((u) => u.email),
      ['Owner@Example.com', 'user-2@hitconfirmed.test', 'user-3@hitconfirmed.test']);
    seed.close();
    // The official database itself is never modified.
    assert.equal(prod.prepare(`SELECT email FROM users WHERE id = 2`).get().email, 'alice@gmail.com');
    assert.equal(prod.prepare('SELECT COUNT(*) c FROM password_reset_tokens').get().c, 1);
  } finally {
    await new Promise((r) => server.close(r));
    prod.close();
  }
});

test('boot swap keeps the replaced database as .prev for rollback', () => {
  const dbPath = path.join(dir, 'boot.db');
  const old = new Database(dbPath);
  old.exec(`CREATE TABLE marker (v TEXT); INSERT INTO marker VALUES ('old')`);
  old.close();
  const seed = new Database(`${dbPath}.seed`);
  seed.exec(`CREATE TABLE marker (v TEXT); INSERT INTO marker VALUES ('new')`);
  seed.close();
  execFileSync(process.execPath, ['-e', "require('./db/db').close()"], {
    cwd: path.join(__dirname, '..', '..'), env: { ...process.env, DATABASE_PATH: dbPath }, stdio: 'ignore',
  });
  assert.ok(!fs.existsSync(`${dbPath}.seed`));
  const read = (f) => { const d = new Database(f, { readonly: true }); try { return d.prepare('SELECT v FROM marker').get().v; } finally { d.close(); } };
  assert.equal(read(dbPath), 'new');
  assert.equal(read(`${dbPath}.prev`), 'old');
});
