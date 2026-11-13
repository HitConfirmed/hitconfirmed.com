// Fills Upcoming Tournaments with announced majors BEFORE they exist on
// start.gg. scripts/sync-upcoming.js can only see what organizers have
// already published on start.gg, and the big events (Capcom Cup, Tekken
// World Tour Finals, SNK World Championship, next year's Evo/CEO/Combo
// Breaker...) often show up there only weeks out. Liquipedia's Tier 1 / Tier
// 2 tournament lists carry them as soon as they're announced.
//
// Each announced event becomes a countdown-only "placeholder" tournament:
// name, start date, location and the games we already know (tournament_games),
// no startgg_id, tagged with tournaments.liquipedia_page = the Liquipedia
// display name (the upsert key). getUpcoming's manual-event bridge already
// shows that shape (see liveMarkets.getUpcoming).
//
// Duplicates are prevented in both directions:
//  - an event already in the DB (start.gg-synced, or a manual EWC entry) is
//    skipped here (findMatchingTournament: same-ish name, start within 3 days);
//  - when start.gg later lists it, sync-upcoming's upsertTournament ADOPTS the
//    placeholder row (sets startgg_id, clears liquipedia_page) instead of
//    inserting a second row.
const cheerio = require('cheerio');
const db = require('../db/db');
const { fetchPageHtml, USER_AGENT } = require('./fetch-liquipedia-bracket');
const { applyFuturesMetaSchema, upsertTournamentGame } = require('../futuresMeta');

const TIER_PAGES = ['Tier_1_Tournaments', 'Tier_2_Tournaments'];
// Liquipedia API terms: action=parse is limited to 1 request per 30 seconds.
const PARSE_GAP_MS = 31000;
const LOOKAHEAD_DAYS = 365;
const SAME_EVENT_MAX_DAYS = 3;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

// "Mar 10 - 14, 2027" | "Jan 9, 2027" | "Oct 23 - Nov 8, 2026" |
// "Aug 25 - Feb 23, 2027" (league spanning New Year: the year is the END's).
function parseLiquipediaDate(text) {
  const t = String(text || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2})(?: ?- ?(?:([A-Za-z]{3})[a-z]*\.? )?(\d{1,2}))?, (\d{4})$/.exec(t);
  if (!m) return null;
  const sm = MONTHS[m[1].toLowerCase()];
  const em = m[3] ? MONTHS[m[3].toLowerCase()] : sm;
  if (sm == null || em == null) return null;
  const year = Number(m[5]);
  const startYear = sm > em ? year - 1 : year;
  return { start: iso(startYear, sm, Number(m[2])), end: iso(year, em, Number(m[4] || m[2])) };
}

const LIQUIPEDIA_ORIGIN = 'https://liquipedia.net';

// The event's own logo from a table row. Liquipedia ships light/dark variants
// for some; the app is dark-themed, so prefer darkmode, then allmode/any.
// Takes the largest srcset candidate (2x = ~100px) for a crisp card icon.
function leagueIconUrl($, cell) {
  const spans = cell.find('span.league-icon-small-image').toArray();
  if (!spans.length) return null;
  const span = spans.find((s) => $(s).hasClass('darkmode'))
    || spans.find((s) => !$(s).hasClass('lightmode')) || spans[0];
  const img = $(span).find('img').first();
  const srcset = (img.attr('srcset') || '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
  const src = srcset[srcset.length - 1] || img.attr('src');
  if (!src) return null;
  return src.startsWith('http') ? src : `${LIQUIPEDIA_ORIGIN}${src}`;
}

// One row per (event, game) from a Liquipedia "Portal tournaments table".
function parseTierPage(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('.divRow').each((_, r) => {
    const cells = $(r).children('.divCell');
    if (cells.length < 6) return;
    const first = cells.eq(0);
    const game = first.find('a').first().attr('title') || null;
    const name = first.text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const dates = parseLiquipediaDate(cells.eq(1).text());
    if (!name || !game || !dates) return;
    const winner = cells.eq(5).text().replace(/ /g, ' ').trim();
    rows.push({
      name, game, ...dates, iconUrl: leagueIconUrl($, first),
      location: cells.eq(4).text().replace(/ /g, ' ').trim() || null,
      decided: !!winner && !/^tbd$/i.test(winner),
    });
  });
  return rows;
}

// Group per-game rows into events (same display name + start date), keeping
// only upcoming, undecided events within the look-ahead window.
function upcomingEvents(rows, today = new Date().toISOString().slice(0, 10)) {
  const horizon = new Date(Date.parse(today) + LOOKAHEAD_DAYS * 86400000).toISOString().slice(0, 10);
  const byKey = new Map();
  for (const r of rows) {
    if (r.decided || r.start < today || r.start > horizon) continue;
    const key = `${r.name}|${r.start}`;
    if (!byKey.has(key)) byKey.set(key, { name: r.name, start: r.start, location: r.location, iconUrl: null, games: new Set() });
    const ev = byKey.get(key);
    ev.games.add(r.game);
    ev.iconUrl = ev.iconUrl || r.iconUrl;
  }
  return [...byKey.values()].map((e) => ({ ...e, games: [...e.games] }));
}

// ---- name matching -------------------------------------------------------

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Words that say nothing about WHICH event this is ("CPT 2026 World Warrior:
// Germany Regional Final" vs "Saltmine League - World Warrior 2026 - Germany
// Finals" must still match, "...France-Monaco..." vs "...US/Canada East..." on
// the same day must not).
const GENERIC = new Set(['the', 'of', 'at', 'and', 'presents', 'cpt', 'capcom', 'pro', 'tour', 'regional',
  'final', 'finals', 'league', 'series', 'tournament', 'edition', 'major', 'saltmine', 'set', 'reset']);

function eventTokens(name) {
  const n = norm(name).replace(/\bevolution championship series\b/g, 'evo');
  return new Set(n.split(' ').filter((w) => w && !GENERIC.has(w) && !/^(19|20)\d\d$/.test(w)));
}

function sameEventName(a, b) {
  const ta = eventTokens(a);
  const tb = eventTokens(b);
  if (!ta.size || !tb.size) return false;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap++;
  const small = Math.min(ta.size, tb.size);
  return overlap >= Math.min(2, small) && overlap / small >= 0.75;
}


// Any tournament (start.gg-synced or manual) that is this event, excluding
// Liquipedia placeholders themselves.
async function findMatchingTournament(name, startDate, { placeholders = false } = {}) {
  const candidates = await db.allAsync(
    `SELECT id, name, date, startgg_id, liquipedia_page FROM tournaments
     WHERE ABS(julianday(date(date)) - julianday(?)) <= ?
       AND ${placeholders ? 'liquipedia_page IS NOT NULL AND startgg_id IS NULL' : 'liquipedia_page IS NULL'}`,
    [startDate, SAME_EVENT_MAX_DAYS]
  );
  return candidates.find((c) => sameEventName(c.name, name)
    || (c.liquipedia_page && sameEventName(c.liquipedia_page, name))) || null;
}

// ---- game matching -------------------------------------------------------

const GAME_ALIASES = {
  'samurai shodown 2019': 'samurai shodown',
  'avatar legends': 'avatar legends the fighting game',
};

// Existing games row for a game name from another source, matched loosely
// (case, punctuation, diacritics: "MARVEL Tōkon: Fighting Souls" = "Marvel
// Tokon: Fighting Souls"; "Avatar Legends" = "Avatar Legends: The Fighting
// Game"). Prefers start.gg-linked rows: the games table has legacy
// duplicates ("Tekken 8" vs "TEKKEN 8") and the start.gg one is what
// markets and futures attach to. Shared with sync-upcoming's upsertGame.
async function findGameIdByName(name, { prefix = true } = {}) {
  const games = (await db.allAsync('SELECT id, name FROM games ORDER BY (startgg_id IS NULL), id'))
    .map((g) => ({ id: g.id, n: norm(g.name) }));
  const want = GAME_ALIASES[norm(name)] || norm(name);
  if (!want) return null;
  const exact = games.find((g) => g.n === want);
  if (exact) return exact.id;
  if (!prefix) return null;
  const loose = games.find((g) => g.n.startsWith(`${want} `) || want.startsWith(`${g.n} `));
  return loose ? loose.id : null;
}

// Liquipedia's fighting-games wiki only lists fighting games, so any game it
// shows at a Tier 1/2 event is one the app should know about: match it to an
// existing row, or add it. Either way flag it auto_tracked, which is what
// tells sync-upcoming to follow this game's events on start.gg too (beyond
// its hard-coded GAME_IDS) - otherwise a newly released game would never be
// picked up anywhere.
async function resolveGameId(liquipediaGame) {
  let id = await findGameIdByName(liquipediaGame);
  if (!id) {
    const r = await db.runAsync('INSERT INTO games (name, auto_tracked) VALUES (?, 1)', [liquipediaGame]);
    id = r.lastID;
    console.log(`[liquipedia-upcoming] added new game "${liquipediaGame}" (id ${id})`);
  } else {
    await db.runAsync('UPDATE games SET auto_tracked = 1 WHERE id = ? AND COALESCE(auto_tracked, 0) = 0', [id]);
  }
  return id;
}

// ---- logos ----------------------------------------------------------------

// Logos are downloaded once and served from our own /api/tournament-logo/:id
// rather than hotlinked from Liquipedia. Never replaces a logo another source
// (start.gg) already set; re-downloads only when Liquipedia's file changes.
const OWN_LOGO_PREFIX = '/api/tournament-logo/';

async function storeLogo(tournamentId, iconUrl, fetchImage) {
  if (!iconUrl) return false;
  const t = await db.getAsync('SELECT logo_url FROM tournaments WHERE id = ?', [tournamentId]);
  if (!t || (t.logo_url && !t.logo_url.startsWith(OWN_LOGO_PREFIX))) return false;
  const have = await db.getAsync('SELECT source_url FROM tournament_logos WHERE tournament_id = ?', [tournamentId]);
  if (!have || have.source_url !== iconUrl) {
    let img;
    try {
      img = await fetchImage(iconUrl);
    } catch (err) {
      console.error(`[liquipedia-upcoming] logo download failed (${iconUrl}): ${err.message}`);
      return false;
    }
    // Raster only: an SVG served from our own origin could carry script.
    if (!img || !/^image\/(png|jpeg|gif|webp|avif)\b/i.test(img.contentType || '') || !img.data?.length || img.data.length > 512 * 1024) return false;
    await db.runAsync(
      `INSERT INTO tournament_logos (tournament_id, source_url, content_type, data, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(tournament_id) DO UPDATE SET source_url = excluded.source_url,
         content_type = excluded.content_type, data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
      [tournamentId, iconUrl, img.contentType, img.data]
    );
  }
  await db.runAsync('UPDATE tournaments SET logo_url = ? WHERE id = ?', [`${OWN_LOGO_PREFIX}${tournamentId}`, tournamentId]);
  return true;
}

// Static files, not API calls - Liquipedia's terms still ask for a real
// User-Agent and gentle pacing (see IMAGE_GAP_MS in the sync loop).
async function fetchLiquipediaImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { contentType: res.headers.get('content-type'), data: Buffer.from(await res.arrayBuffer()) };
}

// ---- schema + write --------------------------------------------------------

async function upsertPlaceholder(ev, fetchImage) {
  const gameIds = [];
  for (const g of ev.games) gameIds.push(await resolveGameId(g));

  const match = await findMatchingTournament(ev.name, ev.start);
  if (match) {
    // Fill in a missing logo on the tracked row (never replaces start.gg's).
    await storeLogo(match.id, ev.iconUrl, fetchImage);
    // Tracked elsewhere now (e.g. a manual EWC entry seeded after this
    // placeholder). Placeholders only ever own tournament_games rows -
    // anything with markets/seeds has a startgg_id - so it's safe to drop.
    const stale = await db.getAsync('SELECT id FROM tournaments WHERE liquipedia_page = ? AND startgg_id IS NULL', [ev.name]);
    if (stale) {
      await db.runAsync('DELETE FROM tournament_games WHERE tournament_id = ?', [stale.id]);
      await db.runAsync('DELETE FROM tournaments WHERE id = ?', [stale.id]);
      console.log(`[liquipedia-upcoming] "${ev.name}": now tracked elsewhere - removed placeholder id ${stale.id}`);
    }
    return 'exists';
  }

  let row = await db.getAsync('SELECT id FROM tournaments WHERE liquipedia_page = ? AND startgg_id IS NULL', [ev.name]);
  const city = ev.location || '';
  if (row) {
    await db.runAsync('UPDATE tournaments SET date = ?, city = ? WHERE id = ?', [ev.start, city, row.id]);
  } else {
    const display = displayName(ev.name);
    const nameTaken = await db.getAsync('SELECT id FROM tournaments WHERE name = ?', [display]);
    const name = nameTaken ? `${display} (${ev.start})` : display;
    const r = await db.runAsync(
      `INSERT INTO tournaments (name, date, city, country, winner_id, startgg_id, logo_url, is_live, liquipedia_page)
       VALUES (?, ?, ?, '', NULL, NULL, NULL, 0, ?)`,
      [name, ev.start, city, ev.name]
    );
    row = { id: r.lastID };
  }
  for (const gid of gameIds) await upsertTournamentGame(row.id, gid);
  await storeLogo(row.id, ev.iconUrl, fetchImage);
  return 'upserted';
}

// Liquipedia spells out Evo's full name; everything else in the app says "Evo".
const displayName = (name) => name.replace(/^Evolution Championship Series:\s*/i, 'Evo ');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IMAGE_GAP_MS = 2000;

async function syncLiquipediaUpcoming({ fetchPage = fetchPageHtml, fetchImage = fetchLiquipediaImage, gapMs = PARSE_GAP_MS, imageGapMs = IMAGE_GAP_MS, today } = {}) {
  await applyFuturesMetaSchema();
  const pacedFetchImage = async (url) => { try { return await fetchImage(url); } finally { await sleep(imageGapMs); } };
  const rows = [];
  for (let i = 0; i < TIER_PAGES.length; i++) {
    if (i) await sleep(gapMs);
    try {
      rows.push(...parseTierPage(await fetchPage(TIER_PAGES[i])));
    } catch (err) {
      console.error(`[liquipedia-upcoming] ${TIER_PAGES[i]} fetch/parse failed: ${err.message}`);
    }
  }
  const events = upcomingEvents(rows, today);
  const stats = { events: events.length, upserted: 0, exists: 0 };
  for (const ev of events) stats[await upsertPlaceholder(ev, pacedFetchImage)]++;
  console.log(`[liquipedia-upcoming] ${stats.events} announced event(s): ${stats.upserted} placeholder(s) upserted, ${stats.exists} already tracked`);
  return stats;
}

module.exports = {
  syncLiquipediaUpcoming, parseLiquipediaDate, parseTierPage, upcomingEvents,
  sameEventName, findMatchingTournament, resolveGameId, findGameIdByName, OWN_LOGO_PREFIX,
};

if (require.main === module) {
  syncLiquipediaUpcoming().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}
