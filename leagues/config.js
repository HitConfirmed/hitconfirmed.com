// Team-league seasons tracked from Liquipedia (fighters wiki). Each entry is
// one season page; its Regular_Season / Playoffs / Bracket subpages are found
// from the page's own links at sync time, so a playoff page that doesn't exist
// yet is picked up automatically once Liquipedia publishes it.
//
// tzOffsetHours: Liquipedia only lists a match DATE for these leagues (no
// kickoff time), so picks lock at 00:00 on match day in this offset - the
// league's broadcast time zone, or the earliest plausible one when unsure.
// Locking early is the safe direction: nobody can bet once a match may have
// started.
//
// To add a league/season: append an entry and redeploy. Nothing else needed.
const LEAGUE_SEASONS = [
  {
    slug: 'sfl-japan-2026',
    name: 'Street Fighter League: JAPAN 2026',
    shortName: 'SFL Japan',
    region: 'Japan',
    gameName: 'Street Fighter 6',
    page: 'Street_Fighter_League/Japan/2026',
    tzOffsetHours: 9,
  },
  {
    slug: 'sfl-americas-2026',
    name: 'Street Fighter League: AMERICAS 2026',
    shortName: 'SFL Americas',
    region: 'Americas',
    gameName: 'Street Fighter 6',
    page: 'Street_Fighter_League/Americas/2026',
    tzOffsetHours: -5,
  },
  {
    slug: 'sfl-emeaa-2026',
    name: 'Street Fighter League: EMEAA 2026',
    shortName: 'SFL EMEAA',
    region: 'EMEAA',
    gameName: 'Street Fighter 6',
    page: 'Street_Fighter_League/EMEAA/2026',
    tzOffsetHours: 4,
  },
  {
    slug: 'sfl-world-championship-2026',
    name: 'Street Fighter League: World Championship 2026',
    shortName: 'SFL World Championship',
    region: 'World',
    gameName: 'Street Fighter 6',
    page: 'Street_Fighter_League/World_Championship/2026',
    tzOffsetHours: 9,
  },
];

module.exports = { LEAGUE_SEASONS };
