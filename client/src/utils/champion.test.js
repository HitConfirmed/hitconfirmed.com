import { championName } from './champion';

const gf = (o = {}) => ({ round_text: 'Grand Final', state: 'settled', player1_id: 1, player2_id: 2, player1_name: 'Winners', player2_name: 'Losers', winner_id: 1, ...o });

test('sole Grand Final crowns its winner', () => {
  expect(championName([gf()])).toBe('Winners');
});

test('a settled reset decides the title even if listed after the GF', () => {
  const reset = gf({ round_text: 'Grand Final Reset', winner_id: 1 });
  expect(championName([gf({ winner_id: 2 }), reset])).toBe('Winners');
});

test('no champion when the GF reset was voided (Saltmine EU West Finals)', () => {
  expect(championName([gf({ winner_id: 2, gf_reset_voided: 1 })])).toBeNull();
});
