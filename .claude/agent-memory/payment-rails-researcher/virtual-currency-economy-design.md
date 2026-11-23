---
name: virtual-currency-economy-design
description: F2P social-casino economy-design norms (starting stack, daily drip, bust recovery, pacing, single-vs-dual currency) researched for MoneyMatch's non-redeemable token model
metadata:
  type: project
---

Researched 2026-06-19: virtual-currency economy-design best practices for a F2P social-casino app, to inform MoneyMatch's **non-redeemable social-token** model (see [[recommended-structure]]).

**Key distinction to preserve:** the prior decision rejected the **sweepstakes redemption** (cash-out of a second "Sweeps" currency) on regulatory grounds — 2025-26 US state bans, CA AB 831 effective 2026-01-01. It did **NOT** reject the broader *economy-design mechanics* (starting stacks, daily faucet, bust recovery, bet pacing). Those mechanics are reusable for a single non-redeemable currency. Don't conflate "no sweeps cash-out" with "no engagement economy."

**Why:** MoneyMatch runs non-redeemable tokens (no `withdrawal` path), so it can adopt social-casino retention loops freely — the regulatory risk lived in *redemption*, not in *free daily coins or bust-recovery*.

**How to apply:** If/when MoneyMatch adds a play-money or social mode, reuse: big starting stack (sessions-not-minutes), daily login drip with 7-day streak ramp + reset, hourly/time-gated faucet for bust recovery, optional watch-an-ad top-up, and a minimum floor so a busted user is never at zero. Keep any second currency **non-redeemable** to stay clear of the rejected sweeps model.

Concrete 2025-26 reference numbers captured in the research (Stake.us 250k GC + $25 SC welcome; Chumba 2M GC + 2 SC welcome, daily 0.25→3 SC 7-day ramp; Zynga Poker 2-4h faucet wheel + friend gifting + bust top-up). Full numbers were returned to the user in-conversation, not re-saved here.
