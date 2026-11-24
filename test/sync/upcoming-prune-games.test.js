const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Real case (Nov 2026): MINDSET 2026 kept listing Invincible Vs. on the
// Tournaments page although start.gg had no Invincible Vs. event there any
// more. processTournament only ever added tournament_games rows, so a game
// that dropped off the start.gg lineup was never removed.
let db, su, file;
let startggTournament;

before(async () => {
  file = path.join(os.tmpdir(), `mm-prune-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DATABASE_PATH = file;
  for (const m of ['../../db/db', '../../futuresMeta', '../../scripts/sync-liquipedia-upcoming', '../../scripts/sync-upcoming', '../../startggClient']) {
    delete require.cache[require.resolve(m)];
  }
  const clientPath = require.resolve('../../startggClient');
  require.cache[clientPath] = {
    id: clientPath, filename: clientPath, loaded: true,
    exports: { EVENTS_LIMIT: 100, startgg: async () => ({ tournament: startggTournament }) },
  };
  db = require('../../db/db');
  su = require('../../scripts/sync-upcoming');
  await db.runAsync(`CREATE TABLE IF NOT EXISTS tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, date DATE NOT NULL, city TEXT NOT NULL, country TEXT NOT NULL, winner_id INTEGER, startgg_id INTEGER, logo_url TEXT, is_live INTEGER NOT NULL DEFAULT 0)`);
  await db.runAsync(`CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, startgg_id INTEGER)`);
  await db.runAsync(`CREATE TABLE IF NOT EXISTS players_games_tournaments (player_id INTEGER, game_id INTEGER, tournament_id INTEGER)`);
  await db.runAsync(`CREATE TABLE IF NOT EXISTS set_markets (id INTEGER PRIMARY KEY, tournament_id INTEGER, game_id INTEGER)`);
  await db.runAsync(`CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY, tournament_id INTEGER, game_id INTEGER, player_id INTEGER)`);
  await db.runAsync(`CREATE TABLE IF NOT EXISTS parlay_legs (id INTEGER PRIMARY KEY, tournament_id INTEGER, game_id INTEGER, player_id INTEGER)`);
  await require('../../futuresMeta').applyFuturesMetaSchema();
});

after(() => { try { fs.unlinkSync(file); } catch { /* ignore */ } });

test('daily sync drops a game start.gg no longer lists (and its unbet seeds), keeps games with markets or bets', async () => {
  await db.runAsync(`INSERT INTO games (name, startgg_id) VALUES ('Street Fighter 6', 43868), ('Invincible Vs.', 108058), ('TEKKEN 8', 49783), ('2XKO', 2000)`);
  const gid = async (n) => (await db.getAsync('SELECT id FROM games WHERE name = ?', [n])).id;
  const r = await db.runAsync(`INSERT INTO tournaments (name, date, city, country, startgg_id) VALUES ('MINDSET 2026', '2027-11-27', 'Colombes', 'FR', 900)`);
  const tid = r.lastID;
  for (const n of ['Street Fighter 6', 'Invincible Vs.', 'TEKKEN 8', '2XKO']) {
    await db.runAsync('INSERT INTO tournament_games (tournament_id, game_id) VALUES (?, ?)', [tid, await gid(n)]);
  }
  // TEKKEN 8 already has a market: never pull a game out from under one.
  await db.runAsync('INSERT INTO set_markets (tournament_id, game_id) VALUES (?, ?)', [tid, await gid('TEKKEN 8')]);
  // 2XKO has a futures bet: keep it too.
  await db.runAsync('INSERT INTO bets (tournament_id, game_id, player_id) VALUES (?, ?, 7)', [tid, await gid('2XKO')]);
  // Invincible Vs. was seeded before the organizer removed it (the real case), but nobody bet.
  for (const p of [1, 2, 3]) await db.runAsync('INSERT INTO players_games_tournaments (player_id, game_id, tournament_id) VALUES (?, ?, ?)', [p, await gid('Invincible Vs.'), tid]);

  // start.gg now only has the SF6 event (far out, no entrants -> no futures).
  startggTournament = {
    id: 900, name: 'MINDSET 2026', slug: 'tournament/mindset-2026', startAt: Date.parse('2027-11-27T16:00:00Z') / 1000,
    city: 'Colombes', countryCode: 'FR', images: [],
    events: [{ id: 1, name: 'SF6 1v1', numEntrants: null, videogame: { id: 43868, name: 'Street Fighter 6' }, phases: [] }],
  };
  await su.processTournament('tournament/mindset-2026', { top: 8, dryRun: false, trackedIds: [43868, 108058, 49783, 2000] });

  const games = (await db.allAsync(
    'SELECT g.name FROM tournament_games tg JOIN games g ON g.id = tg.game_id WHERE tg.tournament_id = ? ORDER BY g.name', [tid]
  )).map((x) => x.name);
  assert.deepEqual(games, ['2XKO', 'Street Fighter 6', 'TEKKEN 8']);
  const seeds = await db.getAsync('SELECT COUNT(*) c FROM players_games_tournaments WHERE tournament_id = ? AND game_id = ?', [tid, await gid('Invincible Vs.')]);
  assert.strictEqual(seeds.c, 0);
});

test('already-tracked upcoming tournaments are revisited by start.gg id; past ones are not', async () => {
  await db.runAsync(`INSERT INTO tournaments (name, date, city, country, startgg_id) VALUES ('Adopted Major', date('now', '+5 days'), 'X', '', 111), ('Old One', '2020-01-01', 'X', '', 222), ('Placeholder', date('now', '+5 days'), 'X', '', NULL)`);
  const asked = [];
  const query = async (_q, { id }) => { asked.push(Number(id)); return { tournament: { id, name: `T${id}`, slug: `tournament/t-${id}` } }; };
  const found = await su.findTrackedUpcomingSlugs(Math.floor(Date.now() / 1000) + 365 * 86400, query);
  assert.ok(asked.includes(111));
  assert.ok(!asked.includes(222));
  assert.strictEqual(found.get('tournament/t-111'), 'T111');
});
