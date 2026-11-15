// Pure HTML -> data parsing for Liquipedia team-league pages (Street Fighter
// League and anything else built from the same match-list templates). No DB,
// no network: leagues/sync.js fetches the pages and feeds them in here.
//
// Two page shapes:
//  - the season page (e.g. Street_Fighter_League/Japan/2026): team cards with
//    rosters (.team-participant-card) and links to its subpages;
//  - stage subpages (/Regular_Season, /Playoffs, ...): .brkts-matchlist
//    blocks, one per week/day/round, each holding team-vs-team matches with a
//    popup that carries the date, the team score and every individual set.
const cheerio = require('cheerio');

const LIQUIPEDIA_ORIGIN = 'https://liquipedia.net';
const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const absUrl = (src) => (!src ? null : src.startsWith('http') ? src : `${LIQUIPEDIA_ORIGIN}${src}`);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];

// "August 25, 2026" -> "2026-08-25"
function parseLongDate(text) {
  const m = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})/.exec(clean(text));
  if (!m) return null;
  const mi = MONTHS.findIndex((n) => n.startsWith(m[1].toLowerCase().slice(0, 3)));
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

// Largest srcset candidate of an <img> (crisper logo), else its src.
function imgUrl($, img) {
  if (!img || !img.length) return null;
  const srcset = (img.attr('srcset') || '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
  return absUrl(srcset[srcset.length - 1] || img.attr('src'));
}

// The app is dark-themed: prefer a team's darkmode logo, then any non-lightmode one.
function teamLogo($, scope) {
  const dark = scope.find('.team-template-darkmode img').first();
  if (dark.length) return imgUrl($, dark);
  const any = scope.find('.team-template-image-icon').not('.team-template-lightmode').find('img').first();
  if (any.length) return imgUrl($, any);
  return imgUrl($, scope.find('.team-template-image-icon img').first());
}

const isTbd = (name) => !name || /^(tbd|tba|bye)$/i.test(name);

// ---- season page --------------------------------------------------------

// Links to this season's own subpages that actually exist (red links - pages
// not created yet - are skipped so we never spend a rate-limited request on them).
function findSubpages(html, pagePath) {
  const $ = cheerio.load(html);
  const prefix = `/fighters/${pagePath}/`;
  const out = new Set();
  $('a[href]').each((_, a) => {
    const href = decodeURIComponent($(a).attr('href') || '');
    if (!href.startsWith(prefix)) return;
    const sub = href.slice(prefix.length).split('#')[0];
    if (sub && !sub.includes('/')) out.add(sub);
  });
  return [...out];
}

function parseMembers($, scope) {
  return scope.find('.team-participant-card__member').map((_, m) => {
    const nameEl = $(m).find('.team-participant-card__member-name .name').first();
    const name = clean(nameEl.text());
    const role = clean($(m).find('.team-participant-card__member-role').first().text()) || null;
    // The player's own wiki page (for their photo). Red links - pages that
    // don't exist yet - have none.
    const a = nameEl.find('a').first();
    const page = a.length && !a.hasClass('new') && !/redlink=1/.test(a.attr('href') || '') ? clean(a.attr('title')) || null : null;
    return name ? { name, role, page } : null;
  }).get().filter(Boolean);
}

// Team cards: canonical key (the team's Liquipedia page title), display name,
// logo, players and staff.
function parseTeams(html) {
  const $ = cheerio.load(html);
  const teams = [];
  $('.team-participant-card').each((_, card) => {
    const c = $(card);
    const full = c.find('.team-participant-card__opponent-full').first();
    const link = full.find('.name a').first();
    const name = clean(full.find('.name').first().text());
    const key = clean(link.attr('title')) || name;
    if (isTbd(name)) return;
    const content = c.find('.team-participant-card__content').first();
    // Rosters with staff are split into toggle areas: 1 = players, 2 = staff.
    const mainArea = content.find('[data-toggle-area-content="1"]').first();
    const staffArea = content.find('[data-toggle-area-content="2"]').first();
    const players = parseMembers($, mainArea.length ? mainArea : content);
    const staff = staffArea.length ? parseMembers($, staffArea) : [];
    teams.push({ key, name, logoUrl: teamLogo($, full), players, staff });
  });
  return teams;
}

// ---- stage subpages -----------------------------------------------------

function parseOpponentCell($, cell) {
  const name = clean(cell.find('.team-name').first().text()) || clean(cell.attr('aria-label'));
  const shortName = clean(cell.find('.team-shortname').first().text()) || null;
  return { name, shortName, logoUrl: teamLogo($, cell) };
}

function parseScore(text) {
  const t = clean(text);
  return /^\d+$/.test(t) ? Number(t) : null;
}

// Individual sets from the match popup: [{p1, p2, s1, s2}] in team1/team2 order.
function parseSets($, popup) {
  return popup.find('.brkts-popup-body-grid-row').map((_, row) => {
    const r = $(row);
    const players = r.find('.block-player .name');
    const score = r.find('.brkts-popup-spaced').filter((__, el) => /^\s*\d+\s*-\s*\d+\s*$/.test(clean($(el).text()))).first();
    const m = /(\d+)\s*-\s*(\d+)/.exec(clean(score.text()));
    if (players.length < 2 || !m) return null;
    return { p1: clean(players.eq(0).text()), p2: clean(players.eq(1).text()), s1: Number(m[1]), s2: Number(m[2]) };
  }).get().filter(Boolean);
}

/**
 * Every team-vs-team match on a stage page, in page order.
 * Round label = the match list's own title ("Week 3", "Day 2"), or - when it is
 * the generic "Match List" - the heading above it ("Semifinals"). Division =
 * the h3 above the list when it names one ("Division S").
 */
function parseMatches(html, { stage = null } = {}) {
  const $ = cheerio.load(html);
  const out = [];
  let h2 = null, h3 = null, listIdx = 0;
  $('h2, h3, .brkts-matchlist').each((_, el) => {
    const node = $(el);
    if (el.tagName === 'h2') { h2 = clean(node.text()).replace(/\[edit\]$/, '').trim(); h3 = null; return; }
    if (el.tagName === 'h3') { h3 = clean(node.text()).replace(/\[edit\]$/, '').trim(); return; }
    const title = clean(node.find('.general-collapsible-default-title').first().text());
    const roundLabel = (title && !/^match list$/i.test(title)) ? title : (h3 || h2 || title || null);
    const division = h3 && /division|group|conference/i.test(h3) ? h3 : null;
    node.find('.brkts-matchlist-match').each((matchIdx, m) => {
      const mm = $(m);
      const cells = mm.children('.brkts-matchlist-opponent');
      const scores = mm.children('.brkts-matchlist-score');
      if (cells.length < 2) return;
      const popup = mm.find('.brkts-popup').first();
      // Canonical team keys come from the popup's team page links (same
      // titles the season page's team cards use).
      const headerTeams = popup.find('.match-info-header-opponent');
      const keyOf = (i) => clean(headerTeams.eq(i).find('.name a').first().attr('title'));
      const t1 = { ...parseOpponentCell($, cells.eq(0)), key: keyOf(0) };
      const t2 = { ...parseOpponentCell($, cells.eq(1)), key: keyOf(1) };
      for (const t of [t1, t2]) { if (!t.key) t.key = t.name; if (isTbd(t.name)) { t.name = null; t.key = null; } }
      const timer = popup.find('.timer-object').first();
      const ts = Number(timer.attr('data-timestamp'));
      const s1 = parseScore(scores.eq(0).text());
      const s2 = parseScore(scores.eq(1).text());
      let winner = null;
      if (cells.eq(0).hasClass('brkts-matchlist-slot-winner')) winner = 1;
      else if (cells.eq(1).hasClass('brkts-matchlist-slot-winner')) winner = 2;
      const finished = winner != null || timer.attr('data-finished') === 'finished';
      const bo = /\((Bo\d+)\)/i.exec(clean(popup.find('.match-info-header-scoreholder-lower').first().text()));
      out.push({
        listIdx, matchIdx, stage, roundLabel, division,
        date: parseLongDate(timer.text()),
        startTs: Number.isFinite(ts) && ts > 0 ? ts : null,
        bestOf: bo ? bo[1] : null,
        team1: t1, team2: t2,
        score1: s1, score2: s2, winner, finished,
        sets: parseSets($, popup),
      });
    });
    listIdx += 1;
  });
  return out;
}

module.exports = { parseLongDate, findSubpages, parseTeams, parseMatches };
