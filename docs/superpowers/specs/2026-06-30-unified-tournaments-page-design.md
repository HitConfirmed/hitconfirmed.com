# Unified "Tournaments" Page — Design Spec

**Date:** 2026-06-30
**Status:** Draft for review
**Goal:** Collapse the three tournament surfaces (Futures, Brackets/Live, Results) into a single **Tournaments** page that is the past / present / future home for every tournament — each rendered as a lifecycle-keyed accordion pill.

---

## 1. Why

Brackets already renders one per-tournament pill whose body switches on lifecycle state: **upcoming** (countdown + projected seeded bracket, view-only), **live** (per-set parimutuel betting), and **past** ("Past Brackets" for settled events). Futures and Results are each a *subset* of that lifecycle:

- **Futures** = the upcoming state + an outright "who wins it all" bet placed against the same seeded field the waiting room already shows (both read `GET /api/game/:t/:g/players`).
- **Results** = the past state, but drawn from flat `matches` history instead of brackets.

So the consolidation is mostly a betting-affordance + routing problem, not a new architecture — with one substantial new data task (below).

### The data gap that shapes the past view
- `set_markets` (bracket data) exists for **2 tournaments**.
- `matches` (flat winner/score) exists for **215 tournaments**.
- `matches` holds **only the Grand Final** per game (one row: winner, runner-up, score) — **not** Top 8.

Therefore the past view cannot lean on existing bracket data, and cannot be reshaped from `matches`. To show real Top 8 brackets for past events we must **ingest them from Start.gg**.

---

## 2. Decisions locked (from review)

1. **Page identity:** Brackets becomes the single tournament page. Rename UI label/route to **Tournaments** (`/tournaments`), with `/brackets`, `/future-tournaments`, `/past-results` redirecting to it.
2. **Pre-event betting:** **Keep** the outright (tournament-winner) bet as **singles only**, relocated onto the pre-seeded bracket in the waiting room. Tapping a player in the projected bracket places an outright pick via the existing fixed-odds `bets` / `POST /api/bets` path. **Parlays are deferred** — not carried into the new surface in this work (see §6).
3. **Past scope:** **2026 only**, **all 82 past events** (majors + World Warrior regional qualifiers), each reconstructed into a **full Top 8 settled bracket** from Start.gg.
4. **Storage:** Historical brackets are written as `state='settled'` rows in the existing **`set_markets`** table so the existing `Bracket` component renders them with zero new rendering code.

---

## 3. Target page anatomy

One route, one accordion of per-tournament pills, grouped into three time bands:

```
TOURNAMENTS  (/tournaments)
├── Live now            (is_live, open/closed markets)      → bettable parimutuel bracket
├── Upcoming            (date ≥ today, seeded)              → projected bracket, OUTRIGHT bettable
│      header: logo · date · location · countdown
└── Past  (2026)        (settled markets)                   → settled bracket, winner + scores
       header: logo · date · location
       filter bar: Year · Tournament · Game  (ported from Results)
       pagination: show-more (accordion can't show 82 pills at once)
```

Each pill body is the existing `Bracket` component; only the **interaction layer** changes by state:

| State | Bracket nodes | Slip | Bet table |
|-------|---------------|------|-----------|
| Upcoming | projected seeds, **tappable** | fixed-odds outright slip (lifted from Futures) | `bets` / `POST /api/bets` |
| Live | open/closed sets, tappable | parimutuel live slip (today) | `set_bets` / `POST /api/live/bets` |
| Past | settled, view-only | — | — |

---

## 4. Backend

### 4.1 Historical Top 8 ingestion (the big new piece)
A one-shot, **idempotent, resumable** script: `scripts/backfill-top8-2026.js`.

- **Input:** the 82 tournaments where `strftime('%Y',date)='2026' AND date(date) < date('now')` (all have `startgg_id`).
- **Per (tournament, game):** call Start.gg for the Top-8 phase sets (reuse the live poller's existing set-fetch + round-mapping logic), then write each set as a `set_markets` row with:
  - `state='settled'`, `winner_id`, `p1_score`/`p2_score`, `p1_seed`/`p2_seed`, `round_text`, `round_int`, `phase_group_id`
  - a synthetic, stable `startgg_set_id` (e.g. `hist-<startggSetId>`) so re-runs are idempotent (insert-or-skip).
- **No pools, no odds, no bets** — these markets are inert (see §4.4).
- **Rate limiting / resumability:** chunk by tournament, checkpoint progress, respect Start.gg limits (same approach as the prior majors backfill). Safe to re-run; only fills gaps.
- **Logged coverage:** print events/games/sets created and any (tournament, game) skipped for missing Start.gg Top-8 data — no silent gaps.

Runs **out of band** (locally or a Render one-off), not in the request path or the boot hook.

### 4.2 `getMarkets()` scope
`pastOnly` branch gains a 2026 guard and only returns tournaments that actually have settled markets. Past results are **paginated/filterable** server-side (or filtered client-side after a scoped fetch) — 82 pills cannot all hydrate at once.

### 4.3 Outright betting on the waiting-room bracket
No new market type. The projected node taps build an outright pick (player to win that tournament+game), placed through the **existing** fixed-odds `POST /api/bets` with its server-side futures-lock guard. The **singles-only** fixed-odds slip is lifted from `FutureTournaments.renderBetSlip` (the Singles/Parlay mode toggle and parlay placement are omitted — see §6).

### 4.4 Economy safety (must verify)
- `houseBankrollCents()` sums only `won`/`lost` **`set_bets`**; historical markets have **no** `set_bets`, so the bankroll/subsidy engine is unaffected.
- The live poller (`syncLive`) must **not** touch historical events: they are not `is_live`, dates are in the past, and the synthetic `startgg_set_id` prefix excludes them from live processing. Verify the poller's tournament selection skips them.
- Settled markets cache stale `p1/p2_live_odds`; the past query/render path must keep gating bet affordances by `state` (today's `Bracket` already does).

### 4.5 Redirects
`/brackets`, `/future-tournaments`, `/past-results` → `/tournaments` (client-side `<Navigate>`), preserving any bookmarks.

---

## 5. Frontend

- **Rename + reroute:** `LiveBetting` → mounted at `/tournaments`; nav label "Brackets" → "Tournaments" (keep the bracket icon). Bottom tab bar drops from **6 → 4** tabs (removes Futures + Results).
- **Upcoming pill:** make `WaitingRoom` projected nodes bettable (outright); attach the fixed-odds slip.
- **Past section:** port the Results **filter bar** (Year · Tournament · Game, AND logic) + **show-more pagination** into the past band; fold in the **exhibition results** section (`/api/exhibitions/results`) currently unique to Results.
- **Remove pages:** delete `FutureTournaments.*` and `PastResults.*` **except** the *global utility classes* other components depend on — `.filter-select`, `.filter-tab`, and the exhibition results table styling (used by `ExhibitionSection`, `WaitingRoom`, and the ported filter bar). Relocate those into a shared stylesheet (e.g. `index.css` or a new `shared-filters.css`) before deleting `PastResults.css`.
- **Rewire cross-links:** Home's four "Browse futures" CTAs (`Home.js:402/447/461/572`) and the "See all" results link (`Home.js:615`) → `/tournaments`.

---

## 6. Out of scope / quarantined (pre-existing, not introduced here)

These exist today and are **not** blockers for this consolidation; flagged for a separate pass before EVO:

- **Cross-tournament parlays — deferred.** Outright betting on the new surface ships as **singles only**. The parlay engine (`parlays` / `parlay_legs` / `POST /api/parlays`) and any existing placed parlays are left intact and continue to settle; we simply do not expose parlay *placement* on the Tournaments page. A future pass can reintroduce it via the cross-tournament slip drawer (legs span events, so it never belongs in a single pill). The Futures page's Singles/Parlay toggle and parlay slip code are dropped, not ported.
- **Parlay leg grading** reads the futures line, not `set_markets.winner_id` — a latent inconsistency once a game has both a futures market and a live Top 8.
- **`wallet_transactions.ref_type` collision** across `set_bet` / futures `bet` / `parlay` — needs a schema/version bump before a *single unified* "Your Bets" inside a pill. Home's existing rollup (`/api/bets` + `/api/live/bets`) already covers cross-type P&L and is untouched.

---

## 7. Phasing

- **Phase 0 — Ingestion:** build + run `backfill-top8-2026.js`; verify 82 events render as settled brackets; confirm no economy/poller interference.
- **Phase 1 — Futures merge:** outright betting on the waiting-room bracket; rename to Tournaments; redirect `/future-tournaments`; drop Futures tab + repoint Home CTAs.
- **Phase 2 — Results merge:** past filter bar + pagination + exhibition results into the past band; redirect `/past-results`; drop Results tab; relocate shared CSS; delete both old components.

Each phase is independently shippable to Render.

---

## 8. Testing

- **Ingestion:** unit-test the set→market mapping (round_int/round_text, winner_id, seeds); idempotency (re-run creates 0 new rows); a dry-run report of coverage per event.
- **Economy:** assert `houseBankrollCents()` unchanged after ingestion; assert `syncLive()` ignores historical events.
- **Frontend:** upcoming pill places an outright via `/api/bets`; past pill renders winner + scores read-only; filter bar narrows the 82-event set; redirects land on `/tournaments`; no broken styling after `PastResults.css` removal.

---

## 9. Open risks

- **82-pill density** — filtering + pagination are mandatory, not optional, for the past band to stay usable on mobile.
- **Start.gg completeness** — some 2026 events may lack clean Top-8 phase data; those degrade to the Grand-Final row we already have (graceful fallback, logged).
- **Ingestion volume** — potentially thousands of settled `set_markets` rows; confirm `getMarkets` queries stay fast (indexed on `tournament_id`, `state`).
