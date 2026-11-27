const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// matchPhase: when a league match shows as LIVE / match day. Display and
// sync cadence only - nothing here touches money.
let mk, file;
before(() => {
  file = path.join(os.tmpdir(), `mm-league-phase-${process.pid}.db`);
  process.env.DATABASE_PATH = file;
  for (const m of ['../../db/db', '../../leagues/markets']) delete require.cache[require.resolve(m)];
  mk = require('../../leagues/markets');
});
after(() => { try { fs.unlinkSync(file); } catch { /* ignore */ } });

const JST = 9;
// Nov 27 JST match with no kickoff time: lock is 00:00 JST = Nov 26 15:00Z.
const base = { match_date: '2026-11-27', lock_at: '2026-11-26T15:00:00.000Z', finished: 0, team1_score: null, team2_score: null, sets_json: null };
const at = (iso) => Date.parse(iso);

test('match day with nothing posted yet is "today", not live', () => {
  assert.strictEqual(mk.matchPhase(base, JST, at('2026-11-27T03:00:00Z')), 'today');
});

test('sets or a team score on match day mean it is live', () => {
  const now = at('2026-11-27T11:00:00Z');
  assert.strictEqual(mk.matchPhase({ ...base, sets_json: '[{"p1":"A","p2":"B","s1":2,"s2":1}]' }, JST, now), 'live');
  assert.strictEqual(mk.matchPhase({ ...base, team1_score: 10, team2_score: 0 }, JST, now), 'live');
  // Late-night overrun past local midnight still counts.
  assert.strictEqual(mk.matchPhase({ ...base, team1_score: 10, team2_score: 0 }, JST, at('2026-11-27T16:00:00Z')), 'live');
});

test('a real kickoff time makes it live once started, for a few hours', () => {
  const m = { ...base, lock_at: '2026-11-27T10:00:00.000Z' };
  assert.strictEqual(mk.matchPhase(m, JST, at('2026-11-27T09:00:00Z')), 'today');
  assert.strictEqual(mk.matchPhase(m, JST, at('2026-11-27T11:00:00Z')), 'live');
});

test('finished, other days and stale scores are not live', () => {
  assert.strictEqual(mk.matchPhase({ ...base, finished: 1, team1_score: 30, team2_score: 10 }, JST, at('2026-11-27T11:00:00Z')), null);
  assert.strictEqual(mk.matchPhase(base, JST, at('2026-11-25T11:00:00Z')), null);
  assert.strictEqual(mk.matchPhase({ ...base, team1_score: 0, team2_score: 0 }, JST, at('2026-11-30T11:00:00Z')), null);
});
