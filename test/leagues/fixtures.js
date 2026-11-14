// Minimal Liquipedia-shaped HTML for team-league tests, mirroring the real
// markup of Street_Fighter_League/<region>/2026 pages (team cards, match lists
// with popups). Only the classes leagues/parse.js reads are reproduced.

const teamBlock = (name, short, cls = '') => `<div class="block-team brkts-matchlist-cell-content ${cls}">
  <span class="team-template-image-icon team-template-darkmode"><img src="/commons/images/${short}_darkmode.png"/></span>
  <span class="name team-name-dynamic"><div class="team-shortname">${short}</div><div class="team-bracketname">${name}</div><div class="team-name">${name}</div></span></div>`;

// m: { t1:[name,short], t2:[name,short], s1, s2, winner (1|2|null), date, bo, sets:[[p1,s1,s2,p2]], finished }
function match(m) {
  const tbd1 = !m.t1, tbd2 = !m.t2;
  const [n1, sh1] = m.t1 || ['TBD', 'TBD'];
  const [n2, sh2] = m.t2 || ['TBD', 'TBD'];
  const sets = (m.sets || []).map(([a, x, y, b]) => `<div class="brkts-popup-body-grid-row"><div class="brkts-popup-body-grid-row-detail">
    <div class="brkts-popup-spaced"><div class="block-player flipped"><span class="name"><a title="${a}">${a}</a></span></div></div>
    <div class="brkts-popup-spaced">${x}&nbsp;-&nbsp;${y}</div>
    <div class="brkts-popup-spaced"><div class="block-player"><span class="name"><a title="${b}">${b}</a></span></div></div></div></div>`).join('');
  const header = (n, tbd) => `<div class="match-info-header-opponent"><div class="block-team"><span class="name">${tbd ? 'TBD' : `<a href="/fighters/${n}" title="${n}">${n}</a>`}</span></div></div>`;
  return `<div class="brkts-matchlist-match">
    <div class="brkts-matchlist-cell brkts-matchlist-opponent${m.winner === 1 ? ' brkts-matchlist-slot-winner' : ''}" aria-label="${n1}">${teamBlock(n1, sh1, 'flipped')}</div>
    <div class="brkts-matchlist-cell brkts-matchlist-score"><div class="brkts-matchlist-cell-content">${m.s1 ?? ''}</div></div>
    <div class="brkts-match-info-icon"></div>
    <div class="brkts-matchlist-cell brkts-matchlist-score"><div class="brkts-matchlist-cell-content">${m.s2 ?? ''}</div></div>
    <div class="brkts-matchlist-cell brkts-matchlist-opponent${m.winner === 2 ? ' brkts-matchlist-slot-winner' : ''}" aria-label="${n2}">${teamBlock(n2, sh2)}</div>
    <div class="brkts-popup"><span class="match-info-countdown"><span class="timer-object" data-timestamp="error"${m.finished ? ' data-finished="finished"' : ''}>${m.date}</span></span>
      <div class="match-info-header">${header(n1, tbd1)}<div class="match-info-header-scoreholder"><span class="match-info-header-scoreholder-lower">(${m.bo || 'Bo3'})</span></div>${header(n2, tbd2)}</div>
      <div class="brkts-popup-body"><div class="brkts-popup-body-grid">${sets}</div></div></div>
  </div>`;
}

const matchList = (title, matches) => `<div class="general-collapsible brkts-matchlist"><div class="general-collapsible-default-title">${title}</div>${matches.map(match).join('')}</div>`;

const teamCard = (name, players, staff = []) => {
  const members = (list) => list.map((p) => `<div class="team-participant-card__member"><div class="team-participant-card__member-name"><div class="block-player"><span class="name"><a title="${p}">${p}</a></span></div></div></div>`).join('');
  const content = staff.length
    ? `<div data-toggle-area-content="1"><div class="team-participant-roster">${members(players)}</div></div><div data-toggle-area-content="2"><div class="team-participant-roster">${members(staff)}</div></div>`
    : `<div class="team-participant-roster">${members(players)}</div>`;
  return `<div class="team-participant-card"><div class="team-participant-card__opponent-full"><div class="block-team"><span class="team-template-image-icon"><img src="/commons/images/${name}.png"/></span><span class="name"><a href="/fighters/${name}" title="${name}">${name}</a></span></div></div>
    <div class="team-participant-card__content">${content}</div></div>`;
};

const seasonPage = (page, cards, subs) => `<div>${cards.join('')}${subs.map((s) => `<a href="/fighters/${page}/${s}">${s}</a>`).join('')}
  <a href="/fighters/index.php?title=${page}/Bracket&amp;action=edit&amp;redlink=1">Bracket</a></div>`;

module.exports = { match, matchList, teamCard, seasonPage };
