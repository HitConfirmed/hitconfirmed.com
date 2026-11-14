const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Liquipedia-announced placeholders (scripts/sync-liquipedia-upcoming.js).
// The risk is duplicates: an event shown twice because Liquipedia and
// start.gg name it differently. The fixtures use the real production names
// of both sides (e.g. Liquipedia "CPT 2026 World Warrior: Germany Regional
// Final" vs start.gg "Saltmine League - World Warrior 2026 - Germany Finals").
let db, lq, su, file;

before(async () => {
  file = path.join(os.tmpdir(), `mm-lq-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DATABASE_PATH = file;
  for (const m of ['../../db/db', '../../futuresMeta', '../../scripts/sync-liquipedia-upcoming', '../../scripts/sync-upcoming']) {
    delete require.cache[require.resolve(m)];
  }
  db = require('../../db/db');
  lq = require('../../scripts/sync-liquipedia-upcoming');
  su = require('../../scripts/sync-upcoming');
  await db.runAsync(`CREATE TABLE tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, date DATE NOT NULL, city TEXT NOT NULL, country TEXT NOT NULL, winner_id INTEGER, startgg_id INTEGER, logo_url TEXT, is_live INTEGER NOT NULL DEFAULT 0)`);
  await db.runAsync(`CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, startgg_id INTEGER)`);
  await require('../../futuresMeta').applyFuturesMetaSchema();
  // Legacy duplicate "Tekken 8" (no start.gg id) next to the real one, like production.
  await db.runAsync(`INSERT INTO games (name, startgg_id) VALUES ('Street Fighter 6', 43868), ('Tekken 8', NULL), ('TEKKEN 8', 49783),
    ('Marvel Tokon: Fighting Souls', NULL), ('Guilty Gear: Strive', 33945), ('Avatar Legends: The Fighting Game', NULL)`);
});

beforeEach(async () => {
  imageRequests = [];
  await db.runAsync('DELETE FROM tournament_logos');
  await db.runAsync("DELETE FROM games WHERE name = 'Art of Fighting 3'");
  await db.runAsync('UPDATE games SET auto_tracked = 0');
  await db.runAsync('DELETE FROM tournament_games');
  await db.runAsync('DELETE FROM tournaments');
});

after(() => { try { fs.unlinkSync(file); } catch { /* ignore */ } });

const icon = (file) => `<span class="league-icon-small-image lightmode"><a><img src="/commons/images/thumb/x/${file}_lightmode.png/50px-x.png"/></a></span><span class="league-icon-small-image darkmode"><a><img src="/commons/images/thumb/x/${file}_darkmode.png/50px-x.png" srcset="/commons/images/thumb/x/${file}_darkmode.png/75px-x.png 1.5x, /commons/images/thumb/x/${file}_darkmode.png/100px-x.png 2x"/></a></span>`;
const row = (name, game, date, winner = '') => `<div class="divRow"><div class="divCell Tournament Header"><a href="/fighters/${game}" title="${game}"><img alt="${game}"/></a>&#160;${icon(name.replace(/\W+/g, '_'))}<a href="/fighters/x">${name}</a></div><div class="divCell">${date}</div><div class="divCell">$1</div><div class="divCell">8 entrants</div><div class="divCell">Online</div><div class="divCell">${winner}</div><div class="divCell"></div></div>`;
const page = (...rows) => `<div class="divTable">${rows.join('')}</div>`;

test('parses Liquipedia date ranges, including month and year rollovers', () => {
  assert.deepEqual(lq.parseLiquipediaDate('Mar 10 - 14, 2027'), { start: '2027-03-10', end: '2027-03-14' });
  assert.deepEqual(lq.parseLiquipediaDate('Jan 9, 2027'), { start: '2027-01-09', end: '2027-01-09' });
  assert.deepEqual(lq.parseLiquipediaDate('Oct 23 - Nov 8, 2026'), { start: '2026-10-23', end: '2026-11-08' });
  assert.deepEqual(lq.parseLiquipediaDate('Aug 25 - Feb 23, 2027'), { start: '2026-08-25', end: '2027-02-23' });
  assert.equal(lq.parseLiquipediaDate('TBA'), null);
});

test('matches the same event across Liquipedia and start.gg naming, rejects same-day siblings', () => {
  assert.ok(lq.sameEventName('CPT 2026 World Warrior: Germany Regional Final', 'Saltmine League - World Warrior 2026 - Germany Finals'));
  assert.ok(lq.sameEventName('CPT 2026 World Warrior: US Midwest Regional Final', 'World Warrior 2026 - US Midwest Final'));
  assert.ok(lq.sameEventName('Evolution Championship Series: Singapore 2027', 'Evo Singapore 2027'));
  assert.ok(lq.sameEventName('Frosty Faustings XIX', 'Frosty Faustings XIX 2027'));
  // Same day (Dec 13), different regions - must stay separate events.
  assert.ok(!lq.sameEventName('CPT 2026 World Warrior: France-Monaco Regional Final', 'World Warrior 2026 - US/Canada East Final'));
  assert.ok(!lq.sameEventName('Capcom Cup 13', 'Evo Singapore 2027'));
});

const fixture = () => page(
  row('Evolution Championship Series: Singapore 2027', 'MARVEL Tōkon: Fighting Souls', 'Jan 15 - 17, 2027'),
  row('Frosty Faustings XIX', 'Guilty Gear -STRIVE-', 'Jan 28 - 31, 2027'),
  row('CPT 2026 World Warrior: Germany Regional Final', 'Street Fighter 6', 'Nov 22, 2026'),
  row('CPT 2026 World Warrior: France-Monaco Regional Final', 'Street Fighter 6', 'Dec 13, 2026'),
  row('Capcom Cup 13', 'Street Fighter 6', 'Mar 10 - 14, 2027'),
  row('Tekken World Tour Finals 2026', 'Tekken 8', 'Jan 15 - 17, 2027'),
  row('Pro-Bending Circuit World Finals', 'Avatar Legends', 'Sep 3 - 5, 2027'),
  row('Some Finished Major', 'Street Fighter 6', 'Nov 20, 2026', 'Punk'),
  row('Old Major', 'Street Fighter 6', 'Oct 1, 2026'),
  row('SNK Side Event', 'Art of Fighting 3', 'Nov 28, 2026'),
);
const PNG = { contentType: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
let imageRequests = [];
const run = (fetchImage = async (url) => { imageRequests.push(url); return PNG; }) =>
  lq.syncLiquipediaUpcoming({ fetchPage: async () => fixture(), fetchImage, gapMs: 0, imageGapMs: 0, today: '2026-11-13' });

test('creates placeholders only for events not already tracked, and is idempotent', async () => {
  // Production rows synced from start.gg.
  await db.runAsync(`INSERT INTO tournaments (name, date, city, country, startgg_id) VALUES
    ('Evo Singapore 2027', '2027-01-15T01:00:00.000Z', '', '', 1),
    ('Frosty Faustings XIX 2027', '2027-01-28T18:00:00.000Z', '', '', 2),
    ('Saltmine League - World Warrior 2026 - Germany Finals', '2026-11-22T18:00:00.000Z', '', '', 3),
    ('World Warrior 2026 - US/Canada East Final', '2026-12-13T22:00:00.000Z', '', '', 4)`);

  await run();
  await run(); // second daily run must not duplicate anything
  const placeholders = await db.allAsync(
    `SELECT t.name, date(t.date) d, group_concat(g.name) games FROM tournaments t
     JOIN tournament_games tg ON tg.tournament_id = t.id JOIN games g ON g.id = tg.game_id
     WHERE t.liquipedia_page IS NOT NULL GROUP BY t.id ORDER BY t.name`
  );
  assert.deepEqual(placeholders, [
    { name: 'CPT 2026 World Warrior: France-Monaco Regional Final', d: '2026-12-13', games: 'Street Fighter 6' },
    { name: 'Capcom Cup 13', d: '2027-03-10', games: 'Street Fighter 6' },
    { name: 'Pro-Bending Circuit World Finals', d: '2027-09-03', games: 'Avatar Legends: The Fighting Game' },
    // A game the app didn't know is added, not dropped.
    { name: 'SNK Side Event', d: '2026-11-28', games: 'Art of Fighting 3' },
    // Resolves to the start.gg-linked "TEKKEN 8", not the legacy duplicate.
    { name: 'Tekken World Tour Finals 2026', d: '2027-01-15', games: 'TEKKEN 8' },
  ]);
  assert.equal((await db.getAsync('SELECT COUNT(*) c FROM tournaments')).c, 9);
});

test('start.gg adopts the placeholder instead of creating a duplicate', async () => {
  await run();
  const placeholder = await db.getAsync(`SELECT id FROM tournaments WHERE name = 'Capcom Cup 13'`);
  const id = await su.upsertTournament({
    id: 777, name: 'Capcom Cup 13', startAt: Date.parse('2027-03-10T03:00:00Z') / 1000, city: 'Tokyo', countryCode: 'JP', images: [],
  });
  assert.equal(id, placeholder.id);
  const t = await db.getAsync('SELECT startgg_id, liquipedia_page FROM tournaments WHERE id = ?', [id]);
  assert.equal(Number(t.startgg_id), 777);
  assert.equal(t.liquipedia_page, null);

  await run(); // Liquipedia must now treat it as tracked, not re-create it
  assert.equal((await db.getAsync(`SELECT COUNT(*) c FROM tournaments WHERE name LIKE 'Capcom Cup 13%'`)).c, 1);
});

test('shows Evo under its usual name when Liquipedia is the only source', async () => {
  await run();
  assert.ok(await db.getAsync(`SELECT 1 FROM tournaments WHERE name = 'Evo Singapore 2027' AND liquipedia_page IS NOT NULL`));
});

test('drops its placeholder once the event is tracked another way (e.g. a manual EWC entry)', async () => {
  await run();
  await db.runAsync(`INSERT INTO tournaments (name, date, city, country) VALUES ('Capcom Cup 13 - Tokyo', '2027-03-10', 'Tokyo', 'JP')`);
  await run();
  assert.deepEqual(
    (await db.allAsync(`SELECT name, liquipedia_page FROM tournaments WHERE name LIKE 'Capcom Cup 13%'`)),
    [{ name: 'Capcom Cup 13 - Tokyo', liquipedia_page: null }]
  );
});

test('adds unknown games and flags every Liquipedia game for start.gg tracking', async () => {
  await run();
  const aof = await db.getAsync(`SELECT auto_tracked, startgg_id FROM games WHERE name = 'Art of Fighting 3'`);
  assert.equal(aof.auto_tracked, 1);
  assert.equal(aof.startgg_id, null);
  // Existing games matched loosely are flagged, not duplicated.
  assert.equal((await db.getAsync(`SELECT auto_tracked FROM games WHERE name = 'Marvel Tokon: Fighting Souls'`)).auto_tracked, 1);
  assert.equal((await db.getAsync(`SELECT COUNT(*) c FROM games WHERE name LIKE '%Tokon%'`)).c, 1);

  // start.gg then follows the newly flagged games alongside its fixed list.
  await db.runAsync(`UPDATE games SET startgg_id = 9999 WHERE name = 'Art of Fighting 3'`);
  const ids = await su.getTrackedGameIds();
  assert.ok(ids.includes(9999));
  assert.ok(ids.includes(43868));
  await db.runAsync(`UPDATE games SET startgg_id = NULL WHERE name = 'Art of Fighting 3'`);
});

test('start.gg links a differently-spelled game to the existing row instead of duplicating it', async () => {
  const before = (await db.getAsync(`SELECT id FROM games WHERE name = 'Marvel Tokon: Fighting Souls'`)).id;
  assert.equal(await su.upsertGame({ id: 4242, name: 'MARVEL Tōkon: Fighting Souls' }), before);
  assert.equal(Number((await db.getAsync('SELECT startgg_id FROM games WHERE id = ?', [before])).startgg_id), 4242);
  await db.runAsync('UPDATE games SET startgg_id = NULL WHERE id = ?', [before]);
});

test('stores the dark-mode logo locally and serves it from our own URL', async () => {
  await run();
  const t = await db.getAsync(`SELECT id, logo_url FROM tournaments WHERE name = 'Capcom Cup 13'`);
  assert.equal(t.logo_url, `/api/tournament-logo/${t.id}`);
  const logo = await db.getAsync('SELECT source_url, content_type FROM tournament_logos WHERE tournament_id = ?', [t.id]);
  assert.equal(logo.source_url, 'https://liquipedia.net/commons/images/thumb/x/Capcom_Cup_13_darkmode.png/100px-x.png');
  assert.equal(logo.content_type, 'image/png');

  // Second run: unchanged file is not downloaded again.
  imageRequests = [];
  await run();
  assert.equal(imageRequests.length, 0);
});

test('fills a missing logo on a start.gg event but never replaces an existing one', async () => {
  await db.runAsync(`INSERT INTO tournaments (name, date, city, country, startgg_id, logo_url) VALUES
    ('Evo Singapore 2027', '2027-01-15T01:00:00.000Z', '', '', 1, 'https://images.start.gg/evo.png'),
    ('Frosty Faustings XIX 2027', '2027-01-28T18:00:00.000Z', '', '', 2, NULL)`);
  await run();
  assert.equal((await db.getAsync(`SELECT logo_url FROM tournaments WHERE startgg_id = 1`)).logo_url, 'https://images.start.gg/evo.png');
  assert.match((await db.getAsync(`SELECT logo_url FROM tournaments WHERE startgg_id = 2`)).logo_url, /^\/api\/tournament-logo\/\d+$/);
});

test('rejects non-raster logos (an SVG served from our origin could run script)', async () => {
  await run(async () => ({ contentType: 'image/svg+xml', data: Buffer.from('<svg/>') }));
  assert.equal((await db.getAsync('SELECT COUNT(*) c FROM tournament_logos')).c, 0);
  assert.equal((await db.getAsync(`SELECT logo_url FROM tournaments WHERE name = 'Capcom Cup 13'`)).logo_url, null);
});

// Found by the daily tournament reality check (2026-11-14): Astral Finish
// 2026 was live on start.gg (6 events in progress) while the official site
// still showed its Liquipedia countdown card with 2 of its games and no
// brackets - placeholders were only ever adopted when the series happened to
// be in BRANDS AND start.gg's fuzzy name search returned it (it never returns
// "Capcom Cup 13"). The daily sync must look each placeholder up itself.
test('finds the start.gg page of a Liquipedia placeholder outside BRANDS (by slug or name), rejecting look-alikes', async () => {
  await run();
  await db.runAsync(`INSERT INTO tournaments (name, date, city, country, liquipedia_page) VALUES
    ('Astral Finish 2026', '2026-11-13', 'Zapopan', '', 'Astral Finish 2026'),
    ('SNK World Championship 2026 Finals', '2026-11-28', 'Stockholm', '', 'SNK World Championship 2026 Finals')`);
  const at = (d) => Date.parse(d) / 1000;
  const calls = [];
  const query = async (q, v) => {
    calls.push(v);
    if (v.slug === 'astral-finish-2026') return { tournament: { id: 1, name: 'Astral Finish 2026', slug: 'tournament/astral-finish-2026', startAt: at('2026-11-13T16:00:00Z') } };
    if (v.slug === 'capcom-cup-13') return { tournament: { id: 2, name: 'Capcom Cup 13', slug: 'tournament/capcom-cup-13', startAt: at('2027-03-10T05:00:00Z') } };
    // Same slug, different (older) event: wrong date - must not be adopted.
    if (v.slug === 'tekken-world-tour-finals-2026') return { tournament: { id: 3, name: 'Tekken World Tour Finals 2026', slug: 'tournament/tekken-world-tour-finals-2026', startAt: at('2026-01-20T00:00:00Z') } };
    if (v.name === 'SNK World Championship 2026 Finals') {
      return { tournaments: { nodes: [
        { id: 4, name: 'Red Dirt Rumble 11/29/2026', slug: 'tournament/red-dirt-rumble', startAt: at('2026-11-29T00:00:00Z') },
        { id: 5, name: 'SNK World Championship 2026', slug: 'tournament/snk-world-championship-2026-2', startAt: at('2026-11-27T11:00:00Z') },
      ] } };
    }
    if (v.slug) return { tournament: null };
    return { tournaments: { nodes: [] } };
  };
  const found = await su.findPlaceholderSlugs(query);
  assert.deepEqual([...found.keys()].sort(), [
    'tournament/astral-finish-2026', 'tournament/capcom-cup-13', 'tournament/snk-world-championship-2026-2',
  ]);
  // A slug hit skips the name search.
  assert.ok(!calls.some((v) => v.name === 'Astral Finish 2026'));
});
