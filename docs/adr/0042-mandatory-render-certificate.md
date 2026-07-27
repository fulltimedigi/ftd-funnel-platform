# ADR-0042 — The render certificate is MANDATORY (remove the isKernelAuthored backdoor; ق21)

- **Status:** Accepted
- **Date:** 2026-07-27
- **Follows:** ADR-0037/0038 (kernel + render monitor), ADR-0041 (publish gate)

## Context

The render reference monitor (ADR-0038) minted a certificate — but only when `isKernelAuthored`
(`config.decisionTable.some(r=>r.proof) || config.constraintPolicy`). That made the certificate
conditional on a **config-classification flag, not a structural property**. An entry-point enumeration
of the render certificate guard (see `docs/standards/guard-entrypoint-enumeration.md`) found it covered
only **one of three** product-drawing layouts, and even `renderCommerce` had a backdoor:

- **commerce, kernel-authored** → certificate minted (the only certified path).
- **commerce, proofless** → `cert = null`, a **config-composited** product card, no certificate.
- **tracks / personas** → never call `certifyForRender`; render a recommendation + a brand-home CTA.

So 3 of 4 product-drawing paths rendered a product/CTA with **no certificate**, and the standalone
brand-home CTA (`ctaLink → config.cta.primaryUrl`) was exactly the forbidden fallback an earlier audit
flagged ("CTA returns the home URL") — indistinguishable, in code, from "the proven SKU URL was lost and
we silently fell back to home".

## Decision

The operator's rule: **the certificate is about the product claim, not the CTA destination.** Any screen
that displays a recommendation must be certified, and **every CTA on it derives from the certificate** —
generic and buy alike.

1. **Remove `isKernelAuthored`.** Any **decision-table** funnel MUST certify (`cert = certifyForRender(...)`);
   an uncertified/proofless path renders an honest **terminal** — never a config-composited product card.
2. **Delete the brand-home fallback.** `ctaLink(config)` is removed from every result screen. The ONLY
   result CTA is the certified product card's (`cert.cta_url`). No certificate → no CTA. A generic store
   link is never a value the render falls onto.
3. **No config-derived signature.** The signature product is built ONLY from the certificate's
   `CanonicalOfferRecord`; `cert === null` → no product card.
4. **Non-decision funnels (tracks/personas/dominant) carry no product claim and no CTA** — they have no
   certificate mechanism (GAP-4 coaching, GAP-5 scoring). Enforced by tests, not asserted.

## Consequences

- The proofless reference configs (`pm-certification-advisor`, `houseplant-advisor`) now render a
  **terminal** — **not a regression**: the backdoor was silently serving them. They remain design
  references (questions/copy/flow). Their render tests now assert the terminal (correct) behavior.
- **Certified render tests use a fixture MINTED from the real authoring pipeline**
  (`tests/lib/mintedFunnel.mjs`, oudfactory) — never hand-written proof fields, which would re-introduce
  the "fake proof passes the mechanism" disease.
- **Rejected (recorded):** giving the reference configs real proofs — it would require real houseplant /
  PM-certification catalogs that do not exist ⇒ **fabricating catalog data**, violating the
  constitution's first rule.
- **GAP-2 closed** for the backdoor; **GAP-4** (coaching) and **GAP-5** (scoring) recorded as mechanism
  gaps (not exemptions), contained by "no product claim / no CTA" and enforced by `tests/asq`,
  `tests/funnel.freelancex`, `tests/ux.standard`. Poison canary: reintroducing the backdoor reddens the
  suite. oudfactory mint rate re-measured after the render change: unchanged (100%, 18/18).
