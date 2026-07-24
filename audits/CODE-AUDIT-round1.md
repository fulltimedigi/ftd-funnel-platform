# Code Audit — Round 1 (report only), 4 parallel auditors + independent confirmation

**Date:** 2026-07-24. Branch: claude/stage-3-delivery. Verifier: independent (this session)
confirmed the top findings by reading the actual code — not relaying the agents.

## The headline (honest)
The ADR-0037 contract is **proven at PUBLISH time** (`verifyFunnel` re-runs the independent
reference evaluator over every table rule — this is real and holds) but is **NOT enforced at
RENDER time**, and **three "closed" bindings (safety, handoff, metrics) are unit-tested yet
UNWIRED** into the pipeline. So the *served* table is correct in the normal flow, but the runtime
"no-bypass" is warn-not-suppress, and several bindings pass their tests because nothing exercises
them in production — not because they hold end-to-end.

> Earlier live verification (this session) was TRUE for what it checked — authoring-time proofs,
> publish-time verifyFunnel, config version stamps, live decision-table behavior, gate integrity.
> It did NOT cover the runtime render path or module wiring. That is exactly the gap this audit found.

## CONFIRMED findings (I read the code)

| # | Sev | Location | Issue (confirmed) |
|---|-----|----------|-------------------|
| 1 | CRIT | resultRenderer.js:295-304 | Runtime verifier is warn-not-suppress: `recommendationCard`+CTA is pushed on `sigOk` (archetype path), then `relaxNote`→`verifyServedResult` runs AFTER and only appends a ⚠ line. A failed cert still ships the confident card + buy CTA. |
| 2 | HIGH | resultRenderer.js:240 | `verifyServedResult(config, resolved)` called with NO `clientVersions` → the STALE/version-coherence check never runs at render (version-mixing undetectable in prod; only tested). |
| 3 | HIGH | author/index.js:309 + decide.js | `r_default` → `overall` (global best product), NO proof. Missing/edited answer → derived signal undefined → no combo matches → r_default fires → `overall` renders; `verifyServedResult` passes (no proof = nothing to fail). The forbidden global fallback, invisible to the verifier. |
| 4 | HIGH | handoff.js, safety.js, metrics.js | ZERO production imports (grep-confirmed). Fail-closed safety guard + CTA-to-proven-SKU handoff + promise metrics are built & unit-tested but UNWIRED. CTA uses `config.cta.primaryUrl = homeUrl` (brand-home fallback — the forbidden thing). |
| 5 | HIGH | enrichAuthor.js:137,151 + grounding.js:86 | `designToAxes` "validates" only url-real + value-in-domain, stamps `provenance:"ai-validated"`; grounding grounds it SAT at MERCHANT tier. AI-inferred soft values become "verified matches" (BLOCKER-2 intent bypass). Mitigation: SOFT only, disclosed on mismatch, never a hard filter — a genuine design decision to reconcile, not a silent hard leak. |
| 6 | HIGH | author/index.js:74,82,250,257 + verifyFunnel.js:48,76 | Budget overshoot bound set to `nBudgetTiers` (= tier count) instead of 1; ordinal magnitude maxes at tiers−1 < nTiers, so the 1-tier cap NEVER triggers. verifyFunnel uses the SAME loosened bound → the oracle is blind. A format with only tier-0 & tier-3 products can relax 3 tiers (disclosed, but routed). My earlier live "max overshoot = 1 tier" was an empirical accident (nearest tier won by loss), not an enforced bound. |
| 7 | HIGH | author/index.js:221-231 (`simTo`) | Coverage backfill re-implements hard/ordinal/soft matching outside the kernel (G1 duplication): strict-format `-Infinity`, ordinal nearest-tier, soft equality. Orphan→archetype placement chosen by non-kernel logic (only NEVER_RELAX re-validated after). |

## REPORTED by agents (high-confidence, confirm during fix)

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| 8 | HIGH | resultRenderer.js:213-227,354-356 | "also consider" alternates render with no runtime certificate (verifyServedResult inspects only `.primary`). |
| 9 | MED | recommend.js:53-86 / verifyRuntime.js:45 | `resultExtras.variants` can override url/name/price; verifier compares the BASE url, not the variant-merged one → CTA can point to an unproven SKU. |
| 10 | HIGH | formatAxis.js:11,37 + kernel eligibility | null-format ("ambiguous") products → UNKNOWN on a NEVER_RELAX axis → ineligible on EVERY path → unreachable as primary AND alternate. Contradicts ADR-0034 "never orphaned." |
| 11 | MED | richnessCheck.js:77,80 + depthCalibration.js:162 | `deeperFeasibleExists` is ~always false by construction → the in-pipeline "≥4 questions" thin-tooth can't fire (only the standalone density heuristic has teeth — the path this session's independent test exercised). |
| 12 | MED | author/index.js:473-474 | Coverage floor degrades to best-effort: `pool = covPass.length ? covPass : candidates` — a low-coverage funnel is chosen when none meets 0.9. |
| 13 | MED | grounding.js:60-61,77 | Substring grounding: `type.includes(val)||val.includes(type)` ("soil"⊃"oil"); EXTRACTION `name.includes(val)` ("men"⊂"women"). Word-boundary needed. |

## Security (serverless) — mostly mitigated on the live preview (you set the secrets)

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| 14 | HIGH* | generate-background.mjs:19-23; http.mjs:28-33; generateJob.js:17-20 | Fail-open secret trio: `FTD_INTERNAL_SECRET`/`FTD_PUBLIC_TOKEN`/`FTD_ID_SALT` all skip the guard when unset → default deploy is wide open + guessable ids. *Mitigated on the current preview (you added the secrets); the CODE is fragile for any deploy that forgets them → fail-closed. |
| 15 | MED | generate-submit.mjs:18-25 | Daily-cost cap is TOCTOU-racy (Blobs no atomic increment) → bypass via concurrency. |
| 16 | MED | generateJob.js:47,60 | In-flight window (4 min) < job runtime (15 min) → duplicate concurrent Opus runs. |
| 17 | MED | netlify.toml `/embed/*` | Header override replaces the whole CSP with only `frame-ancestors *` → drops script-src/object-src/base-uri on config-rendering pages. |
| 18 | MED | ssrfGuard.js:65 | Numeric-IP encodings (`127.1`, `2130706433`, `0x7f..`, octal) bypass the `\d+\.\d+\.\d+\.\d+` IP check → SSRF residual beyond DNS-rebinding. |
| 19 | MED | funnel.html:42 / review.html:89 | `?config=<any https URL>` renders an attacker-supplied config under the trusted origin (content spoofing; not script-XSS since no innerHTML). |

## Dead code / duplication / test theater
- `_bestProduct`/`overall` = a second "best product" notion beside the kernel optimum.
- Two template tokenizers (`fillBecause` vs `resolveTemplate`); predicate matcher implemented 3× (decide/signals/gates).
- Price-band derived twice (`buildFactAxes` vs `deriveBudgetAxis`), the former filtered out but still computed.
- `compile.js:66 groundingReport`, retired `generate.mjs`, stale `enricher.mjs` doc — dead/stale.
- `invariant.universal.test` inspects only the authored table (never renders), and skips axes it can't ground → the "no silent override on any store" claim is narrower than stated.
- `presentation.test`/`safety.test` are green for `handoffTarget`/`safetyConstraintFor` — code that production never calls.
- `generate-background` (the most security-sensitive endpoint) has zero test coverage.

## Positives (verified, real)
- SSRF guard applied server-side + on every redirect hop; CORS never `*`-with-credentials; no innerHTML/eval/Function anywhere; href/src sanitizers block javascript:/data:; tenant isolation authoritative; the independent reference evaluator genuinely re-implements selection (publish-time). The kernel's core selection math (loss/compare/exact-dominance/UNKNOWN-ordering) had no counter-example.

## Root cause (one sentence)
The kernel is an **authoring-time prover**, not a **runtime gate** — and three of its newest
bindings were written + tested but never plugged into `compile`/`render` — so the guarantee is
real where it runs (publish) and absent where the shopper actually is (render).
