import { splitPlayerName } from './playerName';

test('sponsor pipe: first segment is the sponsor, last is the tag', () => {
  expect(splitPlayerName('TM | Arslan Ash')).toEqual({ sponsor: 'TM', tag: 'Arslan Ash' });
  expect(splitPlayerName('TM | RB | Arslan Ash')).toEqual({ sponsor: 'TM', tag: 'Arslan Ash' });
});

test('single player Japanese/Roman tag (no spaces) shows the Roman tag with the Japanese above', () => {
  expect(splitPlayerName('きんちょ/kintyo')).toEqual({ sponsor: 'きんちょ', tag: 'kintyo' });
  expect(splitPlayerName('BUZZ | たいけい/Taikei')).toEqual({ sponsor: 'BUZZ', tag: 'Taikei' });
});

test('doubles team names (spaced " / ") stay intact even with a Japanese teammate', () => {
  // Real case: Port Priority DX Rivals of Aether II Doubles - teammate トール
  // was shown as Sawstep's grey sponsor label.
  expect(splitPlayerName('トール / Sawstep')).toEqual({ sponsor: '', tag: 'トール / Sawstep' });
  expect(splitPlayerName('Mr. Nice Guy / elkiies')).toEqual({ sponsor: '', tag: 'Mr. Nice Guy / elkiies' });
  expect(splitPlayerName('たいけい/Taikei / Sonix')).toEqual({ sponsor: '', tag: 'たいけい/Taikei / Sonix' });
});
