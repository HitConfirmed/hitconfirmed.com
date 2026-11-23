# Money Match — Bracket Pick'em & Scoring Spec

The free-to-play core. Users predict match outcomes through a live tournament bracket; correct picks earn points (leaderboards) and coins (virtual currency). This is the layer that runs in **every** geo and on **every** match — because it's virtual-only, no real money, there's no age/jurisdiction gate on it. The affiliate "Place on [Book]" button remains a separate, eligibility-gated extra layered on top; pick'em never depends on it.

This spec reuses the entities from the affiliate/community-odds design (`events`, `participants`, `markets`, `selections`, `picks`, `users`) rather than introducing a parallel system.

---

## 1. Scope

**In scope (v1):**
- Round-by-round match pick'em: pick the winner of each bracket match whose participants are known.
- Difficulty-weighted scoring (upset picks worth more), round multipliers, streaks.
- Coins as an earned virtual-currency reward; points as the seasonal leaderboard metric.
- Community "people's odds" from pick distribution, with a fairness snapshot at lock.
- Leaderboards (global / per-game / per-event / per-season / friends).

**Out of scope (deferred):**
- Coin-staking / parimutuel pick mode (reuses `picks.stake_virtual`; phase 2).
- Full-bracket "perfect bracket" prediction with void chains (phase 2; v1 is round-by-round to avoid dependency voids).
- Top-8 placement predictor (separate mode; phase 2).
- Buying coins with real money (explicitly NOT in scope — keeps the layer pure FTP and out of gambling licensing).

---

## 2. Reused & extended data model

**Reuse as-is:** `events`, `participants` (incl. `is_adult_verified`), `selections`, `users` (incl. `virtual_balance`).

**Extend `markets`:**
```
markets (
  ...existing: id, event_id, type (match|outright|top8), status (locked|open|settled)...
  round            TEXT,     -- r1 | r2 | r3 | top8 | top4 | gf  (drives round_multiplier)
  round_multiplier REAL,     -- resolved from round at market creation
  locks_at         TEXT,     -- match start; picks freeze here
  community_split  TEXT,     -- JSON snapshot {selection_id: share} taken AT lock (fairness)
  winning_selection_id TEXT  -- set on settle
)
```

**Extend `picks`:**
```
picks (
  ...existing: id, user_id, selection_id, created_at...
  market_id       TEXT,      -- denormalized for lock/scoring queries
  stake_virtual   INTEGER,   -- NULL/0 in v1 free mode; reserved for phase-2 staking
  result          TEXT DEFAULT 'pending',  -- pending | correct | incorrect | void
  points_awarded  INTEGER DEFAULT 0,
  coins_awarded   INTEGER DEFAULT 0,
  scored_at       TEXT,
  UNIQUE (user_id, market_id)   -- one pick per user per match
)
```

**New: coin ledger (auditable virtual currency, mirrors the no-cash rule):**
```
coin_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  delta       INTEGER,        -- +earned; never sourced from real money
  reason      TEXT,           -- pick_reward | streak_bonus | daily_login | seasonal_reset
  ref_pick_id TEXT,           -- lineage when reason=pick_reward
  created_at  TEXT
)
-- users.virtual_balance = running SUM(delta); coins have NO cash value, no cash-out.
```

**New: leaderboard aggregates (derived, but materialized for speed):**
```
leaderboard_entries (
  user_id      INTEGER,
  scope        TEXT,   -- global | game | event | season
  scope_ref    TEXT,   -- NULL for global; game id / event id / season id otherwise
  points       INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  total_picks  INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  best_streak  INTEGER DEFAULT 0,
  updated_at   TEXT,
  PRIMARY KEY (user_id, scope, scope_ref)
)
```

**New: seasons (soft-reset aligned to the FGC circuit calendar):**
```
seasons ( id, name, circuit (cpt|twt|mixed), starts_at, ends_at )
```

---

## 3. Scoring system

A correct winner pick scores:

```
points = BASE * round_multiplier * upset_multiplier
```

- **BASE** = 100 (config).
- **round_multiplier** (later rounds matter more, prevents early runaway leaders):
  | round | multiplier |
  |---|---|
  | r1 | 1.0 |
  | r2 | 1.25 |
  | r3 | 1.5 |
  | top8 | 1.75 |
  | top4 | 2.0 |
  | gf (grand finals) | 3.0 |
- **upset_multiplier** rewards backing who the crowd doubted, read from the **lock-time** community snapshot:
  ```
  upset_multiplier = clamp( 1 / community_share_of_your_pick , 1.0 , UPSET_CAP )
  ```
  with **UPSET_CAP** = 3.0 (config). Backing a 30%-consensus player → 1/0.30 = 3.33 → capped 3.0; backing an 80% favorite → 1.25.

Wrong pick → 0 points, `result=incorrect`. Optional small flat **score bonus** (e.g. +25) if a "predict the set score" sub-pick is offered and exact (phase-1.5, behind a flag).

**Coins awarded:** `coins = round(points * COIN_RATE)`, COIN_RATE = 0.5 (config). Coins are status/spend currency; points are the leaderboard metric. Keep them distinct.

### Worked examples
- **R1 favorite (80% backing), wins:** 100 × 1.0 × 1.25 = **125 pts**, 63 coins.
- **Grand-finals underdog (30% backing), wins:** 100 × 3.0 × 3.0 = **900 pts**, 450 coins.
- **Top-8 even match (50%), wins:** 100 × 1.75 × 2.0 = **350 pts**, 175 coins.

The spread is intentional: bold, correct, late-round calls are where the leaderboard is won.

---

## 4. Lock & community-odds snapshot

- **Live (pre-lock):** `community_share(selection) = picks_for_selection / total_picks_on_market`. Surface as "People's odds" (e.g. "68% backing MenaRD"). Recompute on a short interval and cache — do not compute per request.
- **At `locks_at` (match start):** set `markets.status = 'locked'`, write the current split into `community_split`, and reject all pick create/edit on that market thereafter. The snapshot is what scoring reads, so the upset multiplier can't be gamed by late piling-on.
- Picks are freely editable up until lock.

---

## 5. Settlement pipeline (on match result)

When a market is settled with `winning_selection_id`:
1. Load all `picks` for the market.
2. For each: `result = correct|incorrect` (compare `selection_id` to winner).
3. Compute `points_awarded` (§3) using the **stored `community_split`**, set `coins_awarded`, `scored_at`.
4. Write a `coin_ledger` row (`reason=pick_reward`, `ref_pick_id`) and update `users.virtual_balance`.
5. Update every relevant `leaderboard_entries` scope (global, game, event, season): `points += `, `correct_count += (correct?1:0)`, `total_picks += 1`.
6. Update streak: correct → `current_streak += 1` (and `best_streak = max`); incorrect → `current_streak = 0`. Award `streak_bonus` coins at milestone streaks (e.g. 5/10/20) via the ledger.

Settlement must be **idempotent** — re-running for an already-scored market must not double-credit (guard on `scored_at` / a per-market settled flag).

---

## 6. Guardrails

- **Every match is eligible** for pick'em regardless of participant age or user geo — because it's virtual-only with no cash. This is the whole reason the free layer exists. (The age/geo gate lives ONLY on the affiliate handoff, not here.)
- **Coins have no cash value, no cash-in, no cash-out.** v1 has no way to purchase coins with money. If that ever changes it's a separate monetization/regulatory decision — flag, don't build.
- **One pick per user per market** (`UNIQUE(user_id, market_id)`); no edits after lock.
- **Snapshot integrity:** scoring reads the lock-time `community_split`, never the live split.
- **Idempotent settlement:** no double-credit on re-run.
- **Anti-farming:** rate-limit pick submission; note multi-account coin farming as a known risk but low-incentive given zero cash value. Region captured at pick time server-side (audit), not used to restrict pick'em.

---

## 7. Build order

1. Schema migrations (extend markets/picks, add coin_ledger, leaderboard_entries, seasons).
2. Pick CRUD with lock enforcement + UNIQUE constraint.
3. Live community-share computation + cache; lock snapshot.
4. Settlement/scoring pipeline (idempotent) + coin ledger + balance.
5. Leaderboard aggregation + streaks + seasons.
6. UI: match cards with pick action + people's odds; leaderboard screen; profile accuracy/streak stats. (Reuse the existing slip/card UI patterns.)

---

## 8. Acceptance tests (TDD)

1. Pick before lock → stored; edit before lock → updated; second pick same market → rejected (UNIQUE).
2. Pick at/after `locks_at` → rejected; market status flips to locked at lock time.
3. Community split: live share = count-weighted; snapshot written at lock equals the live value at that instant.
4. Scoring math: each worked example in §3 produces the stated points/coins from the stored snapshot.
5. Correct pick → ledger credit + balance increase + leaderboard points across all scopes; incorrect → 0, streak resets.
6. Upset multiplier honors UPSET_CAP; favorite pick floors at 1.0.
7. Round multiplier applied per round; GF worth 3×.
8. Settlement idempotency: re-running a settled market does not double-credit coins/points.
9. Streak: consecutive correct increments + milestone bonus fires once; an incorrect resets to 0.
10. Coins: no code path credits balance from a real-money source; no cash-out path exists.
11. Eligibility: a pick on a match with a sub-18 participant is accepted normally (no gate on the free layer).
12. Season scope: points accrue to the active season; a new season starts the user at 0 for season scope while global persists.

---

*Note: product/build design, not legal advice. The no-cash-value, no-purchase property of coins is load-bearing for keeping this layer outside gambling licensing — preserve it. Revisit with counsel before introducing any coin purchase, cash-out, or prize-with-monetary-value mechanic.*
