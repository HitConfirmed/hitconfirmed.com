---
name: us-virtual-currency-guardrails
description: US legal guardrails for free/social virtual currency vs sweepstakes in a wagering-style app (2025-2026 case law + state bans)
metadata:
  type: project
---

US-market legal/positioning research for keeping MoneyMatch's play-money virtual currency OUT of gambling regulation (2026-06). Secondary market — operator is Canada-based, Ontario-first (see [[operator-profile]]), but evaluated US guardrails on request.

**Two models:**
- **Social-casino (single non-redeemable currency):** one virtual currency, buyable for fun, NEVER cashable out / never redeemable for anything of value. Legal theory: no "prize" of value, so the gambling triad (prize + chance + consideration) is broken. This is the model that fits MoneyMatch's [[recommended-structure]] non-redeemable-token track.
- **Sweepstakes (dual-currency Gold Coins + Sweeps Coins):** GC = fun-only; SC = free bonus + AMOE, redeemable for cash/prizes. Legal theory: removes *consideration* via "no purchase necessary" + equal-dignity AMOE. **This model is collapsing** — do not pursue.

**Why purely-free + no-cash-out is safest:** removing the redeemable prize is more defensible than removing consideration. You control it absolutely (a code path), vs. AMOE which courts can pierce if the free route is inferior.

**The line NOT to cross — when "play money" acquires monetary value (= gambling/"thing of value"):**
- **Kater v. Churchill Downs (9th Cir. 2018, Big Fish Casino):** virtual chips were a "thing of value" under WA law BECAUSE they extended the privilege of play AND a transfer/secondary market let players effectively cash out → illegal gambling → **$155M settlement** (CDI $124M + Aristocrat $31M). The cautionary tale.
- **Mason v. Machine Zone (4th Cir. 2017, MD):** opposite result — no cash-out, non-transferable, revocable license → NOT gambling ("loss" happened at purchase, not the spin). The safe-harbor template.
- WA broad "thing of value" definition is harshest; CA/MD friendlier. Jurisdiction-specific.

**Design rules to keep coins valueless:** no official cash-out/withdrawal path; non-transferable between users; no operator-blessed or tolerated secondary market (police RMT); ToS: no monetary value, revocable license, entertainment-only; don't let coins buy real-world goods.

**Refills/daily bonuses:** fine and encouraged in the social model precisely because the coins have no cash value — free refills reinforce "no real money at stake." (In sweepstakes they're a compliance *requirement* via AMOE; different reason.)

**2025-2026 enforcement climate (deteriorating for sweepstakes; pressure spreading to social):**
- Sweepstakes statutory bans: CA (AB 831, eff. 2026-01-01, extends misdemeanor liability to operators+payment processors+affiliates), CT (SB 1235, Class D felony), NY (SB 5935A, Dec 2025), IN (HB 1052, eff. 2026-07-01), + MT, LA, TN (AG C&D to ~40 ops). Pre-existing-law blocks: ID, MI, WA. 16+ states moved in 2025.
- Social-casino MDL: Judge Davila (N.D. Cal.) let RICO claims vs. Apple/Google/Meta proceed (Sept/Oct 2025), no Section 230 shield — though CA state-law claims dismissed. App-store 30% cut framed as profiting from gambling.

**Takeaway for builder:** single non-redeemable currency + hard no-cash-out + non-transferable + clean ToS = strongest position. Avoid dual-currency sweepstakes entirely. Skill-based framing helps on the *chance* element but does NOT cure a redeemable-prize problem.
