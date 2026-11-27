import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './Leagues.css';
import StakeStepper from './StakeStepper';
import { apiFetch } from '../utils/api';
import { fm, fmSigned } from '../utils/money';

// Team leagues (Street Fighter League etc.), synced from Liquipedia every few
// hours by leagues/sync.js. One season at a time: standings, upcoming
// team-vs-team matches with match-winner picks, results with every set, and
// rosters. Picks lock at 00:00 on match day (Liquipedia lists dates, not
// kickoff times) - the server enforces it, the UI just mirrors it.

const fmtDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'TBD');
const fmtRange = (a, b) => (a ? `${fmtDate(a)} – ${fmtDate(b)}` : 'Dates TBA');
const fmtLock = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const STATUS_LABEL = { live: 'In season', upcoming: 'Upcoming', complete: 'Complete' };

const TeamLogo = ({ team, size = 28 }) => {
  const [failed, setFailed] = useState(false);
  if (team?.logoUrl && !failed) {
    return <img className="lg-logo" src={team.logoUrl} alt="" width={size} height={size} onError={() => setFailed(true)} />;
  }
  return <span className="lg-logo lg-logo-fallback" style={{ width: size, height: size }} aria-hidden="true">{(team?.shortName || team?.name || '?').slice(0, 3)}</span>;
};

// Liquipedia infobox photo, or the player's initial when there is none.
const PlayerPhoto = ({ player, size }) => {
  const [failed, setFailed] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  if (player?.photoUrl && !failed) {
    return <img className="lg-player-photo" style={style} src={player.photoUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return <span className="lg-player-photo lg-player-photo-fallback" style={style} aria-hidden="true">{(player?.name || '?').charAt(0).toUpperCase()}</span>;
};

// A set's player -> their roster entry (for the photo): that team's roster
// first, then anyone in the season with the same name.
const findPlayer = (name, team, teams) => {
  const key = String(name || '').toLowerCase();
  const own = team?.players?.find((p) => p.name.toLowerCase() === key);
  if (own) return own;
  for (const t of teams.values()) {
    const p = t.players?.find((x) => x.name.toLowerCase() === key);
    if (p) return p;
  }
  return { name };
};

// Who to show on a team's side: for a finished match, the players who
// actually played (from the sets); before and during it, the roster.
const lineupFor = (match, side, team, teams) => {
  const played = match.sets?.map((s) => (side === 1 ? s.p1 : s.p2)).filter(Boolean) || [];
  if (match.finished && played.length) return [...new Set(played)].map((n) => findPlayer(n, team, teams));
  return team?.players?.length ? team.players : [...new Set(played)].map((n) => findPlayer(n, team, teams));
};

const Lineup = ({ players, side }) => (
  <div className={`lg-lineup ${side === 1 ? 'left' : 'right'}`} aria-label="Players">
    {players.slice(0, 5).map((p) => (
      <span key={p.name} className="lg-lineup-player" title={p.name}>
        <PlayerPhoto player={p} />
        <span className="lg-lineup-name">{p.name}</span>
      </span>
    ))}
  </div>
);

const SeasonLogo = ({ url }) => {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return <img className="lg-season-logo" src={url} alt="" onError={() => setFailed(true)} />;
};

const LiveBadge = () => (
  <span className="lg-live-badge"><span className="lg-live-dot" aria-hidden="true" />LIVE</span>
);
const TodayBadge = () => <span className="lg-today-badge">Match day</span>;

const groupBy = (list, keyFn) => {
  const out = [];
  const idx = new Map();
  for (const item of list) {
    const k = keyFn(item);
    if (!idx.has(k)) { idx.set(k, out.length); out.push({ key: k, items: [] }); }
    out[idx.get(k)].items.push(item);
  }
  return out;
};
// Soonest first; stable sort keeps Liquipedia's order within a day.
const byDate = (a, b) => (a.date || '9999').localeCompare(b.date || '9999');
const roundKey = (m) => [m.stage, m.round, m.division].filter(Boolean).join(' · ');

// One open match: two odds buttons; picking one opens the stake slip under it.
const PickCard = ({ match, teams, isLoggedIn, myBets, onPlaced }) => {
  const [side, setSide] = useState(null);
  const [stake, setStake] = useState('50');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const t1 = teams.get(match.team1Id), t2 = teams.get(match.team2Id);
  const mk = match.market;
  const open = mk.state === 'open';
  const mine = myBets.filter((b) => b.marketId === mk.id && b.state !== 'refunded');
  const pickedTeam = side === 1 ? t1 : side === 2 ? t2 : null;
  const odds = side === 1 ? mk.team1Odds : mk.team2Odds;
  const stakeCents = Math.round((Number(stake) || 0) * 100);

  const place = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch('/api/leagues/bets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId: mk.id, teamId: pickedTeam.id, amountCents: stakeCents }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not place pick');
      setSide(null);
      window.dispatchEvent(new Event('mm-wallet-changed'));
      onPlaced();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const oddsBtn = (n, team, o) => (
    <button type="button" className={`lg-odds${side === n ? ' selected' : ''}`} disabled={!open}
      onClick={() => setSide(side === n ? null : n)} aria-pressed={side === n}>
      <span className="lg-odds-name">{team?.name || 'TBD'}</span>
      <span className="lg-odds-price">{o ? o.toFixed(2) : '—'}</span>
    </button>
  );

  return (
    <div className={`lg-match${match.phase === 'live' ? ' is-live' : match.phase === 'today' ? ' is-today' : ''}`}>
      <div className="lg-match-meta">
        <span className="lg-match-meta-left">
          {match.phase === 'live' ? <LiveBadge /> : match.phase === 'today' ? <TodayBadge /> : null}
          {fmtDate(match.date)}{match.bestOf ? ` · ${match.bestOf}` : ''}
        </span>
        <span className={open ? 'lg-lock' : 'lg-lock locked'}>{open ? `Locks ${fmtLock(match.lockAt)}` : 'Locked · awaiting result'}</span>
      </div>
      <MatchBoard match={match} t1={t1} t2={t2} teams={teams} />
      <div className="lg-pick-row">
        {oddsBtn(1, t1, mk.team1Odds)}
        <span className="lg-vs" aria-hidden="true" />
        {oddsBtn(2, t2, mk.team2Odds)}
      </div>
      <div className="lg-pick-foot">{mk.picks} pick{mk.picks === 1 ? '' : 's'} · {fm(mk.poolCents)} pool</div>
      {mine.map((b) => (
        <div key={b.id} className="lg-mine">Your pick: <strong>{b.pickedName}</strong> · {fm(b.amountCents)} @ {b.lockedOdds.toFixed(2)}</div>
      ))}
      {pickedTeam && open && (
        isLoggedIn ? (
          <div className="lg-slip">
            <div className="lg-slip-title">Pick <strong>{pickedTeam.name}</strong> to win @ {odds.toFixed(2)}</div>
            <StakeStepper value={stake} onChange={setStake} min={1} step={10} ariaLabel="Pick amount in FM" />
            <div className="lg-slip-return">Projected return {fm(Math.round(stakeCents * odds))}</div>
            {error && <div className="lg-error">{error}</div>}
            <button type="button" className="lg-place" onClick={place} disabled={busy || stakeCents <= 0}>
              {busy ? 'Placing…' : `Place pick · ${fm(stakeCents)}`}
            </button>
            <div className="lg-fine">Odds move with the pool until the match locks; your payout uses the final pool line.</div>
          </div>
        ) : (
          <div className="lg-slip"><Link to="/login" className="lg-place as-link">Log in to make picks</Link></div>
        )
      )}
    </div>
  );
};

// The broadcast-style board: lineup · logo · score (or ×) · logo · lineup.
const MatchBoard = ({ match, t1, t2, teams }) => {
  const w = match.winnerTeamId;
  const hasScore = match.score1 != null || match.score2 != null;
  const sideCls = (id) => (w ? (w === id ? ' won' : ' lost') : '');
  return (
    <div className="lg-board">
      <Lineup players={lineupFor(match, 1, t1, teams)} side={1} />
      <div className={`lg-board-team left${sideCls(match.team1Id)}`}>
        <TeamLogo team={t1} size={48} />
        <span className="lg-board-name">{t1?.name || 'TBD'}</span>
      </div>
      <div className="lg-board-mid">
        {hasScore
          ? <span className="lg-res-score">{match.score1 ?? 0}<span className="lg-res-colon">:</span>{match.score2 ?? 0}</span>
          : <span className="lg-board-x" aria-label="versus">×</span>}
      </div>
      <div className={`lg-board-team${sideCls(match.team2Id)}`}>
        <TeamLogo team={t2} size={48} />
        <span className="lg-board-name">{t2?.name || 'TBD'}</span>
      </div>
      <Lineup players={lineupFor(match, 2, t2, teams)} side={2} />
    </div>
  );
};

const SetList = ({ match, t1, t2, teams }) => (
  <div className="lg-sets">
    {match.sets.map((s, i) => (
      <div key={i} className="lg-set">
        <span className={`lg-set-player left${s.s1 > s.s2 ? ' won' : ''}`}><span className="lg-set-name">{s.p1}</span><PlayerPhoto player={findPlayer(s.p1, t1, teams)} size={30} /></span>
        <span className="lg-set-score">{s.s1} – {s.s2}</span>
        <span className={`lg-set-player${s.s2 > s.s1 ? ' won' : ''}`}><PlayerPhoto player={findPlayer(s.p2, t2, teams)} size={30} /><span className="lg-set-name">{s.p2}</span></span>
      </div>
    ))}
  </div>
);

// A played (or in-progress) match. Live ones start expanded.
const ResultRow = ({ match, teams }) => {
  const live = match.phase === 'live';
  const [open, setOpen] = useState(live);
  const t1 = teams.get(match.team1Id), t2 = teams.get(match.team2Id);
  return (
    <div className={`lg-match lg-result${live ? ' is-live' : ''}`}>
      {live && <div className="lg-match-meta"><span className="lg-match-meta-left"><LiveBadge />{fmtDate(match.date)}{match.bestOf ? ` · ${match.bestOf}` : ''}</span></div>}
      {/* A div, not a <button>: the board holds block content. */}
      <div className={`lg-result-main${match.sets.length ? ' clickable' : ''}`}
        {...(match.sets.length ? {
          role: 'button', tabIndex: 0, 'aria-expanded': open, onClick: () => setOpen(!open),
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } },
        } : {})}>
        <MatchBoard match={match} t1={t1} t2={t2} teams={teams} />
        {match.sets.length > 0 && <span className="lg-result-toggle">{open ? 'Hide sets ▲' : `Show ${match.sets.length} sets ▼`}</span>}
      </div>
      {open && <SetList match={match} t1={t1} t2={t2} teams={teams} />}
    </div>
  );
};

const Standings = ({ standings, teams }) => (
  <div className="lg-standings">
    {standings.length === 0 && <p className="lg-muted">No regular-season results yet.</p>}
    {standings.map((g) => (
      <div key={g.division || 'all'} className="lg-table">
        {g.division && <div className="lg-table-title">{g.division}</div>}
        <div className="lg-trow lg-thead"><span>#</span><span>Team</span><span>W–L</span><span>Pts</span><span>+/−</span></div>
        {g.rows.map((r) => {
          const t = teams.get(r.teamId);
          return (
            <div key={r.teamId} className="lg-trow">
              <span className="lg-rank">{r.rank}</span>
              <span className="lg-tteam"><TeamLogo team={t} size={22} /><span className="lg-tname">{t?.name}</span></span>
              <span>{r.wins}–{r.losses}</span>
              <span className="lg-pts">{r.pf}</span>
              <span className={r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : ''}>{r.diff > 0 ? `+${r.diff}` : r.diff}</span>
            </div>
          );
        })}
      </div>
    ))}
    <p className="lg-fine">Ranked by league points (each team match is worth its score, e.g. 30:10), then match wins.</p>
  </div>
);

const Teams = ({ teams }) => (
  <div className="lg-teams">
    {teams.map((t) => (
      <div key={t.id} className="lg-team-card">
        <div className="lg-team-head"><TeamLogo team={t} size={36} /><div><div className="lg-team-name">{t.name}</div>{t.division && <div className="lg-team-div">{t.division}</div>}</div></div>
        <ul className="lg-roster">{t.players.map((p) => <li key={p.name}><PlayerPhoto player={p} /><span className="lg-player-name">{p.name}</span></li>)}</ul>
        {t.staff.length > 0 && <div className="lg-staff">Staff: {t.staff.map((s) => s.name).join(', ')}</div>}
      </div>
    ))}
  </div>
);

const MyPicks = ({ bets }) => {
  if (!bets.length) return null;
  const label = { placed: 'Open', won: 'Won', lost: 'Lost', refunded: 'Refunded' };
  return (
    <section className="lg-section">
      <div className="lg-section-head"><h2 className="lg-h2">Your Picks</h2></div>
      <div className="lg-mypicks">
        {bets.map((b) => (
          <div key={b.id} className={`lg-mypick ${b.state}`}>
            <div className="lg-mypick-main"><strong>{b.pickedName}</strong> <span className="lg-muted-inline">vs {b.pickedName === b.team1Name ? b.team2Name : b.team1Name}</span></div>
            <div className="lg-mypick-sub">{b.round} · {fmtDate(b.date)} · {fm(b.amountCents)} @ {b.lockedOdds.toFixed(2)}</div>
            <div className="lg-mypick-state">{label[b.state] || b.state}{b.state === 'won' && ` ${fmSigned(b.payoutCents - b.amountCents)}`}{b.state === 'lost' && ` ${fmSigned(-b.amountCents)}`}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

const Leagues = ({ isLoggedIn }) => {
  const [seasons, setSeasons] = useState(null);
  const [slug, setSlug] = useState(null);
  const [season, setSeason] = useState(null);
  const [bets, setBets] = useState([]);
  const [tab, setTab] = useState('matches');
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/leagues');
        if (!res.ok) throw new Error('Failed to load leagues.');
        const list = await res.json();
        setSeasons(list);
        const pick = list.find((s) => s.bettable > 0) || list.find((s) => s.status === 'live') || list[0];
        if (pick) setSlug(pick.slug);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  const loadSeason = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await fetch(`/api/leagues/${slug}`);
      if (!res.ok) throw new Error('Failed to load league.');
      setSeason(await res.json());
    } catch (e) { setError(e.message); }
  }, [slug]);

  const loadBets = useCallback(async () => {
    if (!isLoggedIn) { setBets([]); return; }
    try {
      const res = await apiFetch('/api/leagues/bets');
      if (res.ok) setBets(await res.json());
    } catch { /* ignore */ }
  }, [isLoggedIn]);

  useEffect(() => { setSeason(null); loadSeason(); }, [loadSeason]);
  // While a match is live or on today, keep the page fresh (the server
  // re-syncs those seasons from Liquipedia every 15 min on match days).
  const active = (season?.matches || []).some((m) => m.phase);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(loadSeason, 60000);
    return () => clearInterval(id);
  }, [active, loadSeason]);
  useEffect(() => { loadBets(); }, [loadBets]);

  const teams = useMemo(() => new Map((season?.teams || []).map((t) => [t.id, t])), [season]);
  const happening = useMemo(() => (season?.matches || []).filter((m) => m.phase)
    .sort((a, b) => (a.phase === 'live' ? 0 : 1) - (b.phase === 'live' ? 0 : 1) || byDate(a, b)), [season]);
  const upcoming = useMemo(() => (season?.matches || []).filter((m) => !m.finished && !m.phase).sort(byDate), [season]);
  const results = useMemo(() => (season?.matches || []).filter((m) => m.finished).reverse().sort((a, b) => byDate(b, a)), [season]);
  const seasonBets = bets.filter((b) => b.seasonSlug === slug);
  const onPlaced = () => { loadSeason(); loadBets(); };
  // Live -> score + sets; open/locked market -> pick card; no market yet -> board only.
  const renderMatch = (m) => {
    if (m.phase === 'live') return <ResultRow key={m.id} match={m} teams={teams} />;
    if (m.market) return <PickCard key={m.id} match={m} teams={teams} isLoggedIn={isLoggedIn} myBets={seasonBets} onPlaced={onPlaced} />;
    return (
      <div key={m.id} className={`lg-match pending${m.phase === 'today' ? ' is-today' : ''}`}>
        <div className="lg-match-meta">
          <span className="lg-match-meta-left">{m.phase === 'today' && <TodayBadge />}{fmtDate(m.date)}{m.bestOf ? ` · ${m.bestOf}` : ''}</span>
          <span className="lg-lock locked">{m.team1Id && m.team2Id ? 'Picks not open' : 'Teams TBD'}</span>
        </div>
        <MatchBoard match={m} t1={teams.get(m.team1Id)} t2={teams.get(m.team2Id)} teams={teams} />
      </div>
    );
  };

  if (error) return <div className="leagues-page"><p className="lg-error">{error}</p></div>;
  if (!seasons) return <div className="leagues-page"><p className="lg-muted">Loading…</p></div>;
  if (!seasons.length) return <div className="leagues-page"><p className="lg-muted">No team leagues synced yet — check back shortly.</p></div>;
  const meta = seasons.find((s) => s.slug === slug);

  return (
    <div className="leagues-page">
      <h1 className="sr-only">Team Leagues</h1>

      <div className="lg-chips" role="tablist" aria-label="League season">
        {seasons.map((s) => (
          <button key={s.slug} type="button" role="tab" aria-selected={s.slug === slug}
            className={`lg-chip${s.slug === slug ? ' active' : ''}`} onClick={() => { setSlug(s.slug); setTab('matches'); }}>
            {s.liveMatches > 0 && <span className="lg-chip-live" aria-label="Live now" />}
            {s.shortName}
            {s.bettable > 0 && <span className="lg-chip-badge">{s.bettable}</span>}
          </button>
        ))}
      </div>

      {meta && (
        <div className={`lg-hero${meta.liveMatches > 0 ? ' is-live' : ''}`}>
          <SeasonLogo key={meta.slug} url={meta.logoUrl} />
          <div className="lg-hero-meta">
            <div className="lg-hero-name">{meta.name}</div>
            <div className="lg-hero-sub">{meta.game} · {meta.region} · {fmtRange(meta.startDate, meta.endDate)} · {meta.teamCount} teams</div>
          </div>
          {meta.liveMatches > 0 ? <LiveBadge />
            : meta.todayMatches > 0 ? <TodayBadge />
              : <span className={`lg-status ${meta.status}`}>{STATUS_LABEL[meta.status]}</span>}
        </div>
      )}

      {!season ? <p className="lg-muted">Loading…</p> : (
        <>
          <MyPicks bets={seasonBets} />

          <div className="lg-tabs" role="tablist">
            {[['matches', 'Matches'], ['standings', 'Standings'], ['teams', 'Teams']].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`lg-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === 'matches' && (
            <>
              {happening.length > 0 && (
                <section className="lg-section">
                  <div className="lg-section-head"><h2 className="lg-h2 lg-h2-now">Happening Now</h2></div>
                  {groupBy(happening, roundKey).map((g) => (
                    <div key={g.key} className="lg-round">
                      <div className="lg-round-title">{g.key}</div>
                      <div className="lg-match-list">{g.items.map((m) => renderMatch(m))}</div>
                    </div>
                  ))}
                </section>
              )}
              <section className="lg-section">
                <div className="lg-section-head"><h2 className="lg-h2">Upcoming</h2></div>
                {upcoming.length === 0 && <p className="lg-muted">{meta?.status === 'complete' ? 'This season is over — see results below.' : happening.length ? 'Nothing else scheduled yet.' : 'No matches scheduled yet.'}</p>}
                {groupBy(upcoming, roundKey).map((g) => (
                  <div key={g.key} className="lg-round">
                    <div className="lg-round-title">{g.key}</div>
                    <div className="lg-match-list">{g.items.map((m) => renderMatch(m))}</div>
                  </div>
                ))}
              </section>
              <section className="lg-section">
                <div className="lg-section-head"><h2 className="lg-h2">Results</h2></div>
                {results.length === 0 && <p className="lg-muted">No results yet.</p>}
                {groupBy(results, roundKey).map((g) => (
                  <div key={g.key} className="lg-round">
                    <div className="lg-round-title">{g.key} · {fmtDate(g.items[0].date)}</div>
                    <div className="lg-match-list">{g.items.map((m) => <ResultRow key={m.id} match={m} teams={teams} />)}</div>
                  </div>
                ))}
              </section>
            </>
          )}
          {tab === 'standings' && <Standings standings={season.standings} teams={teams} />}
          {tab === 'teams' && <Teams teams={season.teams} />}

          <p className="lg-source">
            Data from <a href={season.liquipediaUrl} target="_blank" rel="noopener noreferrer">Liquipedia</a>
            {season.syncedAt && ` · updated ${new Date(season.syncedAt).toLocaleString()}`}
          </p>
        </>
      )}
    </div>
  );
};

export default Leagues;
