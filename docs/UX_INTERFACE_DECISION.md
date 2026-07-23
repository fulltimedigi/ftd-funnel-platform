# UX / Interface Decision v1 — the platform's face

> **BINDING** direction for the platform UI (Studio + respondent funnel), same
> status as `PRODUCT_DECISIONS.md`. Referenced from `CLAUDE.md`. Do not silently
> deviate; if a decision needs to change, raise it with the operator and update this
> file. A visual companion mockup of this flow was reviewed and approved by the operator.

## How this was decided

We tore down the **user experience** (not just the feature list) of 12 competing
platforms — Typeform, Involve.me, Jotform, Outgrow, ScoreApp, Interact, Heyflow,
Perspective, Octane AI, Quizell, Prehook, Digioh — across G2 / Capterra / Trustpilot /
Shopify App Store reviews, help docs, and hands-on review blogs, plus SaaS onboarding /
time-to-first-value research (NN/g- and Baymard-cited). The findings converged hard, and
the operator approved the resulting interface. This is that decision, made binding.

**Design goal (operator's words):** an interface that is **simple, non-distracting, gives
the best UX, and structurally avoids the competitors' mistakes.**

---

## The core philosophy

> **One magic input → value in seconds → signup deferred.** The default surface stays
> radically simple and *never* rises into overwhelm; all depth is progressively disclosed.

Everything below serves that sentence.

---

## The recommended journey — 6 screens

Each screen does exactly one job. (This maps onto what we've already built in
`platform/intake/`, `platform/review/`, and the engine's runtime — see "Mapping" below.)

1. **Paste the URL.** One field: the brand/store URL. One optional, secondary input: the
   business goal. One button. **No form, no signup yet.** (Matches `PRODUCT_DECISIONS` §1.)
2. **Reads & builds (anticipation state).** Live progress — "reading your products… found
   47… deriving the decision… authoring questions…". **Never a blank wait.** The
   anticipation itself earns trust.
3. **The draft appears (the aha).** A complete, runnable funnel preview — **before any
   signup.** This is the activation event that wins the customer.
4. **Review & refine.** The draft is **editable from smart defaults, never a blank
   canvas.** The two gates (trust + anti-bland) run **visibly and honestly** — and block
   publish if the funnel can't be grounded. All advanced controls (logic, weighting,
   styling) are **hidden behind an "advanced" surface**, off by default.
5. **Respondent experience.** **One question per screen.** Progress bar **starts at ~15%,
   not 0%.** **3–5 steps.** Email captured **before** the result reveal. Tap-based, fast,
   mobile-first.
6. **Result.** **One decisive pick** + **2–3 real, answer-grounded reasons** + **exactly
   one CTA** to a **real product with a real URL.** No distraction, no ranked spinner.

---

## What we STEAL (proven patterns, built into the core)

| Pattern | Evidence | Our application |
|---|---|---|
| **Single URL cold-start** | Interact: URL → draft in <2 min — but nobody makes it the *whole* product | It **is** our product; guard the one-input entry |
| **One question per screen** | Typeform: ~47% completion vs ~21% for classic forms | The **only** respondent mode, not an option |
| **Progress bar from ~15% + 3–5 steps** | Heyflow: momentum-by-design, up to +40% completion | Respondent runtime default |
| **Decisive result page** | ScoreApp: score + 2–3 insights + **one** CTA | Constrained result = higher quality, zero user effort |
| **Edit a draft, signup deferred** | Onboarding research / Figma: value before signup, no empty state | Draft-first; account only at save/publish |
| **Native catalog sync on connect** | Octane: real-time Shopify sync | We do it **from a URL, automatically** (Stage 1 ingest) |

## What we AVOID (the mistakes that kill competitors' trust)

| Anti-pattern | Evidence | Our rule |
|---|---|---|
| **Silent hard caps that disable a live funnel** | Jotform / Typeform: form dies at the peak of success | A running funnel **never goes dark**; warn early, degrade gracefully |
| **Feature-clutter / cockpit overwhelm** | Jotform, Outgrow, Heyflow: "overwhelms beginners" | Default surface stays tiny; depth is progressively disclosed |
| **Manual per-product weighting** | Octane, Digioh: merchant hand-weights every SKU (+10/−10) | **Zero manual mapping** — the AI does it; this is our core advantage. Never ship a manual-weighting UI as the default path |
| **Confusing branching that forces full rebuilds** | Involve.me: pages on the wrong branch → rebuild everything | Branching is visual, forgiving, autosaved, undoable |
| **Over-restriction with no escape hatch** | Perspective, Interact: "everyone looks the same", can't recolor a button | Opinionated defaults **+ a few safe brand overrides** |
| **Mid-build paywalls / opaque scaling pricing** | Perspective, Outgrow (6× tier jump) | Transparent pricing; **no surprise gates during the build** |
| **"Basic" AI output shipped as finished** | Outgrow: weak first-draft copy erodes trust | Our **anti-bland gate** already blocks this — keep it |
| **Brand discontinuity at the capture moment** | Interact: branding breaks between quiz and opt-in | Brand continuity **end-to-end**, incl. the email step |
| **iframe embeds that harm SEO** | Heyflow: iframe lowers SEO | Offer a **real hosted URL** as well as the embed |

---

## Concrete UI rules (checklist for the build)

- [ ] Entry screen = **one URL field + one optional goal + one button**; nothing else, no signup.
- [ ] Generation shows a **live anticipation state**, never a blank spinner or dead wait.
- [ ] The generated draft is shown **before** any account/signup wall.
- [ ] Editing starts from the **smart-default draft**; there is **no true empty state** anywhere (pre-fill with the draft or a sample).
- [ ] **Advanced controls are hidden by default** behind a clearly-labelled surface.
- [ ] Trust + anti-bland gates are **visible** and **honestly block** publish when unmet (never hidden, never faked green).
- [ ] Respondent flow: **one question/screen**, **progress starts ~15%**, **3–5 steps**, **email before result**.
- [ ] Result: **one pick + 2–3 grounded reasons + one CTA** to a real product URL.
- [ ] **No usage limit ever disables a live/published funnel** — warn before, degrade gracefully.
- [ ] **No manual per-product weighting** in the default path.
- [ ] **Brand styling is continuous** from the funnel through the lead-capture step.
- [ ] Deliver a **real hosted URL** alongside the embed (don't rely on an SEO-harming iframe only).

---

## Mapping to what already exists

Much of this is already built and gate-verified — the research **confirms the direction**
and adds refinements:

- `platform/intake/` — the paste-URL entry screen → already URL-first + optional goal. **Refine:** ensure zero signup before the draft.
- `platform/review/` — re-runs trust + anti-bland client-side, blocks publish honestly → already matches "visible, honest gates". **Refine:** hide advanced behind a surface; keep the draft editable, never blank.
- Engine runtime — one-question flow + grounded result with real SKU/URL → already matches. **Refine:** progress bar starts ~15%; enforce 3–5 steps; result = one pick + 2–3 reasons + one CTA.
- **New work this decision adds:** no-silent-cap posture, brand-continuity through capture, and keeping *manual weighting* out of the default path.

---

## Positioning (the one line)

*Paste any brand URL → the AI reads the real catalog, derives the decision, authors a
trust-validated diagnostic that recommends real products with real reasons, and captures
the lead — behind an interface that never gets cluttered.* No competitor does this for an
arbitrary brand automatically. That is our place.
