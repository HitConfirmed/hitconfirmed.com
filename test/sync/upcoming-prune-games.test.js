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
  await require('../../futuresMeta').applyFuturesMetaSchema();
});

after(() => { try { fs.unlinkSync(file); } catch { /* ignore */ } });

test('daily sync drops a game start.gg no longer lists for the tournament, keeps games with markets', async () => {
  await db.runAsync(`INSERT INTO games (name, startgg_id) VALUES ('Street Fighter 6', 43868), ('Invincible Vs.', 108058), ('TEKKEN 8', 49783)`);
  const gid = async (n) => (await db.getAsync('SELECT id FROM games WHERE name = ?', [n])).id;
  const r = await db.runAsync(`INSERT INTO tournaments (name, date, city, country, startgg_id) VALUES ('MINDSET 2026', '2027-11-27', 'Colombes', 'FR', 900)`);
  const tid = r.lastID;
  for (const n of ['Street Fighter 6', 'Invincible Vs.', 'TEKKEN 8']) {
    await db.runAsync('INSERT INTO tournament_games (tournament_id, game_id) VALUES (?, ?)', [tid, await gid(n)]);
  }
  // TEKKEN 8 already has a market: never pull a game out from under one.
  await db.runAsync('INSERT INTO set_markets (tournament_id, game_id) VALUES (?, ?)', [tid, await gid('TEKKEN 8')]);

  // start.gg now only has the SF6 event (far out, no entrants -> no futures).
  startggTournament = {
    id: 900, name: 'MINDSET 2026', slug: 'tournament/mindset-2026', startAt: Date.parse('2027-11-27T16:00:00Z') / 1000,
    city: 'Colombes', countryCode: 'FR', images: [],
    events: [{ id: 1, name: 'SF6 1v1', numEntrants: null, videogame: { id: 43868, name: 'Street Fighter 6' }, phases: [] }],
  };
  await su.processTournament('tournament/mindset-2026', { top: 8, dryRun: false, trackedIds: [43868, 108058, 49783] });

  const games = (await db.allAsync(
    'SELECT g.name FROM tournament_games tg JOIN games g ON g.id = tg.game_id WHERE tg.tournament_id = ? ORDER BY g.name', [tid]
  )).map((x) => x.name);
  assert.deepEqual(games, ['Street Fighter 6', 'TEKKEN 8']);
});
