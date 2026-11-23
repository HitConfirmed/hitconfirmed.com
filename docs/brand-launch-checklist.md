# Hit Confirmed — Brand Launch Checklist

A working checklist for claiming the brand's domains + social namespace and standing up the
right platforms in the right order. Grounded in the verified research from 2026-06-24.

**Recommended handle:** `hitconfirmedgg` — the bare `hitconfirmed` is already taken on Twitch,
TikTok, YouTube & Reddit (checked 2026-06-24); standardize on this FGC-native fallback everywhere.
**Canonical domain:** `hitconfirmed.com`

---

## 0. Guardrails — read first, these govern everything

These aren't optional polish; they decide which platforms you can grow on and whether you
stay out of the licensed-gambling regime.

- [ ] **Keep Fight Money (FM) strictly non-redeemable.** No cash-out, no prizes/merch/gift
      cards, no crypto, no trading or secondary market. This is what keeps you in the lighter
      "social casino" bucket. The instant FM redeems for anything of value, you flip into the
      strict licensed-gambling regime (Meta/Google/TikTok) and into AGCO's scope in Ontario.
- [ ] **Distribution = web / PWA. No native Android app.** Google Play categorically bans
      simulated-gambling / social-casino apps with no exception. (Apple allows it at an 18+
      rating, but lead with the web app.)
- [ ] **Every gambling-adjacent surface:** 18+ framing, a visible "virtual currency — no real
      money" line, and nothing that reads as appealing to minors (watch cartoonish creative).
- [ ] **Get Ontario/AGCO-aware legal review** before any paid acquisition or before adding any
      FM redemption/value feature. The no-cash design helps but doesn't auto-clear you.

---

## 1. Domains

> **Availability checked 2026-06-24:** `hitconfirmed.com` ✅ available · `hitconfirmed.ca` ✅ available
> · `hitconfirmed.gg` likely available (no DNS record found; confirm at Porkbun checkout).

### Register
- [ ] **`hitconfirmed.com`** — Cloudflare Registrar (~$10/yr, at-cost). The canonical anchor and
      the domain you send all email from.
- [ ] **`hitconfirmed.ca`** — Cloudflare (~$9/yr). Cheap brand insurance; you're Ontario-based.
      Register under the CPR category you can document: **Canadian citizen** (simplest — no
      residency test, provable with a passport) or **permanent resident** (must meet the
      183-days-per-year "ordinarily resident" test). Keep proof handy in case of a CIRA RIV audit.
- [ ] *(optional)* **`hitconfirmed.gg`** — Porkbun (~$51/yr). The FGC-native vanity front door.
      Cloudflare can't *register* `.gg`, but you can still run it on Cloudflare (see below).

### Wire up
- [ ] Pick **`.com` as the single canonical domain.**
- [ ] **301-redirect** `.ca` (and `.gg` if bought) → `.com`. Don't split SEO authority across them.
- [ ] For `.gg`: add it as a zone in Cloudflare → let Cloudflare scan DNS → at Porkbun, **disable
      DNSSEC**, then set Porkbun's nameservers to the two Cloudflare-assigned ones (Full setup) →
      re-enable DNSSEC in Cloudflare. Propagation up to 24h. Tunnel + CDN then work normally.
- [ ] Point the **permanent URL (Cloudflare named tunnel)** at `hitconfirmed.com`.
- [ ] **Email:** send only from `hitconfirmed.com`. Set up **SPF + DKIM + DMARC** on it (Resend or
      similar) before sending anything — deliverability depends far more on auth + warmup than TLD.

---

## 2. Social handles — claim the namespace now

Lock the same handle everywhere **before any public announcement** — squatting travels with the
launch buzz, and prevention costs ~$15 vs thousands to reclaim.

- [ ] **Handle decision (checked 2026-06-24):** the bare `hitconfirmed` is **taken on Twitch,
      TikTok, YouTube, and Reddit**, so it can't be your consistent identity. Standardize on the
      FGC-native fallback **`hitconfirmedgg`** — verified open on Twitch, TikTok, YouTube, and
      Bluesky. (Other open fallbacks if you prefer: `playhitconfirmed`, `gethitconfirmed`,
      `hitconfirmedapp`.) Avoid period styles like `hit.confirmed` — blocked on X and Twitch.
      The brand name stays **Hit Confirmed** and the domain stays **hitconfirmed.com**; the `gg`
      suffix just reinforces the gaming identity.
- [ ] **Batch-check availability** in one pass: Namechk, KnowEm, or Checkusernames.
- [ ] **Claim on every platform in the table below**, even ones you won't use yet (defensive).
- [ ] Put the canonical handle **+ website link in every bio** (helps discovery even where the
      exact handle was taken).
- [ ] **Post at least once** on each within the first couple weeks so platforms don't reclaim the
      handle as inactive.
- [ ] Re-check coverage **quarterly** (new platforms launch constantly).

| Tier | Platform | Handle to claim | Status (2026-06-24) | ✓ |
|---|---|---|---|---|
| Anchor | X / Twitter | @hitconfirmedgg | login-walled — check `hitconfirmed` + fallback manually | [ ] |
| Live | Twitch | hitconfirmedgg | bare **taken** (since 2017) → fallback free | [ ] |
| Acquisition | TikTok | @hitconfirmedgg | bare **taken** → fallback free | [ ] |
| Acquisition | YouTube | @hitconfirmedgg | bare **taken** ("Hit Confirmed" channel) → fallback free | [ ] |
| Retention | Discord | hitconfirmedgg | not publicly checkable — claim at server setup | [ ] |
| Mirror | Instagram | hitconfirmedgg | login-walled — check manually | [ ] |
| Mirror | Reddit | u/hitconfirmedgg | bare **taken** → fallback (confirm at signup) | [ ] |
| Hedge | Bluesky | hitconfirmedgg.bsky.social | bare **free** & fallback **free** | [ ] |
| Ad infra | Facebook Page | hitconfirmedgg | login-walled — check manually | [ ] |

> Statuses confirmed via RDAP (domains), Twitch/TikTok/YouTube/Bluesky public endpoints. X,
> Instagram, Facebook block automated checks — confirm those by visiting the profile URL while
> logged out (a "page not found" = available). Re-verify everything at signup; states change.

---

## 3. Platform setup — in priority order

**Lead here (your real energy):**
- [ ] **X / Twitter** — the FGC town square. Announcements, results, clip reposts, callouts.
- [ ] **Twitch** — tie to live events; the FGC's live home.
- [ ] **TikTok + YouTube Shorts** — context-free hype clips (big combos, comebacks). Your main
      path to *new* viewers. Post consistently.
- [ ] **Discord** — your own server = the community core. Don't cold-spam other servers; partner
      with TOs/locals to grow it.

**Support / evergreen:**
- [ ] **YouTube long-form** — VODs, explainers, SEO.
- [ ] **Instagram Reels** — mirror your best TikTok clips. Low effort.

**Mirror / hedge / infra:**
- [ ] **Reddit** — participate in r/Fighters, r/Tekken, r/StreetFighter; obey each sub's sidebar
      and the 90/10 self-promo rule. Read rules before posting.
- [ ] **Bluesky** — light mirror; insurance against X.
- [ ] **Facebook Page** — set up barebones; you only need it as the backbone for running ads.

---

## 4. Bios — drafted, ready to paste

Keep them consistent. Every bio = what it is + the no-real-money line + 18+ + link.

**Short (X / Instagram / TikTok, ~150 chars):**
> Bet Fight Money on FGC tournament matchups 🕹️ Virtual currency, no real cash — just bragging
> rights. 18+ · hitconfirmed.com

**Medium (Twitch panel / YouTube / Discord "about"):**
> Hit Confirmed is the free prediction game for the fighting game community. Stake Fight Money (FM)
> on Tekken, Street Fighter, and more — no real money, all hype. Virtual currency only · 18+.
> Play: hitconfirmed.com

**One-liner (link-in-bio / tagline):**
> Virtual-currency prediction game for the FGC. No real money — all bragging rights.

Consistent elements to repeat everywhere: brand name **Hit Confirmed**, handle **@hitconfirmedgg**,
link **hitconfirmed.com**, the **"virtual currency / no real money"** line, **18+**.

---

## 5. Community credibility — participate, don't advertise

The FGC is grassroots and anti-spam. Reach here comes from contribution, not promotion.

- [ ] Set up a **start.gg** organizer presence; consider sponsoring/co-running a local or a League
      rather than buying ads.
- [ ] Publicly align with the **FGC Code of Conduct** (fgcoc.com) — a credibility signal.
- [ ] In Discord/Reddit, **clear any promo with mods first** and lead every mention with
      "no real money / virtual currency only." Expect some communities to still say no.
- [ ] Be visible around the calendar: EVO (Vegas, Jun 26–28 2026), CEO (Aug 14–16), local weeklies.

---

## 6. Before paid ads (later phase)

- [ ] Facebook Page + **Meta Business Manager** created.
- [ ] Complete platform authorizations/certifications **before** running anything:
      Meta (Authorizations & Verifications), Google Ads (social-casino certification),
      TikTok (gambling/games certification), Reddit (sales-rep pre-approval).
- [ ] All ad creative + landing pages: **18+ targeting**, "no real money / no prizes of real-world
      value" disclaimer, no minor appeal.
- [ ] No paid influencer/affiliate deals on **X** (it banned gambling paid partnerships).
- [ ] Legal sign-off (see Guardrails §0) before spend.
