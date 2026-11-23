# Handoff: MoneyMatch — Premium Dark Sportsbook Redesign

## Overview
A full visual redesign of the MoneyMatch FGC betting app: a dark, premium sportsbook
look (gold-on-near-black) that replaces the current soft green/gold + Poppins theme.
Covers Home, Live Betting, Futures, Past Results, Login/Signup, and a new Deposit
(wallet top-up) modal. The information architecture and data are unchanged — this is a
**styling + a few small UX additions** pass, not a rewrite.

## About the Design Files
The file `MoneyMatch.dc.html` in this bundle is a **design reference created in HTML** —
a working prototype showing the intended look and behavior. It is **not** production code
to copy. Your task is to **recreate this design inside the existing React codebase**
(`client/src/components/*.js` + their `.css` files), using the app's established patterns
(React function components, per-component CSS, `react-router`, the existing fetch/API
layer and `UserContext`). Do not introduce new frameworks or CSS-in-JS — keep the current
plain-CSS-per-component structure and just change the styles + add the small new pieces.

## Fidelity
**High-fidelity.** All colors, typography, spacing, radii, and interactions below are final.
Match them exactly. Where the prototype uses inline styles, translate them into the
corresponding component `.css` files.

---

## Design Tokens

Replace the `:root` block in `client/src/components/Home.css` (and reuse app-wide) with:

```css
:root {
  /* surfaces */
  --bg:            #0A0C10;   /* page background */
  --panel:         #12151c;   /* cards, sidebars, modals */
  --surface:       #1b2029;   /* odds buttons, avatars, inputs-on-panel */
  --input:         #0d1016;   /* text inputs, inset wells */
  --border:        rgba(255,255,255,0.08);
  --border-soft:   rgba(255,255,255,0.06);
  --border-strong: rgba(255,255,255,0.12);

  /* text */
  --text:    #F3F1EA;
  --muted:   #8B909C;
  --faint:   #6b7280;

  /* brand gold (replaces the old green --brand) */
  --gold:        #E7B458;
  --gold-deep:   #d6a13e;
  --gold-grad:   linear-gradient(135deg, #E7B458, #d6a13e);
  --on-gold:     #1a1305;   /* text/icon color on a gold fill */
  --gold-tint:   rgba(231,180,88,0.12);

  /* status */
  --win:       #43D188;   --win-tint:  rgba(67,209,136,0.14);
  --live:      #FF5159;   --live-text: #FF6168;  --live-tint: rgba(255,81,89,0.12);
  --futures:   #8a7fd6;   /* "Futures" kind chip */

  /* shape */
  --r-card: 16px;  --r-hero: 22px;  --r-btn: 12px;  --r-pill: 6px;  --r-input: 10px;
  --shadow-hero: 0 24px 70px rgba(0,0,0,0.45);
  --shadow-gold: 0 8px 22px rgba(231,180,88,0.25);
}
```

### Typography
- **Display / headings / numbers:** `Saira` (weights 500–900). Used for the wordmark area,
  section titles (`h1/h2/h3`), odds, money, player names, status pills, stat values.
- **Body / UI:** `Hanken Grotesk` (weights 400–700). Paragraphs, labels, meta text.
- Load via Google Fonts:
  `Saira:wght@500;600;700;800` and `Hanken+Grotesk:wght@400;500;600;700`.
- **All money & odds use `font-variant-numeric: tabular-nums`.**
- Replace every current `Poppins` reference with `Hanken Grotesk` (body) or `Saira` (display).

### Page background accent (optional, on `--bg`)
```css
background:
  radial-gradient(900px 420px at 50% -120px, rgba(231,180,88,0.06), transparent 70%),
  radial-gradient(700px 500px at 100% 0%,   rgba(255,81,89,0.04),  transparent 70%);
```

### Keyframe (live dot)
```css
@keyframes mmPulse {
  0%   { box-shadow: 0 0 0 0   rgba(255,81,89,.55); }
  70%  { box-shadow: 0 0 0 6px rgba(255,81,89,0); }
  100% { box-shadow: 0 0 0 0   rgba(255,81,89,0); }
}
```

---

## Screens / Views → File mapping

| Screen | Prototype section | Codebase file(s) |
|---|---|---|
| Navbar | top `<nav>` | `Navbar.js` / `Navbar.css` |
| Home | Live hero, stat strip, Next Up, Your Bets, Recent Champions | `Home.js` / `Home.css` |
| Live Betting | match cards + bet slip + my bets | `LiveBetting.js` / `LiveBetting.css`, `Bracket.js` / `Bracket.css` |
| Futures | outright winner rows | `FutureTournaments.js` / `FutureTournaments.css` |
| Past Results | filterable table | `PastResults.js` / `PastResults.css` |
| Login / Signup | centered auth card | `Login.js` `Signup.js` / `.css` |
| Deposit modal | **new** wallet top-up | add to `Navbar.js` or a new `DepositModal.js` |

### Navbar
- Sticky, `background: rgba(10,12,16,0.82)` + `backdrop-filter: blur(14px)`,
  `border-bottom: 1px solid var(--border)`, padding `13px 28px`.
- Left: logo `<img>` (`MoneyMatch.png`, height ~38px) → links group.
- Nav links: Saira 14px/600. Idle `color: var(--muted)`; **active** = `color: var(--text)`
  + `background: rgba(255,255,255,0.07)`, radius 9px, padding `8px 14px`. The "Live" link
  has a pulsing red dot (`mmPulse`).
- Right: **Balance** pill (gold-tinted bg, gold value), a **Deposit** button (gold gradient,
  `color: var(--on-gold)`), and a circular avatar (clicking it routes to login/account).

### Home — Live hero
- Rounded `var(--r-hero)` panel, `border: 1px solid rgba(231,180,88,0.22)`,
  `background: linear-gradient(155deg,#181208 0%,#11141b 58%)`, `box-shadow: var(--shadow-hero)`.
- Top row: `● LIVE NOW` badge (red dot + Saira 700, color `--live-text`, letter-spacing .12em),
  a "N sets in play · EVO 2025, Las Vegas" line, and a ghost gold "Open live betting →" button.
- 3 mini match cards in a grid: game chip + round, two stacked odds buttons (see Odds button).

### Home — Stat strip
- 3 equal cards (`--panel`, `--border`, radius 14px, padding 16–18px): label (12px upper,
  `--muted`) + big Saira 24px value. Cards: **Balance**, **Open bets**, **7-day P&L**
  (P&L green if ≥0 else red).

### Home — Next Up / Your Bets / Recent Champions
- Section header = Saira 21px title + a gold "see all" link.
- **Next Up:** 3 cards — tournament name (Saira 17), gold date chip, location (muted), game
  chips (`--surface`/`--border`, radius 6px), and a countdown line with a green dot, top-bordered.
- **Your Bets:** 2-col cards — avatar (initials, gold text), pick name + kind chip
  (Live = red outline, Futures = purple outline), meta, right side = status pill + signed amount.
- **Recent Champions:** 3-col cards — game chip, ★ + winner (Saira 19), tournament·date,
  and a score chip (`3–1 def. Loser`, score in green).

### Live Betting (two-column: `minmax(0,1fr) 358px`)
**Match card** (`--panel`, `--border`, radius `--r-card`, padding 17–19px):
- Header: round text (Saira 600, **gold**) · right: `Pool $X` (muted, tabular) + state pill
  (`OPEN` = green tint / `STARTING` = red tint).
- Two **odds buttons** in a 2-col grid (see below).
- **Pool-share bar** (transparency): a thin 6px track (`rgba(255,255,255,0.06)`) split into two
  segments — player 1 = gold gradient at `p1%` width, player 2 = `rgba(255,255,255,0.18)` —
  with labels `Name · 58%` / `money in pool` / `Name · 42%` above. Percentages come from
  `p1_pool_cents / (p1+p2)`.

**Odds button** (the core interactive element):
- Base: `background: var(--surface)`, `border: 1px solid rgba(255,255,255,0.10)`, radius 11px,
  flex space-between, Saira; left = avatar(initials) + name, right = odds `<b>` (19px, tabular).
- **Selected** (in slip): `background: var(--gold-grad)`, `border-color: var(--gold)`,
  `color: var(--on-gold)`, `box-shadow: var(--shadow-gold)`.
- **Locked** (market `state !== 'open'`): `background:#13161d`, muted text, `cursor:not-allowed`,
  no click handler.
- Hover: `transform: translateY(-1px)`.

**Bet slip (right rail, sticky `top:88px`):** `--panel` card. Header "Bet Slip (n)" + gold count
badge + Clear. Each entry: pick `@odds` (odds in gold), `vs opp · game · round` meta, a stake
input (`--input` well, `$` prefix), `→ projected payout` (green), and a `×` remove. Totals row
(Total stake / Projected payout). A small parimutuel explainer paragraph (`--faint`, 11px).
Place button = full-width gold gradient, "Place N Bet(s)". Over-balance shows a red warning and
disables. **My Bets** card below: list of placed bets with status pill (PENDING gold / WON green /
LOST red) and signed amount.

### Futures
Same two-column layout as Live (shares the bet slip). Per game: a chip header
`SF6 · Outright Winner · Top 8 …`, then a column of **full-width pick rows** styled like the odds
button (rank `01`, avatar, name + seed note, odds on the right; selected → gold fill). Clicking
adds an outright pick to the same slip (`pickName`, `vs the field`, `EVO Champion`, odds).

### Past Results
- Title + subtitle, then **filter tabs** (`All / SF6 / Tekken 8 / GGST / MK1`): Saira 13/600,
  active = gold fill + `--on-gold`, idle = transparent + `--border`.
- A table card with a header row and grid rows
  `120px minmax(0,1.4fr) 84px minmax(0,1.2fr) 70px minmax(0,1fr)`:
  Date (muted, tabular) · Tournament · Game (Saira caps) · ★ Champion (Saira 700) ·
  Score (green, centered) · Runner-up (muted). Filter by `game`.

### Login / Signup
- Centered card (max-width 400px), nav hidden on this route. Logo on top, title
  ("Welcome back" / "Create your account"), tagline "Play-money betting on the FGC."
- Segmented **Log in | Sign up** toggle (active segment = `--surface` fill). Signup adds a
  "Display name" field. Inputs = `--input` wells, gold focus border. Gold gradient submit.

### Deposit modal (NEW)
Triggered by the navbar **Deposit** button. Fixed overlay
(`rgba(5,7,10,0.72)` + `backdrop-filter: blur(5px)`), click-backdrop-to-close. Centered
`--panel` card (max-width 420px):
- Header "Add play money" + `×`.
- "Current balance" inset row.
- 2×2 **preset buttons** (`$50 / $100 / $250 / $500`); selected = gold fill.
- A **custom amount** input (`$` prefix, numeric; deselects presets, updates the CTA live).
- Play-money disclaimer (`--faint`).
- Gold gradient **"Add $X"** button → `balance += amount` (ignore empty/≤0), then close.
  Wire to the existing wallet endpoint (`/api/wallet`) / `UserContext` balance.

---

## Interactions & Behavior
- **Add to slip:** tapping an open odds button (Live) or a futures row adds a pick; tapping a
  selected one is a no-op (toggle/remove via the slip `×`). Locked markets are non-interactive.
- **Stake → payout:** projected payout = `stake × odds`, recomputed per keystroke; slip totals
  sum across entries. Parimutuel note: payout is a projection at current odds.
- **Place bets:** moves slip entries into "My Bets" as PENDING, deducts total from balance,
  clears slip, shows a confirmation line; blocked if total > balance.
- **Deposit:** preset or custom amount, adds to balance, closes.
- **Results filter:** client-side filter by game.
- **Nav active state** from the current route. **Live dot** pulses (mmPulse).
- Hover: odds buttons & cards lift 1px / border warms to gold; gold buttons brighten.

## State Management
Keep using your existing API + `UserContext`. State needed per screen:
`balance`, `slip` (keyed by market+side, each with stake), `myBets`, plus UI flags
`depositOpen` / `depositAmount`, `resultsFilter`, `authMode`. These already map to your current
`LiveBetting.js` slip logic and wallet polling — mostly a styling change plus the deposit modal.

## Assets
- `assets/MoneyMatch.png` — the existing logo (unchanged; already in
  `client/src/assets/images/MoneyMatch.png`).
- `assets/fist-badge.png` — optional square favicon/mark derived from the logo's fist
  (use for the browser favicon; not required).
- No new fonts to vendor — both are Google Fonts.

## Ready-to-paste CSS
The `css/` folder contains drop-in restyles that keep your existing class names — paste each
over the matching file in `client/src/components/`:
- `Home.css` — includes the app-wide token `:root` block (keep it here or move to a global
  stylesheet) + every Home class + helper classes for the new stat strip.
- `Navbar.css` — adds `.navbar-deposit`, `.navbar-avatar`, `.live-dot` helpers (add the
  matching elements in `Navbar.js`).
- `LiveBetting.css` — match cards, odds buttons (with `.picked` gold state), slip, my-bets.
- `Bracket.css` — Top-8 bracket nodes, picked/win states, parimutuel pool bar.
- `FutureTournaments.css` — outright tables, bet slip, filters, react-select dark theme,
  collapsible game accordion.
- `PastResults.css` — results table + `.filter-tab` pill style (active = gold).
- `Login.css` — auth card, inputs, gold submit, optional `.auth-toggle` segmented control.

All seven share the same token set from `Home.css :root`. Because the tokens redefine the old
`--brand` (green) and `--brand-alt` to gold, much of any remaining un-edited CSS shifts to the
new palette automatically — but always change hard-coded light backgrounds (`#fff`, `#f4f8f4`,
`#eee`) to `var(--card)` / `var(--surface)` / `var(--border)`.

**Deposit modal** is new — there's no existing component for it. Add a `DepositModal.js`
(or inline it in `Navbar.js`) per the spec above; style it with the tokens (card = `--card`,
preset buttons mirror the odds-button `.picked` gold state, CTA = gold gradient).

## Screenshots
Reference renders of every screen are in `screenshots/`:
`1-home`, `2-live-betting`, `3-futures`, `4-results`, `5-login`, `6-deposit-modal`.
(Fonts may differ slightly from the live app — Saira/Hanken render correctly in-browser.)

## Files
- `MoneyMatch.dc.html` — the full design reference (open in a browser to interact with it).
- `support.js` — runtime needed only to open the reference locally; **not** for production.
- `css/*.css` — paste-ready restyled stylesheets: `Home.css`, `Navbar.css`, `LiveBetting.css`,
  `Bracket.css`, `FutureTournaments.css`, `PastResults.css`, `Login.css`.
- `screenshots/*.png` — per-screen reference images.

## Suggested order
1. Drop in the tokens + fonts; reskin `Navbar`. 2. `Home`. 3. `LiveBetting` + bet slip + match
cards (`Bracket`). 4. `FutureTournaments`. 5. `PastResults`. 6. `Login/Signup`. 7. Deposit modal.
