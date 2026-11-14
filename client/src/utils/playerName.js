// Start.gg tags carry "TEAM | gamerTag" (English) or "日本語名/RomanTag" (Japanese).
// Nested team prefixes ("TM | RB | Arslan Ash") are also common: take the first
// segment as the sponsor label and the LAST segment as the gamerTag so intermediate
// org tiers don't bleed through as a visible pipe in the name.
// For /, only treat it as a separator when the left side contains Japanese/CJK characters —
// otherwise "/" is two players on a 2v2 team (e.g. 2XKO) and should stay intact.
// A SPACED " / " is a doubles/2v2 team ("トール / Sawstep" - start.gg's auto
// team names), never a single player's dual-script tag, which is written
// without spaces ("きんちょ/kintyo"). Real case: Port Priority DX's Rivals
// doubles showed teammate トール as Sawstep's grey "sponsor" label.
const isTeamName = (s) => / \/ /.test(s);
const hasJapanese = (s) => /[぀-ヿ一-鿿＀-￯]/.test(s);

// "日本語名/RomanTag" -> "RomanTag"; anything else passes through unchanged.
// Used once a sponsor label already occupies the secondary-text slot, so a
// tag never ends up showing two scripts stacked together.
const romanize = (s) => {
  if (isTeamName(s)) return s;
  const si = s.indexOf('/');
  return si !== -1 && hasJapanese(s.slice(0, si)) ? s.slice(si + 1).trim() : s;
};

export const splitPlayerName = (name) => {
  if (!name) return { sponsor: '', tag: name };
  const pi = name.indexOf('|');
  if (pi !== -1) {
    const sponsor = name.slice(0, pi).trim();
    const rest = name.slice(pi + 1).trim();
    // Nested prefixes: take only the segment after the last pipe as the gamerTag
    const lastPipe = rest.lastIndexOf('|');
    const tag = lastPipe !== -1 ? rest.slice(lastPipe + 1).trim() : rest;
    return { sponsor, tag: romanize(tag) };
  }
  const si = name.indexOf('/');
  if (si !== -1 && !isTeamName(name) && hasJapanese(name.slice(0, si))) {
    return { sponsor: name.slice(0, si).trim(), tag: name.slice(si + 1).trim() };
  }
  return { sponsor: '', tag: name };
};

export const shortPlayerName = (name) => splitPlayerName(name).tag || name;
