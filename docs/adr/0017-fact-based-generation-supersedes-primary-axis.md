# ADR-0017 — Fact-based generation (facts → derive the product), supersedes the primary-axis approach

- **Status:** Accepted (supersedes the generation approach of ADR-0015)
- **Date:** 2026-07-23
- **Scope:** Stage 2 authoring. Standing operator approval for Stage 2.

## Context

ADR-0015's generator made the top axis the **primary question** and mapped its value
1:1 to the result. The Anti-Bland gate (ADR-0016) — and the standard it enforces —
classifies exactly that as a **mirror question**: it asks the user to pick the product
category and hands it back, with zero derivation. The gate (correctly) rejects the
ADR-0015 output. Per the standard, the fix is to **fix the generation**, never weaken the
gate: ask **facts** and **derive** the product from a *combination* of signals.

## Decision

Rewrite `authoring/author/index.js` to a **fact-combination matching** generator:

- **Fact axes.** Build categorical, fact-framed axes from the catalog: **budget** (price
  tertiles), **style/attribute** (a categorical axis from the top keyword facets — each
  product's dominant term), and **use/type** (product type). Each is asked as a fact
  ("ما ميزانيتك؟", "أي طابع تفضّل؟", "لأي استخدام؟"), never "which product?".
- **Derive, don't mirror.** Every product has a value on each axis. The decision table
  maps **every fact-combination** to the **real product that best matches it** (score =
  axes matched; deterministic tie-break). Because the result depends on the *combination*
  of ≥2 signals, **no single question determines it** — it is structurally not a mirror,
  and influence is spread (no >50% dominance).
- **Results = real products**, each with a real URL, a `becauseTemplate` grounded in the
  product, answer-grounded `why` bullets (gated on the axes the product carries), a
  **why-not** (RULE 9/11), and a next action.
- **Reject-and-regenerate.** `authorFunnel` runs the **trust gate and the anti-bland gate**
  on each candidate axis-set (pairs, then triples) and returns the first funnel that passes
  **both**. If no axis-set yields a non-bland, gate-passing funnel, authoring is **refused**
  (`ok:false`, `reason:"no-nonbland-funnel"`) — honest, use a template, never ship bland.
- The end-to-end pipeline (`authoring/index.js`) now also runs and returns the anti-bland
  result, and the CLI reports all three gates.

Requires ≥4 products and ≥2 discriminating fact axes; otherwise refuses (honest).
Deterministic, dependency-free, Node-safe. Tests: the generator's output passes schema +
trust + **anti-bland**, questions ask facts (≥2 combining signals), provenance holds end
to end, and thin/flat catalogs are refused.

## Consequences

- Generated funnels ask facts and **derive** the recommendation from a combination — they
  read as a diagnosis, not a dropdown (the standard's FINAL PRINCIPLE), and they pass the
  automated anti-bland gate in CI.
- The gate is an active part of generation (reject-and-regenerate), so the AI literally
  cannot emit a bland funnel; if the catalog can't support a non-bland decision, it says so.
- ADR-0015's primary-axis mapping is superseded; its "real SKU + provenance + gate-passing
  by construction" principles carry forward. Copy is templated Arabic grounded in real
  product/attribute names; an optional LLM polish (own ADR, cost surfaced) can enrich
  wording later on top of this provenance- and anti-bland-guaranteed base.
