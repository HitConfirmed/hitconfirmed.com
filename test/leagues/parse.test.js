const { test } = require('node:test');
const assert = require('node:assert');
const { parseLongDate, findSubpages, parseTeams, parseMatches } = require('../../leagues/parse');
const { matchList, teamCard, seasonPage } = require('./fixtures');

const PAGE = 'Street_Fighter_League/Japan/2026';

test('parseLongDate', () => {
  assert.strictEqual(parseLongDate('August 25, 2026'), '2026-08-25');
  assert.strictEqual(parseLongDate('December 1, 2026'), '2026-12-01');
  assert.strictEqual(parseLongDate('TBD'), null);
});

test('findSubpages keeps real subpages, skips red links', () => {
  const html = seasonPage(PAGE, [], ['Regular_Season', 'Playoffs']);
  assert.deepStrictEqual(findSubpages(html, PAGE).sort(), ['Playoffs', 'Regular_Season']);
});

test('parseTeams splits players from staff', () => {
  const html = seasonPage(PAGE, [teamCard('REJECT', ['Daigo', 'Fuudo']), teamCard('ZETA DIVISION', ['MenaRD', 'Higuchi'], ['Jazzy'])], []);
  const teams = parseTeams(html);
  assert.strictEqual(teams.length, 2);
  assert.deepStrictEqual(teams[0].players.map((p) => p.name), ['Daigo', 'Fuudo']);
  assert.deepStrictEqual(teams[1].players.map((p) => p.name), ['MenaRD', 'Higuchi']);
  assert.deepStrictEqual(teams[1].staff.map((p) => p.name), ['Jazzy']);
  assert.match(teams[0].logoUrl, /^https:\/\/liquipedia\.net\/commons\//);
});

test('parseMatches: results, upcoming, TBD, divisions and round labels', () => {
  const html = `<h2>Details</h2><h3>Division S</h3>${matchList('Week 1', [
    { t1: ['IBUSHIGIN', 'IBSG'], t2: ['FAV gaming', 'FAV'], s1: 20, s2: 30, winner: 2, date: 'August 25, 2026', bo: 'Bo4', finished: true,
      sets: [['Yanai', 0, 2, 'Fujimura'], ['Torimeshi', 1, 2, 'Ryukichi']] },
  ])}${matchList('Week 10', [
    { t1: ['Crazy Raccoon', 'CR'], t2: ['Team iXA', 'iXA'], date: 'December 8, 2026' },
  ])}<h3>Semifinals</h3>${matchList('Match List', [{ t1: ['REJECT', 'RC'], t2: null, date: 'January 5, 2027' }])}`;
  const ms = parseMatches(html, { stage: 'Regular Season' });
  assert.strictEqual(ms.length, 3);
  const [done, next, tbd] = ms;
  assert.strictEqual(done.roundLabel, 'Week 1');
  assert.strictEqual(done.division, 'Division S');
  assert.strictEqual(done.team1.key, 'IBUSHIGIN');
  assert.strictEqual(done.team1.shortName, 'IBSG');
  assert.deepStrictEqual([done.score1, done.score2, done.winner, done.finished], [20, 30, 2, true]);
  assert.strictEqual(done.bestOf, 'Bo4');
  assert.deepStrictEqual(done.sets[0], { p1: 'Yanai', p2: 'Fujimura', s1: 0, s2: 2 });
  assert.deepStrictEqual([next.score1, next.winner, next.finished, next.date], [null, null, false, '2026-12-08']);
  assert.strictEqual(tbd.roundLabel, 'Semifinals'); // generic "Match List" falls back to the heading
  assert.strictEqual(tbd.division, null);
  assert.strictEqual(tbd.team2.key, null);
  assert.deepStrictEqual([done.listIdx, next.listIdx, tbd.listIdx], [0, 1, 2]);
});
