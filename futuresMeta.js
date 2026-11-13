// Per-(tournament, game) futures metadata that doesn't belong on the per-entrant
// players_games_tournaments rows. Currently just the start.gg entrant count for
// each event, shown on the Future Tournaments page. Idempotent schema so it can
// be ensured at server startup and by the sync/backfill scripts.
const db = require('./db/db');

async function applyFuturesMetaSchema() {
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS tournament_games (
      tournament_id INTEGER NOT NULL,
      game_id       INTEGER NOT NULL,
      num_entrants  INTEGER,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tournament_id, game_id),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  // Key for Liquipedia-announced placeholder tournaments (see
  // scripts/sync-liquipedia-upcoming.js). Lives here so every caller that
  // already applies this schema (server boot, sync-upcoming) gets it too.
  const cols = await db.allAsync('PRAGMA table_info(tournaments)');
  if (cols.length && !cols.some((c) => c.name === 'liquipedia_page')) {
    await db.runAsync('ALTER TABLE tournaments ADD COLUMN liquipedia_page TEXT');
  }
  // Games discovered at Liquipedia Tier 1/2 events; sync-upcoming follows
  // these on start.gg in addition to its hard-coded GAME_IDS.
  const gameCols = await db.allAsync('PRAGMA table_info(games)');
  if (gameCols.length && !gameCols.some((c) => c.name === 'auto_tracked')) {
    await db.runAsync('ALTER TABLE games ADD COLUMN auto_tracked INTEGER NOT NULL DEFAULT 0');
  }
  // Tournament logos downloaded from Liquipedia, served by
  // GET /api/tournament-logo/:id instead of hotlinking.
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS tournament_logos (
      tournament_id INTEGER PRIMARY KEY,
      source_url    TEXT NOT NULL,
      content_type  TEXT NOT NULL,
      data          BLOB NOT NULL,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// Upsert the entrant count for one event. Null/undefined counts are ignored so a
// missing start.gg value never clobbers a previously-recorded number.
async function upsertEntrantCount(tournamentId, gameId, numEntrants) {
  if (numEntrants == null) return;
  await db.runAsync(
    `INSERT INTO tournament_games (tournament_id, game_id, num_entrants, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(tournament_id, game_id) DO UPDATE
       SET num_entrants = excluded.num_entrants, updated_at = CURRENT_TIMESTAMP`,
    [tournamentId, gameId, numEntrants]
  );
}

// Register that a game will be at a tournament, even before entrant seedings
// exist. Uses INSERT OR IGNORE so it never overwrites an existing entrant count.
async function upsertTournamentGame(tournamentId, gameId) {
  await db.runAsync(
    `INSERT OR IGNORE INTO tournament_games (tournament_id, game_id)
     VALUES (?, ?)`,
    [tournamentId, gameId]
  );
}

module.exports = { applyFuturesMetaSchema, upsertEntrantCount, upsertTournamentGame };
