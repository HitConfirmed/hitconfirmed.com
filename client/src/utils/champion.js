// Who won a game's bracket, from its settled markets - or null when unknown.
//
// - A settled Grand Final Reset decides the title outright.
// - Otherwise the settled Grand Final does, UNLESS its real reset was voided
//   (server flag gf_reset_voided): the reset only exists because the
//   losers-side player won the GF, so with the reset abandoned the title was
//   never decided and crowning the GF winner would be wrong.
const isReset = (m) => /grand.final.reset/i.test(m.round_text || '');
const isGrandFinal = (m) => /grand.final/i.test(m.round_text || '') && !isReset(m);

export function championMarket(mkts) {
  const settled = (mkts || []).filter((m) => m.state === 'settled');
  const reset = settled.find(isReset);
  if (reset) return reset;
  const gf = settled.find(isGrandFinal);
  if (!gf || gf.gf_reset_voided) return null;
  return gf;
}

export function championName(mkts) {
  const m = championMarket(mkts);
  if (!m) return null;
  return m.winner_id === m.player1_id ? m.player1_name : m.player2_name;
}
