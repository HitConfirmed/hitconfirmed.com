# Redesign: premium dark sportsbook theme + Deposit modal

## Summary
Reskins the entire MoneyMatch client from the soft green/gold + Poppins theme to a premium
**dark sportsbook** look (gold-on-near-black, `Saira` display + `Hanken Grotesk` body), and adds
a working **Deposit** (play-money top-up) modal. Information architecture, routes, data flow,
and the API layer are unchanged — this is a styling pass plus one small new feature.

## What changed

### Theme / design tokens
- New app-wide token set in `Home.css :root`: dark surfaces (`--bg #0A0C10`, `--card #12151c`,
  `--surface #1b2029`), gold brand (`--gold #E7B458` + `--gold-grad`), and status colors
  (`--win`, `--live`, `--futures`). The old `--brand`/`--brand-alt` are repointed to gold so
  legacy references inherit the new palette.
- Fonts swapped: `Poppins` → `Hanken Grotesk` (body) / `Saira` (display, numbers). Money and
  odds use `font-variant-numeric: tabular-nums`.

### Component restyles (same class names, dark/gold)
- `Navbar` — flat translucent bar, active-route chip, balance pill, gold **Deposit** button,
  account avatar, pulsing live dot.
- `Home` — dark live hero, stat strip (Balance / Open bets / 7-day P&L), Next Up, Your Bets,
  Recent Champions.
- `LiveBetting` + `Bracket` — match cards, gold "picked" odds buttons, parimutuel pool-share
  bar, bet slip + my-bets rail.
- `FutureTournaments` — outright tables, dark react-select, bet slip.
- `PastResults` — results table + gold filter-tab pills.
- `Login` / `Signup` — dark auth card, gold submit, optional segmented toggle.

### New: Deposit modal
- `components/DepositModal.js` + `DepositModal.css`: preset amounts ($50/$100/$250/$500), a
  custom-amount field, balance preview, backdrop/Esc to close, gold CTA. Wired from the navbar
  Deposit button; calls `onConfirm(amountCents)` and refreshes the balance badge.

## Backend note
The modal expects an endpoint to credit the wallet, e.g.
`POST /api/wallet/deposit { userId, amountCents } → { balanceCents }`. If one doesn't exist yet,
add it (mirror the existing `/api/wallet` read + `wallet.js` logic). Until then it can run
optimistically client-side for demo purposes.

## How to apply
1. Replace each `client/src/components/*.css` with the matching file in `design_handoff_moneymatch/css/`.
2. Copy `design_handoff_moneymatch/components/DepositModal.{js,css}` into `client/src/components/`.
3. Add the small JSX bits noted in the handoff README: navbar Deposit button + avatar + live dot,
   Home stat strip, PastResults filter tabs, and mount `<DepositModal />` from the navbar.
4. Load the two Google Fonts (`Saira`, `Hanken Grotesk`) in `index.html` / global CSS.

## Testing
- [ ] Each route renders in the dark theme (Home, Live, Futures, Results, Login).
- [ ] Live odds buttons toggle the gold "picked" state; slip totals + projected payout update.
- [ ] Deposit modal: presets select, custom amount updates the CTA, empty/0 is ignored,
      balance updates in the navbar after confirming, Esc/backdrop close.
- [ ] Mobile: navbar collapses, two-column betting layouts stack.
- [ ] No regressions in bet placement, wallet polling, or auth.

## Screens
See `design_handoff_moneymatch/screenshots/` for reference renders of all six screens.
