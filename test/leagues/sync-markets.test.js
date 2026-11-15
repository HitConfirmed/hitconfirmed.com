const { test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { matchList, teamCard, seasonPage } = require('./fixtures');

// End-to-end over a temp DB: Liquipedia pages -> league_* rows -> market
// lifecycle -> real wallet movements. The money rules under test:
//   picks lock at match-day midnight even if the sync hasn't run since;
//   a win pays from the pool, a loss pays nothing, a tie refunds;
//   a slot whose teams change, or a match that vanishes, refunds;
//   a stage page that fails to load changes nothing.
let db, sync, mk, wallet, lm, file;
const PAGE = 'Street_Fighter_League/Japan/2026';
const CFG = { slug: 'sfl-japan-2026', name: 'SFL Japan 2026', shortName: 'SFL Japan', region: 'Japan', gameName: 'Street Fighter 6', page: PAGE, tzOffsetHours: 9 };
const START = 1_000_000;
const NOW = Date.parse('2026-11-14T12:00:00Z');

before(async () => {
  file = path.join(os.tmpdir(), `mm-leagues-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DATABASE_PATH = file;
  for (const m of ['../../db/db', '../../txn', '../../wallet', '../../economy', '../../liveOdds', '../../liveMarkets',
    '../../leagues/markets', '../../leagues/sync']) delete require.cache[require.resolve(m)];
  db = require('../../db/db');
  wallet = require('../../wallet');
  lm = require('../../liveMarkets');
  mk = require('../../leagues/markets');
  sync = require('../../leagues/sync');
  await db.runAsync('CREATE TABLE users (id INTEGER PRIMARY KEY, balance_cents INTEGER NOT NULL DEFAULT 0)');
  await db.runAsync(`CREATE TABLE wallet_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount_cents INTEGER,
    type TEXT, ref_type TEXT, ref_id INTEGER, created_at TEXT DEFAULT (datetime('now')))`);
  await db.runAsync('CREATE TABLE set_bets (id INTEGER PRIMARY KEY, amount_cents INTEGER, payout_cents INTEGER, state TEXT)');
});

beforeEach(async () => {
  for (const t of ['league_bets', 'league_markets', 'league_matches', 'league_teams', 'league_team_logos', 'league_seasons', 'wallet_transactions', 'users']) {
    await db.runAsync(`DELETE FROM ${t}`);
  }
  await db.runAsync('INSERT INTO users (id, balance_cents) VALUES (1, ?), (2, ?)', [START, START]);
  lm.invalidateBankrollCache();
  Date.now = () => NOW; // bets check lock_at against the clock
});

const realDateNow = Date.now;
afterEach(() => { Date.now = realDateNow; });

after(() => { try { fs.unlinkSync(file); } catch { /* ignore */ } });

const RC = ['REJECT', 'RC'], OJA = ['Nagoya OJA', 'OJA'], G8S = ['Good 8 Squad', 'G8S'], DFM = ['DetonatioN FocusMe', 'DFM'];
const cards = [teamCard('REJECT', ['Daigo', 'Fuudo']), teamCard('Nagoya OJA', ['Seiya']), teamCard('Good 8 Squad', ['Kawano']), teamCard('DetonatioN FocusMe', ['Itabashi Zangief'])];

// Week 1 is played; week 10 (Dec 11, JST) is open for picks.
function pages({ week10 = [{ t1: OJA, t2: RC, date: 'December 11, 2026' }], extra = [], failRegular = false } = {}) {
  const regular = `<h2>Details</h2><h3>Division F</h3>${matchList('Week 1', [
    { t1: RC, t2: OJA, s1: 40, s2: 0, winner: 1, date: 'August 26, 2026', finished: true },
    { t1: G8S, t2: DFM, s1: 10, s2: 30, winner: 2, date: 'August 26, 2026', finished: true },
  ])}${matchList('Week 10', [...week10, ...extra])}`;
  const map = { [PAGE]: seasonPage(PAGE, cards, ['Regular_Season']), [`${PAGE}/Regular_Season`]: regular };
  return async (p) => {
    if (failRegular && p.endsWith('/Regular_Season')) throw new Error('HTTP 503');
    if (!(p in map)) throw new Error(`missing ${p}`);
    return map[p];
  };
}
const run = (fetchPage, now = NOW) => sync.syncSeason(CFG, { fetchPage, fetchImage: async () => ({ contentType: 'image/png', data: Buffer.from('png') }), imageGapMs: 0, query: async () => ({ query: { pages: {} } }), apiGapMs: 0, now });
const week10Market = async () => (await mk.getSeason(CFG.slug, NOW)).matches.find((m) => m.round === 'Week 10' && m.market);
const teamId = async (name) => (await db.getAsync('SELECT id FROM league_teams WHERE name = ?', [name])).id;
const balance = (u) => wallet.getBalance(u);

test('sync builds the season: teams, rosters, standings, a market locking at JST midnight', async () => {
  const r = await run(pages());
  assert.strictEqual(r.matches, 3);
  assert.deepStrictEqual(r.markets, { opened: 1 });
  const s = await mk.getSeason(CFG.slug, NOW);
  assert.strictEqual(s.teams.length, 4);
  assert.deepStrictEqual(s.teams.find((t) => t.name === 'REJECT').players.map((p) => p.name), ['Daigo', 'Fuudo']);
  assert.strictEqual(s.teams.find((t) => t.name === 'REJECT').division, 'Division F');
  const top = s.standings[0].rows[0];
  assert.strictEqual(top.teamId, await teamId('REJECT'));
  assert.deepStrictEqual([top.wins, top.losses, top.pf, top.diff], [1, 0, 40, 40]);
  const m = await week10Market();
  assert.strictEqual(m.lockAt, '2026-12-10T15:00:00.000Z'); // Dec 11 00:00 JST
  assert.strictEqual(m.market.state, 'open');
  // REJECT won week 1 40:0, so it opens as the favourite (team2 here).
  assert.ok(m.market.team2Odds < m.market.team1Odds);
});

test('win pays from the pool, loss pays nothing, money is conserved', async () => {
  await run(pages());
  const m = await week10Market();
  const rc = await teamId('REJECT'), oja = await teamId('Nagoya OJA');
  await mk.placeBet({ userId: 1, marketId: m.market.id, teamId: rc, amountCents: 10000 });
  await mk.placeBet({ userId: 2, marketId: m.market.id, teamId: oja, amountCents: 10000 });
  assert.strictEqual(await balance(1), START - 10000);

  await run(pages({ week10: [{ t1: OJA, t2: RC, s1: 10, s2: 30, winner: 2, date: 'December 11, 2026', finished: true }] }), Date.parse('2026-12-12T00:00:00Z'));
  const b1 = await balance(1), b2 = await balance(2);
  assert.strictEqual(b2, START - 10000);
  assert.ok(b1 > START, 'winner is paid more than their stake back');
  // Parimutuel with zero house bankroll: total paid out never exceeds total staked.
  assert.ok(b1 + b2 <= 2 * START);
  const bets = await mk.getUserBets(1);
  assert.strictEqual(bets[0].state, 'won');
});

test('picks lock at lock time even before the next sync closes the market', async () => {
  await run(pages());
  const m = await week10Market();
  const rc = await teamId('REJECT');
  Date.now = () => Date.parse('2026-12-10T15:00:01Z');
  await assert.rejects(mk.placeBet({ userId: 1, marketId: m.market.id, teamId: rc, amountCents: 1000 }), { code: 'MARKET_CLOSED' });
});

test('cancel before lock refunds; a tied (no-winner) match refunds', async () => {
  await run(pages());
  const m = await week10Market();
  const rc = await teamId('REJECT');
  const { betId } = await mk.placeBet({ userId: 1, marketId: m.market.id, teamId: rc, amountCents: 5000 });
  await mk.cancelBet(1, betId);
  assert.strictEqual(await balance(1), START);

  await mk.placeBet({ userId: 1, marketId: m.market.id, teamId: rc, amountCents: 5000 });
  await run(pages({ week10: [{ t1: OJA, t2: RC, s1: 10, s2: 10, winner: null, date: 'December 11, 2026', finished: true }] }), Date.parse('2026-12-12T00:00:00Z'));
  assert.strictEqual(await balance(1), START);
  assert.strictEqual((await mk.getUserBets(1))[0].state, 'refunded');
});

test('teams changing in a slot voids the old market and opens a new one', async () => {
  await run(pages());
  const m = await week10Market();
  await mk.placeBet({ userId: 1, marketId: m.market.id, teamId: await teamId('REJECT'), amountCents: 5000 });
  const r = await run(pages({ week10: [{ t1: G8S, t2: DFM, date: 'December 11, 2026' }] }));
  assert.deepStrictEqual(r.markets, { opened: 1 });
  assert.strictEqual(await balance(1), START);
  const now = await week10Market();
  assert.notStrictEqual(now.market.id, m.market.id);
  assert.strictEqual(now.team1Id, await teamId('Good 8 Squad'));
});

test('a vanished match refunds; a failed stage fetch changes nothing', async () => {
  await run(pages({ extra: [{ t1: G8S, t2: DFM, date: 'December 11, 2026' }] }));
  const s = await mk.getSeason(CFG.slug, NOW);
  const extra = s.matches.find((x) => x.round === 'Week 10' && x.team1Id === (s.teams.find((t) => t.name === 'Good 8 Squad').id));
  await mk.placeBet({ userId: 2, marketId: extra.market.id, teamId: extra.team1Id, amountCents: 4000 });

  // Stage page down: market untouched, match still listed.
  await run(pages({ extra: [{ t1: G8S, t2: DFM, date: 'December 11, 2026' }], failRegular: true }));
  assert.strictEqual(await balance(2), START - 4000);
  assert.strictEqual((await mk.getSeason(CFG.slug, NOW)).matches.length, 4);

  // Page loads without that match: refund.
  const r = await run(pages());
  assert.deepStrictEqual(r.markets, { voided: 1 });
  assert.strictEqual(await balance(2), START);
  assert.strictEqual((await mk.getSeason(CFG.slug, NOW)).matches.length, 3);
});

test('bet limits and validation', async () => {
  await run(pages());
  const m = await week10Market();
  await assert.rejects(mk.placeBet({ userId: 1, marketId: m.market.id, teamId: 999999, amountCents: 1000 }), { code: 'BAD_TEAM' });
  await assert.rejects(mk.placeBet({ userId: 1, marketId: m.market.id, teamId: await teamId('REJECT'), amountCents: START }), { code: 'ABOVE_CAP' });
  await assert.rejects(mk.placeBet({ userId: 1, marketId: 424242, teamId: 1, amountCents: 1000 }), { code: 'NOT_FOUND' });
});
