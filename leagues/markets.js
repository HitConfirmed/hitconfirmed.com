/**
 * Team-league match-winner markets: who wins a team-vs-team league match
 * (e.g. an SFL week's REJECT vs Nagoya OJA). Same money model as the live
 * per-set markets in liveMarkets.js - a parimutuel pool seeded with the scaled
 * virtual subsidy, priced by liveMarkets.sideRates against the one shared house
 * bankroll (which counts league_bets too), all money moves through
 * wallet.apply* inside withWriteTx.
 *
 * Lifecycle (driven by leagues/sync.js after each Liquipedia sync):
 *   open    both teams known, lock time in the future
 *   closed  lock time passed, result not posted yet
 *   settled Liquipedia shows a winner - winners paid, losers keep nothing
 *   void    match ended without a winner, teams changed, or match vanished -
 *           every stake refunded
 *
 * Liquipedia is only synced every few hours, so a market's stored state can
 * lag its lock time. Every bet/cancel checks lock_at itself, and reads expose
 * the effective state - the stored 'open' is never trusted past lock_at.
 */
const db = require('../db/db');
const wallet = require('../wallet');
const economy = require('../economy');
const { withWriteTx } = require('../txn');
const { effectiveSubsidyCents, computeLiveOdds } = require('../liveOdds');
const liveMarkets = require('../liveMarkets');

const err = (code, message) => Object.assign(new Error(message), { code });

// ---- pricing --------------------------------------------------------------

// Opening win probability from each team's points this season (league points
// = the team-match scores, e.g. 30:10). Smoothed toward 50/50 so a team with
// one result isn't priced like a lock, and clamped so no line is absurd.
const PRIOR_POINTS = 30;
function openingProbabilities(stats1 = {}, stats2 = {}) {
  const strength = (s) => ((s.pf || 0) + PRIOR_POINTS) / ((s.pf || 0) + (s.pa || 0) + 2 * PRIOR_POINTS);
  const a = strength(stats1), b = strength(stats2);
  const p1 = Math.min(0.85, Math.max(0.15, a / (a + b)));
  return { p1, p2: 1 - p1 };
}

function initialOdds(p1, p2) {
  const { p1Odds, p2Odds } = computeLiveOdds({ p1Prob: p1, p2Prob: p2, seedKCents: effectiveSubsidyCents(0) });
  return { p1Odds, p2Odds, kEff: effectiveSubsidyCents(0) };
}

const isLocked = (lockAt, now = Date.now()) => !lockAt || Date.parse(lockAt) <= now;

function effectiveState(market, lockAt, now = Date.now()) {
  if (market.state === 'open' && isLocked(lockAt, now)) return 'closed';
  return market.state;
}

async function repriceInTx(marketId) {
  const m = await db.getAsync('SELECT * FROM league_markets WHERE id = ?', [marketId]);
  const bankroll = await liveMarkets.houseBankrollCents();
  const { p1, p2, kEff } = liveMarkets.sideRates(m, bankroll);
  await db.runAsync('UPDATE league_markets SET p1_live_odds=?, p2_live_odds=?, seed_k_cents=? WHERE id=?', [p1, p2, kEff, marketId]);
  return { p1Odds: p1, p2Odds: p2 };
}

// ---- lifecycle (sync-driven) ------------------------------------------------

// The market currently standing for a match (newest non-void one).
async function activeMarketForMatch(matchId) {
  return db.getAsync(
    `SELECT * FROM league_markets WHERE match_id = ? AND state != 'void' ORDER BY id DESC LIMIT 1`, [matchId]);
}

async function openMarket({ matchId, team1Id, team2Id, p1, p2 }) {
  return withWriteTx(async () => {
    const existing = await activeMarketForMatch(matchId);
    if (existing) return existing.id;
    const { p1Odds, p2Odds, kEff } = initialOdds(p1, p2);
    const res = await db.runAsync(
      `INSERT INTO league_markets (match_id, team1_id, team2_id, state, p1_prob, p2_prob, seed_k_cents, p1_live_odds, p2_live_odds)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      [matchId, team1Id, team2Id, p1, p2, kEff, p1Odds, p2Odds]);
    return res.lastID;
  });
}

// Re-derive the opening line while nobody has bet yet (standings moved since
// the market opened). Once money is in, the line belongs to the pool.
async function refreshUnbetMarket(marketId, p1, p2) {
  return withWriteTx(async () => {
    const m = await db.getAsync('SELECT * FROM league_markets WHERE id = ?', [marketId]);
    if (!m || m.state !== 'open' || m.p1_pool_cents || m.p2_pool_cents) return false;
    if (Math.abs(m.p1_prob - p1) < 0.005) return false;
    const { p1Odds, p2Odds } = initialOdds(p1, p2);
    await db.runAsync('UPDATE league_markets SET p1_prob=?, p2_prob=?, p1_live_odds=?, p2_live_odds=? WHERE id=?',
      [p1, p2, p1Odds, p2Odds, marketId]);
    return true;
  });
}

async function closeMarket(marketId) {
  return withWriteTx(async () => {
    await db.runAsync(`UPDATE league_markets SET state='closed', closed_at=datetime('now') WHERE id=? AND state='open'`, [marketId]);
  });
}

/** Pay winners at the cap-aware pool price; idempotent once settled. */
async function settleMarket(marketId, winnerTeamId) {
  return withWriteTx(async () => {
    const m = await db.getAsync('SELECT * FROM league_markets WHERE id = ?', [marketId]);
    if (!m || m.state === 'void' || m.state === 'settled') return { settled: 0 };
    if (winnerTeamId !== m.team1_id && winnerTeamId !== m.team2_id) return { settled: 0 };
    const rates = liveMarkets.sideRates(m, await liveMarkets.houseBankrollCents());
    const rate = winnerTeamId === m.team1_id ? rates.p1 : rates.p2;
    const bets = await db.allAsync(`SELECT * FROM league_bets WHERE market_id = ? AND state = 'placed'`, [marketId]);
    for (const bet of bets) {
      if (bet.picked_team_id === winnerTeamId) {
        const payout = Math.round(bet.amount_cents * rate);
        await db.runAsync(`UPDATE league_bets SET state='won', payout_cents=? WHERE id=?`, [payout, bet.id]);
        await wallet.applyCredit(bet.user_id, payout, 'bet_payout', { type: 'league_bet', id: bet.id });
      } else {
        await db.runAsync(`UPDATE league_bets SET state='lost', payout_cents=0 WHERE id=?`, [bet.id]);
      }
    }
    await db.runAsync(
      `UPDATE league_markets SET state='settled', winner_team_id=?, p1_live_odds=?, p2_live_odds=?, settled_at=datetime('now') WHERE id=?`,
      [winnerTeamId, rates.p1, rates.p2, marketId]);
    if (bets.length) liveMarkets.invalidateBankrollCache();
    return { settled: bets.length };
  });
}

/** Refund every placed stake; never touches a settled market. */
async function voidMarket(marketId) {
  return withWriteTx(async () => {
    const m = await db.getAsync('SELECT * FROM league_markets WHERE id = ?', [marketId]);
    if (!m || m.state === 'settled') return { refunded: 0 };
    const bets = await db.allAsync(`SELECT * FROM league_bets WHERE market_id = ? AND state = 'placed'`, [marketId]);
    for (const bet of bets) {
      await wallet.applyCredit(bet.user_id, bet.amount_cents, 'refund', { type: 'league_bet', id: bet.id });
      await db.runAsync(`UPDATE league_bets SET state='refunded', payout_cents=? WHERE id=?`, [bet.amount_cents, bet.id]);
    }
    if (m.state !== 'void') await db.runAsync(`UPDATE league_markets SET state='void', settled_at=datetime('now') WHERE id=?`, [marketId]);
    return { refunded: bets.length };
  });
}

/**
 * Bring one match's market in line with the match row. `stats` maps team id
 * -> {pf, pa} for pricing. Returns what it did, for the sync log.
 */
async function reconcileMatchMarket(match, stats, now = Date.now()) {
  let market = await activeMarketForMatch(match.id);
  if (market && market.state !== 'settled'
      && (market.team1_id !== match.team1_id || market.team2_id !== match.team2_id)) {
    // Liquipedia changed who plays - never grade old picks on a new pairing.
    // Falls through: an unfinished match reopens below with the new teams.
    await voidMarket(market.id);
    market = null;
  }
  if (match.finished) {
    if (!market || market.state === 'settled') return null;
    if (match.winner_team_id) { await settleMarket(market.id, match.winner_team_id); return 'settled'; }
    await voidMarket(market.id); return 'voided';
  }
  if (isLocked(match.lock_at, now)) {
    if (market && market.state === 'open') { await closeMarket(market.id); return 'closed'; }
    return null;
  }
  if (!match.team1_id || !match.team2_id) return null;
  const { p1, p2 } = openingProbabilities(stats[match.team1_id], stats[match.team2_id]);
  if (!market) { await openMarket({ matchId: match.id, team1Id: match.team1_id, team2Id: match.team2_id, p1, p2 }); return 'opened'; }
  if (await refreshUnbetMarket(market.id, p1, p2)) return 'repriced';
  return null;
}

// ---- bets -----------------------------------------------------------------

async function placeBet({ userId, marketId, teamId, amountCents }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw err('BAD_AMOUNT', 'amountCents must be a positive integer');
  return withWriteTx(async () => {
    const m = await db.getAsync(
      `SELECT lm.*, mt.lock_at FROM league_markets lm JOIN league_matches mt ON mt.id = lm.match_id WHERE lm.id = ?`, [marketId]);
    if (!m) throw err('NOT_FOUND', 'Market not found');
    if (effectiveState(m, m.lock_at) !== 'open') throw err('MARKET_CLOSED', 'Market is not open for picks');
    const lockedOdds = teamId === m.team1_id ? m.p1_live_odds : teamId === m.team2_id ? m.p2_live_odds : null;
    if (lockedOdds == null) throw err('BAD_TEAM', 'Team is not in this match');
    economy.assertBetWithinLimits(amountCents, await wallet.getBalance(userId));
    const ins = await db.runAsync(
      `INSERT INTO league_bets (user_id, market_id, picked_team_id, amount_cents, locked_odds, state) VALUES (?, ?, ?, ?, ?, 'placed')`,
      [userId, marketId, teamId, amountCents, lockedOdds]);
    await wallet.applyDebit(userId, amountCents, 'bet_stake', { type: 'league_bet', id: ins.lastID });
    const col = teamId === m.team1_id ? 'p1_pool_cents' : 'p2_pool_cents';
    await db.runAsync(`UPDATE league_markets SET ${col} = ${col} + ? WHERE id = ?`, [amountCents, marketId]);
    const odds = await repriceInTx(marketId);
    return { betId: ins.lastID, lockedOdds, odds, balanceCents: await wallet.getBalance(userId) };
  });
}

async function cancelBet(userId, betId) {
  return withWriteTx(async () => {
    const bet = await db.getAsync('SELECT * FROM league_bets WHERE id = ?', [betId]);
    if (!bet) throw err('NOT_FOUND', 'Pick not found');
    if (bet.user_id !== userId) throw err('FORBIDDEN', 'Not your pick');
    if (bet.state !== 'placed') throw err('NOT_CANCELLABLE', 'Pick is no longer cancellable');
    const m = await db.getAsync(
      `SELECT lm.*, mt.lock_at FROM league_markets lm JOIN league_matches mt ON mt.id = lm.match_id WHERE lm.id = ?`, [bet.market_id]);
    if (!m || effectiveState(m, m.lock_at) !== 'open') throw err('MARKET_LOCKED', 'This match is locked');
    await wallet.applyCredit(userId, bet.amount_cents, 'refund', { type: 'league_bet', id: bet.id });
    await db.runAsync(`UPDATE league_bets SET state='refunded', payout_cents=? WHERE id=?`, [bet.amount_cents, bet.id]);
    const col = bet.picked_team_id === m.team1_id ? 'p1_pool_cents' : 'p2_pool_cents';
    await db.runAsync(`UPDATE league_markets SET ${col} = MAX(0, ${col} - ?) WHERE id = ?`, [bet.amount_cents, m.id]);
    await repriceInTx(m.id);
    return { balanceCents: await wallet.getBalance(userId) };
  });
}

// ---- reads ----------------------------------------------------------------

const logoUrl = (teamId, hasLogo) => (hasLogo ? `/api/leagues/team-logo/${teamId}` : null);

function seasonStatus(s, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (!s.start_date || s.start_date > today) return 'upcoming';
  if (s.open_matches > 0 || (s.end_date && s.end_date >= today)) return 'live';
  return 'complete';
}

async function listSeasons() {
  const rows = await db.allAsync(`
    SELECT s.*,
      (SELECT COUNT(*) FROM league_teams t WHERE t.season_id = s.id) AS team_count,
      (SELECT COUNT(*) FROM league_matches m WHERE m.season_id = s.id AND m.last_seen_at >= s.synced_at AND m.finished = 0) AS open_matches,
      (SELECT MIN(m.match_date) FROM league_matches m WHERE m.season_id = s.id AND m.last_seen_at >= s.synced_at AND m.finished = 0) AS next_match_date,
      (SELECT COUNT(*) FROM league_markets lm JOIN league_matches m ON m.id = lm.match_id
         WHERE m.season_id = s.id AND lm.state = 'open' AND m.lock_at > ?) AS bettable
    FROM league_seasons s ORDER BY s.start_date DESC`, [new Date().toISOString()]);
  const statusRank = { live: 0, upcoming: 1, complete: 2 };
  return rows.map((s) => ({
    slug: s.slug, name: s.name, shortName: s.short_name, region: s.region, game: s.game_name,
    startDate: s.start_date, endDate: s.end_date, teamCount: s.team_count,
    nextMatchDate: s.next_match_date, bettable: s.bettable, status: seasonStatus(s),
    liquipediaUrl: `https://liquipedia.net/fighters/${s.liquipedia_page}`,
  })).sort((a, b) => statusRank[a.status] - statusRank[b.status] || (b.startDate || '').localeCompare(a.startDate || ''));
}

// Regular-season table per division, from match results: league points are
// the summed team-match scores (how SFL ranks), then match wins, then diff.
function standingsFrom(teams, matches) {
  const row = new Map(teams.map((t) => [t.id, { teamId: t.id, division: t.division, played: 0, wins: 0, losses: 0, pf: 0, pa: 0 }]));
  for (const m of matches) {
    if (!m.finished || !/regular/i.test(m.stage || '') || m.team1_score == null) continue;
    for (const [id, f, a, won] of [[m.team1_id, m.team1_score, m.team2_score, m.winner_team_id === m.team1_id],
      [m.team2_id, m.team2_score, m.team1_score, m.winner_team_id === m.team2_id]]) {
      const r = row.get(id); if (!r) continue;
      r.played += 1; r.pf += f; r.pa += a;
      if (won) r.wins += 1; else if (m.winner_team_id) r.losses += 1;
    }
  }
  const groups = new Map();
  for (const r of row.values()) {
    if (!r.played && !matches.some((m) => /regular/i.test(m.stage || '') && (m.team1_id === r.teamId || m.team2_id === r.teamId))) continue;
    const key = r.division || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([division, rows]) => ({
    division: division || null,
    rows: rows.sort((a, b) => b.pf - a.pf || b.wins - a.wins || (b.pf - b.pa) - (a.pf - a.pa))
      .map((r, i) => ({ ...r, rank: i + 1, diff: r.pf - r.pa })),
  }));
}

async function getSeason(slug, now = Date.now()) {
  const s = await db.getAsync('SELECT * FROM league_seasons WHERE slug = ?', [slug]);
  if (!s) return null;
  const teams = await db.allAsync(
    `SELECT t.*, (SELECT 1 FROM league_team_logos l WHERE l.team_id = t.id AND l.data IS NOT NULL) AS has_logo
     FROM league_teams t WHERE t.season_id = ? ORDER BY t.name`, [s.id]);
  const matches = await db.allAsync(
    `SELECT * FROM league_matches WHERE season_id = ? AND last_seen_at >= ? ORDER BY sort_order`, [s.id, s.synced_at || '']);
  const markets = await db.allAsync(
    `SELECT lm.* FROM league_markets lm JOIN league_matches m ON m.id = lm.match_id
     WHERE m.season_id = ? AND lm.state != 'void' ORDER BY lm.id`, [s.id]);
  const marketByMatch = new Map(markets.map((mk) => [mk.match_id, mk])); // newest wins (ORDER BY id)
  const counts = await db.allAsync(
    `SELECT b.market_id, COUNT(*) AS n FROM league_bets b JOIN league_markets lm ON lm.id = b.market_id
     JOIN league_matches m ON m.id = lm.match_id WHERE m.season_id = ? AND b.state != 'refunded' GROUP BY b.market_id`, [s.id]);
  const pickCount = new Map(counts.map((c) => [c.market_id, c.n]));

  const photoId = new Map((await db.allAsync('SELECT id, page FROM league_player_photos WHERE data IS NOT NULL')).map((r) => [r.page, r.id]));
  const withPhoto = (p) => ({ ...p, photoUrl: p.page && photoId.has(p.page) ? `/api/leagues/player-photo/${photoId.get(p.page)}` : null });
  const teamOut = teams.map((t) => {
    const roster = t.roster_json ? JSON.parse(t.roster_json) : { players: [], staff: [] };
    return { id: t.id, name: t.name, shortName: t.short_name, division: t.division,
      logoUrl: logoUrl(t.id, t.has_logo), players: (roster.players || []).map(withPhoto), staff: roster.staff || [] };
  });
  const matchOut = matches.map((m) => {
    const mk = marketByMatch.get(m.id);
    return {
      id: m.id, stage: m.stage, round: m.round_label, division: m.division, date: m.match_date,
      lockAt: m.lock_at, bestOf: m.best_of, team1Id: m.team1_id, team2Id: m.team2_id,
      score1: m.team1_score, score2: m.team2_score, winnerTeamId: m.winner_team_id, finished: !!m.finished,
      sets: m.sets_json ? JSON.parse(m.sets_json) : [],
      market: mk ? {
        id: mk.id, state: effectiveState(mk, m.lock_at, now), team1Odds: mk.p1_live_odds, team2Odds: mk.p2_live_odds,
        poolCents: mk.p1_pool_cents + mk.p2_pool_cents, picks: pickCount.get(mk.id) || 0, winnerTeamId: mk.winner_team_id,
      } : null,
    };
  });
  return {
    slug: s.slug, name: s.name, shortName: s.short_name, region: s.region, game: s.game_name,
    startDate: s.start_date, endDate: s.end_date, syncedAt: s.synced_at,
    liquipediaUrl: `https://liquipedia.net/fighters/${s.liquipedia_page}`,
    teams: teamOut, matches: matchOut, standings: standingsFrom(teams, matches),
  };
}

async function getUserBets(userId) {
  return db.allAsync(
    `SELECT b.id, b.market_id AS marketId, b.picked_team_id AS pickedTeamId, b.amount_cents AS amountCents,
            b.locked_odds AS lockedOdds, b.state, b.payout_cents AS payoutCents, b.created_at AS createdAt,
            lm.state AS marketState, m.lock_at AS lockAt, m.id AS matchId, m.round_label AS round, m.match_date AS date,
            s.slug AS seasonSlug, s.short_name AS seasonName,
            pt.name AS pickedName, t1.name AS team1Name, t2.name AS team2Name
     FROM league_bets b
     JOIN league_markets lm ON lm.id = b.market_id
     JOIN league_matches m ON m.id = lm.match_id
     JOIN league_seasons s ON s.id = m.season_id
     LEFT JOIN league_teams pt ON pt.id = b.picked_team_id
     LEFT JOIN league_teams t1 ON t1.id = lm.team1_id
     LEFT JOIN league_teams t2 ON t2.id = lm.team2_id
     WHERE b.user_id = ? ORDER BY b.id DESC`, [userId]);
}

module.exports = {
  openingProbabilities, effectiveState, isLocked,
  openMarket, closeMarket, settleMarket, voidMarket, refreshUnbetMarket, reconcileMatchMarket,
  placeBet, cancelBet, listSeasons, getSeason, getUserBets, standingsFrom,
};
