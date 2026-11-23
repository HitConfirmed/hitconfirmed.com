---
name: vc-phase-monetization-benchmarks
description: 2025-26 benchmark numbers + revenue model + 90-day roadmap for monetizing MoneyMatch's non-redeemable-VC engagement loop (affiliate/ads/IAP/cosmetics/subscription)
metadata:
  type: project
---

How MoneyMatch's now-built daily-engagement loop (streak ramp, bust faucet, free Picks layer) converts to revenue in the CURRENT non-redeemable-VC phase. Complements the settled structure in [[recommended-structure]] and fee model in [[monetization-fee-structure]] (5% rake is LICENSED-phase only; this phase monetizes via the levers below, NOT rake).

**2025-26 benchmarks (researched 2026-06-21, sources captured in-conversation):**
- **Affiliate sportsbook CPA:** $50-$300+ regulated markets; $25-$50 mainstream (FanDuel $25-$35). Revshare 20-40% NGR (up to 50%, often lifetime/730d). Hybrid e.g. $60 CPA + 20% rev. **At low volume take CPA, not revshare** (deterministic, front-loaded, no NGR-accounting exposure). Operators vet on quality-not-volume — niche high-intent FGC audience is sellable.
- **Rewarded video eCPM:** US tier-1 ~$15-$40 ($16.49 Android / $19.63 iOS); CA slightly below US. >90% completion. 2-3x interstitial, up to 10x banner (banner <$1). Use REWARDED placements, not banners.
- **Social-casino ARPDAU:** $0.94 (SciPlay) - $1.39 (DoubleDown Q3'25), highest of any genre. ~1.9% any-month payer; ~12% first-time-purchase social casino; whales ~2% of users spend $500-$5k, top 5% = 48% of IAP. **Discount HARD for non-redeemable** — model used $0.10-$0.30 ARPDAU (1/5-1/10 of genre).
- **Subscription:** catalog services ~$9.80/mo (don't anchor a single indie app there); realistic indie = $4.99/mo "Pro Picks" at 2-4% attach.
- **Cosmetics:** no clean isolated benchmark; folded into IAP/ARPPU, not a separate DAU-scaled line.

**Revenue-model dominance by DAU (assumptions: ads $0.54/DAU/mo; IAP $0.15 ARPDAU; affiliate 40% geo-eligible x 2% FTD x $120 CPA; sub 3% x $4.99):**
- **500 DAU (~$3k/mo):** ads are the dependable floor; IAP looks biggest on paper but = ~10 payers (one-whale variance).
- **5,000 DAU (~$31k/mo):** token sales dominate, affiliate 2nd, ads 3rd.
- **50,000 DAU (~$307k/mo):** token sales >> affiliate ($48k) >> ads.
- IAP is highest-variance line — instrument payer conversion early to replace the assumption.

**Roadmap order (solo dev):** (1) analytics+attribution wiring [pipeline already built], (2) rewarded-video SDK, (3) token-sale IAP + cosmetics [legal-gated], (4) affiliate CPA deal w/ AGCO-registered book, (5) subscription last.

**Built attribution asset:** `affiliate/router.js` + `affiliate/repo.js` already implement the full S2S pipeline needed to get paid — HMAC-signed postback verified before parse, click_id deep-link attribution, `UNIQUE(book, external_ref)` idempotent dedupe, `isWithinWindow` attribution window, validate/reject reconciliation states, and `commission_model`/`commission_value` fields that support BOTH CPA and revshare. Remaining work = swap mock book for a real partner's spec, not rebuild.
