# ADR-0041 — Per-funnel publish gate + storage-crossing certified-render E2E

- **Status:** Accepted
- **Date:** 2026-07-27
- **Follows:** ADR-0037 (constraint kernel), ADR-0038 (render reference monitor), ADR-0039
  (discriminated COMMERCE|TERMINAL), ADR-0040 (fail-closed hardening)

## Context

The render reference monitor (ADR-0038) mints a `CertifiedSelectionResult` and, fail-closed, refuses
to draw a product card without one. Two gaps remained between "the kernel is correct" and "a real
visitor is protected":

1. **The publish boundary was ungated.** `platform/jobs/generateJob.js recordFrom()` persisted a
   generated funnel as `status:"ready"` (i.e. served) whenever `res.ok` — **without checking
   `res.verify.ok`** (the `verifyFunnel` proof-coverage result). A funnel with < 100% proof coverage
   could be published and served.
2. **The render proof was in-process only.** `tests/certified-render.e2e.test.mjs` exercises the gate
   on a **hand-built config, in one process** — so `proof.product_id === displayed url` holds *by
   construction* (a shared in-memory object). That is the same "proven on a self-authored fixture"
   illusion that made a Part-2 claim hollow: it never crosses the persist/serialize boundary and never
   sees catalog drift.

A Step-0 measurement (real authoring on the recorded oudfactory catalog, string prices, driven through
`certifyForRender` per answer-path) established the mint rate is **100% (18/18 answer-paths)** and that
authoring **does** emit gate-passing proofs — reconciling the apparent contradiction: the reason every
*live* funnel bypassed the certificate was solely that the shipped `configs/` are hand-built (no
proofs) and no authored funnel is published yet.

## Decision

1. **Per-funnel publish gate (fail-closed).** `recordFrom()` persists `status:"ready"` **only** when
   `res.verify && res.verify.ok === true`. A missing or failing `verify` yields
   `status:"error", reason:"publish-gate:proof-coverage-below-100"` — the funnel is generated but
   **withheld from serving**, with an honest reason surfaced to the poller. The real generate path
   (`generateFunnelFromUrl`) always attaches `verify`, so in production the only way to hit the closed
   branch is a genuinely gate-failing funnel. Chosen over a global runtime "flip" of the render gate
   (which would blank every funnel at once and has a large blast radius); the per-funnel gate enforces
   the same no-compromise — **no publish below 100% proof coverage** — at the door, funnel by funnel.

2. **Storage-crossing certified-render E2E.** `tests/step1.publish-serve.e2e.test.mjs` authors a real
   config from the recorded oudfactory catalog, **crosses the real persist/serve boundary**
   (`recordFrom` → `JSON.stringify` → `JSON.parse`), and renders three cases through the production
   `renderResult`:
   - **A** intact authored config → a product card whose CTA is the proven SKU;
   - **B** a proof deleted before serve → a terminal screen, no card, no CTA;
   - **C** proof intact but the displayed product **drifted** (post-publish edit / catalog drift) →
     rejected as a terminal, no card, no CTA. **This is the boundary the in-process measurement can
     never touch** — the proof/url match is re-verified from serialized bytes, not a shared reference.

3. **Explicit reference-config classification.** The shipped `configs/` are curated reference/demo
   funnels that predate the kernel — **not merchant deliverables**. They are classified
   **non-publishable / reference-only** in `configs/_classification.json`, and a live invariant
   (`tests/reference-classification.test.mjs`) requires **every** shipped COMMERCE config to either
   carry proofs **or** be explicitly listed reference-only. A new proofless commerce config is
   therefore a RED (author it through the pipeline, or classify it) — never a silent proofless card,
   and never a standing explained-away exception. Regenerating the reference bar
   (`pm-certification-advisor`) was rejected because its hand-tuned, browser-verified value is the
   reference itself.

## Consequences

- Merchant funnels ship **only** through authoring, which now cannot publish below 100% proof coverage.
- The certificate guarantee is proven across the storage boundary and against catalog drift, not merely
  in-process.
- **Known gap (see `docs/KNOWN-GAPS.md`):** a reference-only commerce config still renders on the
  legacy no-certificate path today (ق21 partial), and ق17 (staleness) is **structurally unenforceable**
  in the current single-artifact/embed deploy (`clientVersions === served` by construction) — not
  deferred, but disabled until a deploy shape that carries independent client version stamps exists.
- **Forward rule (binding):** a *hand-authored* merchant config bypasses the certificate. Any merchant
  funnel built by hand instead of through the authoring pipeline makes removing the `isKernelAuthored`
  gate **mandatory, not deferred**.
