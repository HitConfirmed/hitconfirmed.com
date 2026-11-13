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
const { fetchPageHtml } = require('./fetch-liquipedia-bracket');
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
      name, game, ...dates,
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
    if (!byKey.has(key)) byKey.set(key, { name: r.name, start: r.start, location: r.location, games: new Set() });
    byKey.get(key).games.add(r.game);
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

const dayDiff = (a, b) => Math.abs(Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / 86400000;

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

let gamesCache = null;
async function resolveGameId(liquipediaGame) {
  if (!gamesCache) {
    // Prefer start.gg-linked rows: the games table has legacy duplicates
    // ("Tekken 8" vs "TEKKEN 8") and the start.gg one is what everything
    // else (markets, futures) attaches to.
    gamesCache = (await db.allAsync('SELECT id, name, startgg_id FROM games ORDER BY (startgg_id IS NULL), id'))
      .map((g) => ({ id: g.id, n: norm(g.name) }));
  }
  const want = GAME_ALIASES[norm(liquipediaGame)] || norm(liquipediaGame);
  const exact = gamesCache.find((g) => g.n === want);
  if (exact) return exact.id;
  const prefix = gamesCache.find((g) => g.n.startsWith(`${want} `) || want.startsWith(`${g.n} `));
  return prefix ? prefix.id : null;
}

// ---- schema + write --------------------------------------------------------

async function upsertPlaceholder(ev) {
  const gameIds = [];
  for (const g of ev.games) {
    const id = await resolveGameId(g);
    if (id) gameIds.push(id);
    else console.log(`[liquipedia-upcoming] "${ev.name}": game "${g}" not in games table - skipped`);
  }
  if (!gameIds.length) return 'no-games';

  if (await findMatchingTournament(ev.name, ev.start)) {
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
  return 'upserted';
}

// Liquipedia spells out Evo's full name; everything else in the app says "Evo".
const displayName = (name) => name.replace(/^Evolution Championship Series:\s*/i, 'Evo ');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function syncLiquipediaUpcoming({ fetchPage = fetchPageHtml, gapMs = PARSE_GAP_MS, today } = {}) {
  await applyFuturesMetaSchema();
  gamesCache = null;
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
  const stats = { events: events.length, upserted: 0, exists: 0, 'no-games': 0 };
  for (const ev of events) stats[await upsertPlaceholder(ev)]++;
  console.log(`[liquipedia-upcoming] ${stats.events} announced event(s): ${stats.upserted} placeholder(s) upserted, ${stats.exists} already tracked, ${stats['no-games']} with no known games`);
  return stats;
}

module.exports = {
  syncLiquipediaUpcoming, parseLiquipediaDate, parseTierPage, upcomingEvents,
  sameEventName, findMatchingTournament, resolveGameId,
};

if (require.main === module) {
  syncLiquipediaUpcoming().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}
