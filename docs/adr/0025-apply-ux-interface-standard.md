# ADR-0025 — Apply the UX interface standard to the Studio + runtime

- **Status:** Accepted
- **Date:** 2026-07-23
- **Scope:** Apply `docs/UX_INTERFACE_DECISION.md` (binding) to the screens already built
  (`platform/intake/`, `platform/review/`) and the respondent runtime. Also records the
  **hosting re-direction to the existing Netlify site** (supersedes the Vercel lean in
  ADR-0019's open question). No deploy work here — Stage 3C, still operator-gated.

## Context

A UX teardown of 12 competitors produced a binding interface standard: **one magic input →
value in seconds → signup deferred**, a default surface that never clutters, a one-question
respondent flow (progress from ~15%, 3–5 steps, email before result), a decisive result
(one pick + 2–3 grounded reasons + one CTA), and hard NOs to silent caps that disable a
live funnel and to manual per-product weighting. Much of what we built already matches; this
ADR records the refinements and two genuine tensions resolved honestly.

**Critical correction to the deploy target:** `fulltimedigi.com` is **already live on
Netlify**, deploying from `fulltimedigi-interactive-builder` (a full Arabic marketing site +
hand-built funnels + a GAS Sheets integration — the manual precursor our platform automates).
We will **edit that existing site**, not replace it: keep the marketing homepage as the
storefront (add "ابدأ مجاناً / Log in"), add the Studio as the app behind login, and phase
out the hand-built funnels gradually. This **redirects 3C** away from Vercel: server-side
generation → **Netlify Functions**; accounts + published funnels → **evaluate Netlify DB +
Blobs first** before any external DB. (Design note only here; 3C stays gated.)

## Decision — refinements applied (all test-green)

1. **Draft before any signup.** The flow already has no signup; kept that way. Account
   gating will live at **save/publish** (3C), never before the draft. (Checklist ✓.)
2. **No blank state; advanced hidden.** `review.html` always renders the smart-default
   draft and adds a collapsed **"الإعدادات المتقدّمة"** surface (off by default) holding a
   few **safe brand overrides** (theme) that re-preview from the draft. **No manual
   per-product weighting** anywhere — the note says so explicitly.
3. **Progress starts ~15%.** `engine/progress.js` gains `progressPercent()` with a **15%
   momentum floor**, monotonic, capped at 100.
4. **3–5 steps (honest reconciliation).** `engine/flow.js` `respondentStepCount()` counts
   **question screens + the email-capture screen**. Authored funnels (2–3 questions +
   email = **3–4 steps**) land in range. **The anti-bland gate wins over padding:** we never
   invent an unjustified question to hit a step count — if a catalog only justifies 2
   questions, the honest count is 3 steps (incl. email), not a padded 3 questions. The count
   is **surfaced in the review model** (`summary.steps` / `stepsInRange`).
5. **Decisive result.** `engine/resultRenderer.js` honours `config.decisiveResult` (new,
   schema-documented; **AI-authored funnels set it true**): **one pick + ≤3 grounded reasons
   + exactly one CTA** (the product card's, to a real URL) — no "why not", no contextual
   grid, no second CTA. Opt-in, so reference funnels keep their richer layout and stay green.
6. **Brand continuity through capture.** `engine/leadCapture.js` renders the **brand name**
   on the capture step; it already lives in the same themed container, so styling is
   continuous from funnel → opt-in.
7. **Live anticipation, not a blank wait.** `intake/start.html` walks the **real pipeline
   phases** during generation and shows the **real product count** before handing off.
8. **No silent cap disables a live funnel** (posture): nothing in the platform caps or
   disables a running funnel; when usage limits arrive (3C) they must **warn early and
   degrade gracefully**, never dark a published funnel. Recorded as a standing rule; no cap
   code exists to add.
9. **Real hosted URL alongside the embed.** Already delivered (ADR-0021/0022 `buildHostedUrl`
   + `buildEmbedSnippet`) — satisfies the "don't rely on an SEO-harming iframe only" rule.

## Consequences

- The Studio + runtime now conform to the binding interface standard, proven by
  `tests/ux.standard.test.mjs` (progress floor, step count, decisive result) plus the
  review-model step assertions — all green, reference funnels unaffected (decisive is opt-in).
- **3C is re-scoped to the existing Netlify site** (edit, don't replace; Netlify Functions +
  Netlify DB/Blobs to evaluate first). ADR-0019's Vercel lean is superseded; a focused 3C
  recommendation will build on this when the operator opens that stage.
- Two honest reconciliations are on record: **3–5 steps counts the email step** (never pad
  questions past what the catalog justifies), and **decisive result is opt-in** so it governs
  authored funnels without breaking the hand-built reference bars.
