# Unified "Tournaments" Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse Futures, Brackets/Live, and Results into a single **Tournaments** page (`/tournaments`) that renders every tournament as a lifecycle pill (upcoming → live → past), with outright singles betting on the pre-seeded bracket and 2026 past events backfilled into real Top 8 brackets.

**Architecture:** Reuse the existing `Bracket` component as the universal renderer. Historical 2026 Top 8 brackets are ingested from Start.gg into the existing `set_markets` table as `state='settled'` rows so they render with zero new bracket code. Futures' outright bet (singles only) is relocated onto the waiting-room projected bracket via the existing `POST /api/bets`. Results' filter bar + exhibition results are ported into the past band. Futures and Results pages are removed and their routes redirect to `/tournaments`.

**Tech Stack:** React (CRA) frontend, Node/Express backend, SQLite (better-sqlite3) on Render disk, Start.gg GraphQL via `startggClient.js`. Spec: `docs/superpowers/specs/2026-06-30-unified-tournaments-page-design.md`.

**Source-of-truth code references (verbatim, extracted):**
- Start.gg client: `startggClient.js:5-19` — `startgg(query, variables, token)`; Bearer `STARTGG_API_TOKEN`; POST `https://api.start.gg/gql/alpha`; 10s timeout.
- Poller helpers (to mirror, NOT import): `sync-live.js` LIVE_PHASES (25-34), PHASE_SETS (36-52), `fetchPhaseSets` (225-235), `fetchActiveEvents` (244-256), `selectTop8Sets` (90-103), `isTop8Round` (68-71), `findOrCreatePlayerId` (113-123), `findOrCreateGameId` (105-111).
- `set_markets` columns: `id, tournament_id, game_id, startgg_set_id (UNIQUE), round_text, round_int, phase_group_id, player1_id, player2_id, p1_seed, p2_seed, state, p1_prob, p2_prob, seed_k_cents, p1_pool_cents, p2_pool_cents, p1_live_odds, p2_live_odds, winner_id, p1_score, p2_score, opened_at, closed_at, settled_at`.
- `getMarkets()` SQL + `pastOnly` branch: `liveMarkets.js:339-360`.
- Past/markets routes: `server.js:689-707`.
- Bracket props/Node: `Bracket.js:267` (`{ markets, slip, onPick, demoControls, waiting, projected, bets }`), projected node render `Bracket.js:124-141`, row button `Bracket.js:158-177`, `picked` `Bracket.js:155`.
- WaitingRoom seed fetch `WaitingRoom.js:48-60`, projected object `WaitingRoom.js:65-74`.
- Futures singles slip `FutureTournaments.js:446-501`, `addToSlip` 215-230, `effectiveBet` 234-242, `removeFromSlip` 244-250, `updateStake` 252-255, `placeBets` 257-320; `POST /api/bets` `server.js:410-494`; `isFuturesLocked` `futures.js:8-15`.
- Results filter bar `PastResults.js:180-235`, filter state 25-28, filtering 129-140, show-more 309-313; shared table classes `.results-table-container/.results-table/.results-cards/.load-more` in `PastResults.css:102-173` (also used by `ExhibitionSection.js:58-133`).
- Nav array `Navbar.js:50-57`; App routes `App.js:26-43`; Home links `Home.js` 402/447/461/516/572/615.

---

## File Structure

**New files:**
- `scripts/backfill-top8-2026.js` — one-shot, self-contained, idempotent Start.gg → settled `set_markets` ingestion for 2026 past events.
- `client/src/components/TournamentFilterBar.js` + `.css` — reusable Year/Tournament/Game filter bar + show-more (lifted from Results, generalized).
- `client/src/styles/results-table.css` — shared results-table classes relocated from `PastResults.css` (consumed by `ExhibitionSection` and the new past view).

**Modified:**
- `liveMarkets.js` — `getMarkets()` `pastOnly` scoped to 2026 settled.
- `client/src/App.js` — `/tournaments` route + redirects from `/brackets`, `/future-tournaments`, `/past-results`.
- `client/src/components/Navbar.js` — Brackets→Tournaments; drop Futures + Results tabs (6→4).
- `client/src/components/Bracket.js` — projected nodes become tappable (outright pick affordance).
- `client/src/components/WaitingRoom.js` — projected outright slip; place via `/api/bets`.
- `client/src/components/LiveBetting.js` — mount the past filter bar + exhibition results; render under `/tournaments`.
- `client/src/components/Home.js` — repoint 5 cross-links to `/tournaments`.
- `client/src/components/ExhibitionSection.js` — import shared `results-table.css`.

**Deleted (Phase 2, last):**
- `client/src/components/FutureTournaments.js` + `.css`
- `client/src/components/PastResults.js` + `.css`

---

## PHASE 0 — Historical Top 8 ingestion

### Task 0.1: Write the self-contained backfill script

**Files:**
- Create: `scripts/backfill-top8-2026.js`

- [ ] **Step 1: Write the script**

Self-contained: imports only `db` and the shared `startgg()` client; re-declares the GraphQL queries + Top8 selection + player/game resolution (mirrors `sync-live.js` but does NOT import it, so the live poller is untouched). Writes each completed Top 8 set directly as a `state='settled'` row via `INSERT … ON CONFLICT(startgg_set_id) DO NOTHING` (idempotent; bypasses the live state machine and its "player still active" guard). Supports `--dry-run` (no writes, prints coverage) and `--limit=N` (process first N tournaments).

```js
/**
 * One-shot historical Top 8 backfill for 2026 past events.
 *
 * Pulls each past 2026 tournament's final-phase sets from Start.gg and writes the
 * completed Top 8 sets as state='settled' rows in set_markets, so the Tournaments
 * page renders real past brackets. Self-contained (does NOT import the live
 * poller) and idempotent (INSERT OR IGNORE on the unique startgg_set_id).
 *
 * Usage:
 *   node scripts/backfill-top8-2026.js --dry-run     # report only, no writes
 *   node scripts/backfill-top8-2026.js               # write settled markets
 *   node scripts/backfill-top8-2026.js --limit=5     # first 5 tournaments only
 */
require('dotenv').config();
const db = require('../db/db');
const { startgg } = require('../startggClient');

const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const a = process.argv.find((x) => x.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1], 10) : null;
})();

const SET_PAGE_SIZE = 50;
const MAX_SET_PAGES = 6;
const TOP8_MAX_SETS = 16;

// Mirrors sync-live.js LIVE_PHASES (25-34).
const LIVE_PHASES = `
  query Phases($id: ID!) {
    tournament(id: $id) {
      events { id name videogame { id name } phases { id phaseOrder } }
    }
  }`;

// Mirrors sync-live.js PHASE_SETS (36-52).
const PHASE_SETS = `
  query PhaseSets($eventId: ID!, $phaseId: ID!, $page: Int!, $perPage: Int!) {
    event(id: $eventId) {
      sets(page: $page, perPage: $perPage, filters: { phaseIds: [$phaseId] }) {
        pageInfo { totalPages }
        nodes {
          id state fullRoundText round winnerId
          phaseGroup { id }
          slots {
            entrant { id name seeds { seedNum } }
            standing { stats { score { value } } }
          }
        }
      }
    }
  }`;

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
const isGrandFinal = (t) => /grand final/.test(norm(t));
const TOP8_ROUNDS = [/grand final/, /winners final/, /winners semi final/, /losers final/, /losers semi final/, /losers quarter final/];
const isTop8Round = (t) => { const n = norm(t); return TOP8_ROUNDS.some((re) => re.test(n)); };

const seedOf = (e) => e?.seeds?.[0]?.seedNum ?? null;
const scoreOf = (slot) => { const v = slot?.standing?.stats?.score?.value; return v != null && v >= 0 ? v : 0; };

// Page through a phase's sets (mirrors sync-live.js fetchPhaseSets).
async function fetchPhaseSets(eventId, phaseId) {
  const all = [];
  for (let page = 1; page <= MAX_SET_PAGES; page++) {
    const data = await startgg(PHASE_SETS, { eventId, phaseId, page, perPage: SET_PAGE_SIZE });
    const nodes = data?.event?.sets?.nodes || [];
    all.push(...nodes);
    const totalPages = data?.event?.sets?.pageInfo?.totalPages || 1;
    if (nodes.length < SET_PAGE_SIZE || page >= totalPages) break;
  }
  return all;
}

// Resolve each event's final phase (highest phaseOrder) and fetch its sets.
async function fetchEvents(startggId) {
  const data = await startgg(LIVE_PHASES, { id: startggId });
  const events = data?.tournament?.events || [];
  const out = [];
  for (const ev of events) {
    const phases = ev.phases || [];
    if (!phases.length) continue;
    const finalPhase = phases.reduce((a, b) => (b.phaseOrder > a.phaseOrder ? b : a));
    const nodes = await fetchPhaseSets(ev.id, finalPhase.id);
    out.push({ id: ev.id, name: ev.name, videogame: ev.videogame, sets: nodes });
  }
  return out;
}

// Pick the Top 8 sets (mirrors sync-live.js selectTop8Sets).
function selectTop8Sets(phaseSets) {
  const byGroup = new Map();
  for (const s of phaseSets) {
    const key = s.phaseGroup?.id ?? 'none';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(s);
  }
  for (const [, sets] of byGroup) {
    if (sets.some((s) => isGrandFinal(s.fullRoundText))) {
      return sets.length <= TOP8_MAX_SETS ? sets : sets.filter((s) => isTop8Round(s.fullRoundText));
    }
  }
  return phaseSets.filter((s) => isTop8Round(s.fullRoundText));
}

async function findOrCreateGameId(vg) {
  const existing = await db.getAsync('SELECT id FROM games WHERE startgg_id = ? OR name = ?', [vg.id, vg.name]);
  if (existing) return existing.id;
  const res = await db.runAsync('INSERT INTO games (name, startgg_id) VALUES (?, ?)', [vg.name, vg.id]);
  return res.lastID;
}

async function findOrCreatePlayerId(entrant) {
  const name = entrant.name || 'Unknown';
  const existing = await db.getAsync('SELECT id FROM players WHERE startgg_id = ? OR name = ?', [entrant.id, name]);
  if (existing) {
    await db.runAsync('UPDATE players SET startgg_id = COALESCE(startgg_id, ?) WHERE id = ?', [entrant.id, existing.id]);
    return existing.id;
  }
  const res = await db.runAsync('INSERT INTO players (name, country, startgg_id) VALUES (?, ?, ?)', [name, '', entrant.id]);
  return res.lastID;
}

// Write one completed set as a settled market. Idempotent on startgg_set_id.
async function insertSettledMarket({ tournamentId, gameId, set }) {
  const e0 = set.slots?.[0]?.entrant, e1 = set.slots?.[1]?.entrant;
  if (!e0?.id || !e1?.id || set.winnerId == null) return { skipped: true };
  const setId = `hist-${set.id}`;
  const existing = await db.getAsync('SELECT id FROM set_markets WHERE startgg_set_id = ?', [setId]);
  if (existing) return { existed: true };

  const p1 = await findOrCreatePlayerId(e0);
  const p2 = await findOrCreatePlayerId(e1);
  const winnerPid = set.winnerId === e0.id ? p1 : (set.winnerId === e1.id ? p2 : null);
  if (winnerPid == null) return { skipped: true };

  await db.runAsync(
    `INSERT INTO set_markets
       (tournament_id, game_id, startgg_set_id, round_text, round_int, phase_group_id,
        player1_id, player2_id, p1_seed, p2_seed, state,
        p1_prob, p2_prob, seed_k_cents, p1_pool_cents, p2_pool_cents,
        p1_live_odds, p2_live_odds, winner_id, p1_score, p2_score, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'settled', 0.5, 0.5, 0, 0, 0, 0, 0, ?, ?, ?, datetime('now'))
     ON CONFLICT(startgg_set_id) DO NOTHING`,
    [tournamentId, gameId, setId, set.fullRoundText || null, set.round ?? null,
     set.phaseGroup?.id ?? null, p1, p2, seedOf(e0), seedOf(e1),
     winnerPid, scoreOf(set.slots[0]), scoreOf(set.slots[1])]
  );
  return { created: true };
}

async function main() {
  const tournaments = await db.allAsync(
    `SELECT id, name, startgg_id, date FROM tournaments
     WHERE strftime('%Y', date) = '2026' AND date(date) < date('now') AND startgg_id IS NOT NULL
     ORDER BY date DESC`
  );
  const list = LIMIT ? tournaments.slice(0, LIMIT) : tournaments;
  console.log(`${DRY ? '[DRY-RUN] ' : ''}Backfilling Top 8 for ${list.length} past 2026 tournaments…`);

  let created = 0, existed = 0, skipped = 0, eventsSeen = 0, errors = 0;
  for (const t of list) {
    try {
      const events = await fetchEvents(t.startgg_id);
      for (const ev of events) {
        eventsSeen++;
        if (!ev.videogame?.id) continue;
        const top8 = selectTop8Sets(ev.sets).filter((s) => s.state === 3 && s.winnerId != null);
        if (!top8.length) { console.log(`  · ${t.name} / ${ev.name}: no completed Top 8 sets`); continue; }
        const gameId = DRY ? -1 : await findOrCreateGameId(ev.videogame);
        for (const set of top8) {
          if (DRY) { created++; continue; }
          const r = await insertSettledMarket({ tournamentId: t.id, gameId, set });
          if (r.created) created++; else if (r.existed) existed++; else skipped++;
        }
        console.log(`  ✓ ${t.name} / ${ev.name} (${ev.videogame.name}): ${top8.length} sets`);
      }
    } catch (err) {
      errors++;
      console.error(`  ✗ ${t.name} (sgg:${t.startgg_id}): ${err.message}`);
    }
  }
  console.log(`\nDone. events=${eventsSeen} created=${created} existed=${existed} skipped=${skipped} errors=${errors}`);
  process.exit(0);
}

main();
```

- [ ] **Step 2: Dry-run to verify coverage (no writes)**

Run: `node scripts/backfill-top8-2026.js --dry-run --limit=3`
Expected: prints 3 tournaments, lists each event/game and a set count, ends with `created=N existed=0 skipped=0 errors=0`. No DB changes.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-top8-2026.js
git commit -m "feat(backfill): self-contained 2026 Top 8 historical ingestion script

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 0.2: Run ingestion + verify safety

**Files:** none (data + verification only)

- [ ] **Step 1: Capture pre-state (economy invariant)**

Run:
```bash
node -e "const db=require('./db/db');(async()=>{const b=await db.getAsync(\"SELECT COALESCE(SUM(amount_cents),0)-COALESCE(SUM(payout_cents),0) net FROM set_bets WHERE state IN ('won','lost')\");const m=await db.getAsync('SELECT COUNT(*) c FROM set_markets');console.log('bankroll_net',b.net,'markets',m.c);process.exit(0)})()"
```
Record the `bankroll_net` and `markets` count.

- [ ] **Step 2: Run the real backfill (start small, then full)**

Run: `node scripts/backfill-top8-2026.js --limit=3` then re-run the same command.
Expected: first run `created=N`; second run `created=0 existed=N` (idempotent). Then run full: `node scripts/backfill-top8-2026.js`.

- [ ] **Step 3: Verify economy + poller safety**

Run:
```bash
node -e "const db=require('./db/db');(async()=>{const b=await db.getAsync(\"SELECT COALESCE(SUM(amount_cents),0)-COALESCE(SUM(payout_cents),0) net FROM set_bets WHERE state IN ('won','lost')\");const hist=await db.getAsync(\"SELECT COUNT(*) c FROM set_markets WHERE startgg_set_id LIKE 'hist-%'\");const live=await db.getAsync(\"SELECT COUNT(*) c FROM tournaments WHERE is_live=1\");const bets=await db.getAsync(\"SELECT COUNT(*) c FROM set_bets b JOIN set_markets m ON m.id=b.market_id WHERE m.startgg_set_id LIKE 'hist-%'\");console.log('bankroll_net',b.net,'hist_markets',hist.c,'is_live_count',live.c,'bets_on_hist',bets.c);process.exit(0)})()"
```
Expected: `bankroll_net` UNCHANGED from Step 1 (historical markets carry no bets); `bets_on_hist=0`; `is_live_count` unchanged (backfill never sets `is_live`).

- [ ] **Step 4: Snapshot the seeded DB for Render** (per the `db.js` boot-hook seed convention)

The backfill runs on the dev DB. To get it onto Render, follow the existing seed-swap path (place `<db>.seed` on the Render disk; the boot hook in `db/db.js` swaps it in once). No code change here — note for deploy: do NOT push the local `database.db`; produce a `.seed` snapshot out of band.

- [ ] **Step 5: Commit** (no code; this is a data/verification task — skip commit, record results in the PR description).

---

## PHASE 1 — Futures → Tournaments (outright singles on the waiting-room bracket)

### Task 1.1: Route rename + redirects

**Files:**
- Modify: `client/src/App.js:26-43`

- [ ] **Step 1: Add `/tournaments` and redirect the three old routes**

Replace the `/brackets`, `/future-tournaments`, `/past-results` route blocks with:

```jsx
<Route
  path="/tournaments"
  element={isLoggedIn ? <LiveBetting /> : <Navigate to="/login" />}
/>
{/* Back-compat redirects — old routes now point at the unified page */}
<Route path="/brackets" element={<Navigate to="/tournaments" replace />} />
<Route path="/future-tournaments" element={<Navigate to="/tournaments" replace />} />
<Route path="/past-results" element={<Navigate to="/tournaments" replace />} />
```

Keep the `FutureTournaments` / `PastResults` imports for now (removed in Task 2.6).

- [ ] **Step 2: Verify build**

Run: `cd client && npm run build`
Expected: compiles with no errors (unused-import warnings for FutureTournaments/PastResults are acceptable until Task 2.6).

- [ ] **Step 3: Commit**

```bash
git add client/src/App.js
git commit -m "feat(tournaments): add /tournaments route + redirect /brackets,/future-tournaments,/past-results

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 1.2: Navbar — Tournaments tab; drop Futures + Results

**Files:**
- Modify: `client/src/components/Navbar.js:50-57`

- [ ] **Step 1: Update the NAV array**

Replace the NAV array with (keep `IconBracket`; remove the now-unused `IconFutures`/`IconResults` consts):

```js
const NAV = [
  { to: '/', label: 'Home', end: true, icon: IconHome },
  { to: '/tournaments', label: 'Tournaments', icon: IconBracket, live: true },
  { to: '/leaderboard', label: 'Ranks', icon: IconRanks },
  { to: '/profile', label: 'Picks', icon: IconPicks },
];
```

Delete the `IconFutures` and `IconResults` SVG consts (no longer referenced).

- [ ] **Step 2: Verify build** — `cd client && npm run build` (no `IconFutures`/`IconResults` references remain).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Navbar.js
git commit -m "feat(nav): single Tournaments tab; remove Futures and Results (6->4 tabs)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 1.3: Make projected bracket nodes tappable

**Files:**
- Modify: `client/src/components/Bracket.js:118-141` (Node projected branch), `:227-266` (Column), `:267+` (Bracket props)

**Design:** projected nodes have no `market`, so picks use a **synthetic key** `proj_<colKey>-<idx>`. The Bracket gains two optional props — `onProjectedPick(syntheticId, player)` and `projectedSlip` (a `{ [syntheticId_playerId]: true }` map) — used only in the waiting room; live rendering is unchanged.

- [ ] **Step 1: Thread the new props through Bracket → Column → Node**

In `const Bracket = ({ markets = [], slip = {}, onPick, demoControls, waiting = false, projected = {}, bets = {} }) =>` add `onProjectedPick, projectedSlip = {}` to the destructure, and pass both down to each `<Column … onProjectedPick={onProjectedPick} projectedSlip={projectedSlip} projectedKey={col.key} />`. In `Column`, pass `onProjectedPick`, `projectedSlip`, and the per-node synthetic id `\`proj_${projectedKey}-${i}\`` into each `<Node … projId={…} onProjectedPick={onProjectedPick} projectedSlip={projectedSlip} />`.

- [ ] **Step 2: Convert the projected node render to buttons**

Replace the projected branch (`Bracket.js:124-141`) so each player row is a button when `onProjectedPick` is provided and a `player` exists, applying a `picked` class from `projectedSlip[\`${projId}_${playerKey}\`]`:

```jsx
if (projected && projected.some(Boolean)) {
  const pickable = typeof onProjectedPick === 'function';
  return (
    <div className="bnode projected">
      <div className="bnode-head"><span className="bnode-proj-badge">PROJECTED</span></div>
      {[0, 1].map((i) => {
        const pl = projected[i];
        if (!pl) return <div key={i} className="bnode-row projected"><span className="bnode-name tbd">TBD</span></div>;
        const picked = Boolean(projectedSlip[`${projId}_${pl.name}`]);
        const inner = <span className="bnode-name" title={pl.name}><span className="bnode-seed">#{pl.seed}</span>{shortName(pl.name)}</span>;
        return pickable ? (
          <button key={i} type="button" className={`bnode-row projected pickable ${picked ? 'picked' : ''}`}
            onClick={() => onProjectedPick(projId, pl)}>{inner}</button>
        ) : (
          <div key={i} className="bnode-row projected">{inner}</div>
        );
      })}
    </div>
  );
}
```

(Player identity uses `pl.name` since projected seeds have no player id; the slip maps name→bet in Task 1.4.)

- [ ] **Step 3: Add minimal `.pickable` styling**

In `Bracket.css` add:
```css
.bnode-row.projected.pickable { cursor: pointer; background: none; border: none; width: 100%; text-align: left; }
.bnode-row.projected.pickable:hover { background: rgba(231,180,88,0.08); }
.bnode-row.projected.picked { background: rgba(231,180,88,0.18); box-shadow: inset 2px 0 0 var(--gold); }
```

- [ ] **Step 4: Verify build** — `cd client && npm run build`. Live bracket rendering is unchanged (new props default to undefined/{}).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Bracket.js client/src/components/Bracket.css
git commit -m "feat(bracket): projected nodes support tappable outright picks (opt-in props)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 1.4: Outright singles slip in the waiting room

**Files:**
- Modify: `client/src/components/WaitingRoom.js`

**Design:** the waiting room owns a `projSlip` state keyed `proj_<colKey>-<idx>_<playerName>`. A pick needs the **player's id + current fixed odds** to place via `POST /api/bets` (`{ tournamentId, gameId, playerId, amount }`). The seed fetch (`/api/game/:t/:g/players`) already returns `player_id`, `live_odds`, `player_name` (per the `GET /api/game/...` contract), so resolve id+odds from the seed rows by name. Reuse the singles slip JSX + handlers verbatim from `FutureTournaments.js:446-501` / 215-320 (parlay code excluded).

- [ ] **Step 1: Keep the raw seed rows (need id + odds, not just {seed,name})**

In the seed fetch (`WaitingRoom.js:48-60`), additionally store the raw rows: `setSeedRows(rows)` alongside the `{seed,name}` transform, so the slip can look up `player_id`/`live_odds` by `player_name`.

- [ ] **Step 2: Add slip state + handlers (singles-only, lifted from Futures)**

```js
const [projSlip, setProjSlip] = useState({}); // key: `${projId}_${playerName}`
const [placing, setPlacing] = useState(false);
const [placeMsg, setPlaceMsg] = useState(null);
const userId = localStorage.getItem('userId');

const onProjectedPick = (projId, pl) => {
  const key = `${projId}_${pl.name}`;
  setProjSlip((prev) => {
    if (prev[key]) { const n = { ...prev }; delete n[key]; return n; } // toggle off
    const row = seedRows.find((r) => r.player_name === pl.name);
    if (!row) return prev;
    return { ...prev, [key]: { gameId: activeGame, playerId: row.player_id, playerName: pl.name, odds: Number(row.live_odds) || 0, stake: '' } };
  });
  setPlaceMsg(null);
};
const updateStake = (key, v) => setProjSlip((p) => ({ ...p, [key]: { ...p[key], stake: v.replace(/[^0-9.]/g, '') } }));
const removeFromSlip = (key) => setProjSlip((p) => { const n = { ...p }; delete n[key]; return n; });

const placeOutrights = async () => {
  const entries = Object.values(projSlip).filter((e) => Number(e.stake) > 0);
  if (!entries.length) return;
  setPlacing(true); setPlaceMsg(null);
  try {
    for (const e of entries) {
      const res = await apiFetch('/api/bets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tournament.id, gameId: e.gameId, playerId: e.playerId, amount: Number(e.stake) }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || res.statusText); }
    }
    setProjSlip({});
    setPlaceMsg(`Placed ${entries.length} outright${entries.length > 1 ? 's' : ''}.`);
    window.dispatchEvent(new Event('mm-wallet-changed'));
  } catch (err) { setPlaceMsg(`Could not place: ${err.message}`); }
  finally { setPlacing(false); }
};
```

(`apiFetch` import from `../utils/api`; `fmAmount` from `../utils/money` for payout display.)

- [ ] **Step 2b: Wire Bracket + render the slip**

Pass `onProjectedPick={onProjectedPick}` and `projectedSlip={projSlip}` into the `<Bracket … />` the waiting room renders. Below the bracket, render a singles slip (lift JSX from `FutureTournaments.js:446-501`, simplified: each entry shows `playerName @odds`, a `StakeStepper`, projected payout `fmAmount(round(stake*odds*100))`, remove ×; footer shows total + a "Fixed odds — your stake locks the price" note + a `Place Outrights` button calling `placeOutrights`). Only render the slip when `Object.keys(projSlip).length > 0`.

- [ ] **Step 3: Verify (preview)**

Run dev server; open `/tournaments` on an upcoming tournament. Tap a projected player → it highlights and appears in the slip; enter a stake → payout updates; Place Outrights → success message, wallet badge refreshes. Confirm a futures-locked (already-started) tournament returns the 409 message surfaced in `placeMsg`.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/WaitingRoom.js
git commit -m "feat(tournaments): outright singles betting on the projected waiting-room bracket

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 1.5: Repoint Home's futures CTAs

**Files:**
- Modify: `client/src/components/Home.js` (lines 402, 447, 461, 572)

- [ ] **Step 1: Replace the four futures links**

Change every `<Link to="/future-tournaments" …>` (4 occurrences: 402, 447, 461, 572) to `<Link to="/tournaments" …>`. Update visible text from "Browse futures"/"See all" as appropriate to "Tournaments"/"See all" (keep "See all" on 572).

- [ ] **Step 2: Verify build** — `cd client && npm run build`.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Home.js
git commit -m "chore(home): repoint futures CTAs to /tournaments

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

> **Ship checkpoint:** Phases 0–1 are independently deployable. Push `testing`; Render redeploys. Futures betting now lives on `/tournaments`; `/future-tournaments` redirects.

---

## PHASE 2 — Results → Tournaments (past filter bar + exhibition results)

### Task 2.1: Relocate shared results-table CSS

**Files:**
- Create: `client/src/styles/results-table.css`
- Modify: `client/src/components/ExhibitionSection.js` (import), `client/src/components/PastResults.css` (remove relocated rules — temporary until 2.6)

- [ ] **Step 1: Move the shared table classes**

Cut `.results-table-container`, `.results-table`, `.results-cards`, `.load-more` (and their responsive variants) from `PastResults.css:102-173` into `client/src/styles/results-table.css` verbatim. These are consumed by `ExhibitionSection` (`ExhibitionSection.js:58-133`) and the new past view.

- [ ] **Step 2: Import the shared sheet where the classes are used**

Add `import '../styles/results-table.css';` to `ExhibitionSection.js` and (Task 2.4) to `LiveBetting.js`.

- [ ] **Step 3: Verify (preview)** — exhibition results tables on Home still render correctly (no missing borders/spacing).

- [ ] **Step 4: Commit**

```bash
git add client/src/styles/results-table.css client/src/components/ExhibitionSection.js client/src/components/PastResults.css
git commit -m "refactor(css): relocate shared results-table classes out of PastResults.css

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 2.2: Reusable TournamentFilterBar component

**Files:**
- Create: `client/src/components/TournamentFilterBar.js`, `client/src/components/TournamentFilterBar.css`

- [ ] **Step 1: Build the component (generalized from `PastResults.js:180-235`)**

Props: `years, tournaments, games` (option arrays), `value={{year,tournament,game}}`, `onChange(next)`, `onClear()`, `resultsCount`. Internal `open` state for the collapsible panel. Render the `.filter-bar` toggle + active-filter `.filter-chip`s + `.filter-panel` with three `.filter-select`s + `.clear-filters`. Move the *scoped* `.past-results-container .filter-*` rules into `TournamentFilterBar.css` re-scoped under `.tournament-filter-bar`.

- [ ] **Step 2: Verify build** — `cd client && npm run build`.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TournamentFilterBar.js client/src/components/TournamentFilterBar.css
git commit -m "feat(tournaments): reusable Year/Tournament/Game filter bar

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 2.3: Scope past markets to 2026 settled

**Files:**
- Modify: `liveMarkets.js:339-360`

- [ ] **Step 1: Update the `pastOnly` branch + state filter**

Change the `where` ternary's `pastOnly` arm and the trailing state filter so past = 2026, not-live, settled:

```js
const where = includeAll
  ? `1=1`
  : pastOnly
  ? `t.is_live = 0 AND date(t.date) < date('now') AND strftime('%Y', t.date) = '2026' AND m.state = 'settled'`
  : `(t.is_live = 1 OR date(t.date) BETWEEN date('now','-1 day') AND date('now','+2 day'))`;
```

Keep the rest of the query; the existing `AND m.state != 'void'` stays (harmless alongside the settled filter for pastOnly; required for the live branch).

- [ ] **Step 2: Verify the endpoint returns 2026 settled rows**

Run: `node -e "const lm=require('./liveMarkets');(async()=>{const r=await lm.getMarkets({pastOnly:true});const t=[...new Set(r.map(x=>x.tournament_name))];console.log('past markets',r.length,'tournaments',t.length);console.log(t.slice(0,10));process.exit(0)})()"`
Expected: nonzero markets across many 2026 tournaments (post-backfill), all `state='settled'`.

- [ ] **Step 3: Commit**

```bash
git add liveMarkets.js
git commit -m "feat(tournaments): scope past markets to 2026 settled events

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 2.4: Past band — filter bar + exhibition results on the Tournaments page

**Files:**
- Modify: `client/src/components/LiveBetting.js`

- [ ] **Step 1: Fetch exhibition results + add filter state**

`LiveBetting` already fetches `/api/live/past-markets` into `pastMarkets`. Add a fetch of `/api/exhibitions/results` into `pastExhibitions` state, and add filter state `{year,tournament,game}` + `visibleCount` (default 12). Derive `years/tournaments/games` option lists from `pastMarkets` (use `tournament_date`, `tournament_name`, `game_name`).

- [ ] **Step 2: Filter + paginate the past groups**

Before building `pastGroups`, filter `pastMarkets` by the active filter (year via `tournament_date`, tournament via `tournament_name`, game via `game_name`), then group, then slice the grouped tournament list to `visibleCount` with a `.load-more` "Show more" button (reuse `results-table.css`).

- [ ] **Step 3: Render the filter bar + exhibition results in the Past band**

Above the "Past Brackets" pills, render `<TournamentFilterBar … />` and, below the pills, `<ExhibitionSection exhibitions={pastExhibitions} title="Exhibition Results" layout="table" />` (same component Results used).

- [ ] **Step 4: Verify (preview)**

Open `/tournaments`; the Past band shows 2026 brackets grouped by tournament; the filter bar narrows by Year/Tournament/Game; Show more reveals additional tournaments; exhibition results render at the bottom.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/LiveBetting.js
git commit -m "feat(tournaments): past band gets Year/Tournament/Game filter + exhibition results

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 2.5: Repoint Home's results link

**Files:**
- Modify: `client/src/components/Home.js` (line 615)

- [ ] **Step 1:** Change `<Link to="/past-results" …>See all</Link>` → `<Link to="/tournaments" …>See all</Link>`.
- [ ] **Step 2: Verify build** — `cd client && npm run build`.
- [ ] **Step 3: Commit**

```bash
git add client/src/components/Home.js
git commit -m "chore(home): repoint results link to /tournaments

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 2.6: Delete the old pages

**Files:**
- Delete: `client/src/components/FutureTournaments.js`, `FutureTournaments.css`, `PastResults.js`, `PastResults.css`
- Modify: `client/src/App.js` (remove their imports)

- [ ] **Step 1: Confirm no remaining references**

Run: `cd client && grep -rn "FutureTournaments\|PastResults" src` (expect only the App.js imports about to be removed). Also confirm nothing still imports `PastResults.css` (its shared classes moved in Task 2.1; any still-scoped `.past-results-container` rules die with the file).

- [ ] **Step 2: Delete files + remove imports**

Remove the `import FutureTournaments …` and `import PastResults …` lines from `App.js`. Delete the four component/CSS files.

- [ ] **Step 3: Verify build** — `cd client && npm run build` compiles clean (no unused-import warnings, no missing-module errors).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(tournaments): remove Futures and Results pages (merged into /tournaments)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd client && npm run build` — clean.
- [ ] Backend smoke: `node -e "require('./server.js')"` boots without route/handler errors (Ctrl-C after "listening").
- [ ] Manual/preview pass on `/tournaments`: **upcoming** pill places an outright single; **live** pill unchanged (parimutuel); **past** band shows 2026 brackets + filter + exhibition results; `/brackets`, `/future-tournaments`, `/past-results` all redirect in; bottom tab bar shows 4 tabs.
- [ ] Economy invariant re-checked (bankroll net unchanged by historical markets).
- [ ] Push `testing`; confirm Render deploy succeeds.

## Known risks / follow-ups (out of scope)

- **Past payload size:** the past band fetches all 2026 settled markets and filters client-side (parity with old Results). If payload grows large, add server-side pagination to `/api/live/past-markets`.
- **Deferred parlays:** outright placement is singles-only; the parlay engine is intact but unexposed. Reintroduce via the cross-tournament slip drawer in a later pass.
- **Pre-existing settlement/ledger debt:** parlay-leg grading source and `wallet_transactions.ref_type` disambiguation (see spec §6) remain for a pre-EVO pass; not touched here.
- **Start.gg completeness:** events lacking clean Top-8 phase data are logged and skipped (the Grand-Final row in `matches` still exists as a fallback data source if a future task wants to surface those).
