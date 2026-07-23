# ADR-0016 — Anti-Bland quality gate for authored funnels

- **Status:** Accepted
- **Date:** 2026-07-23
- **Scope:** Stage 2 authoring. Standing operator approval for Stage 2.

## Context

`docs/standards/funnel-quality-anti-bland-standard-v1.md` (binding, and now in
`CLAUDE.md`) requires an **automated** gate the authoring layer runs on every generated
config, *alongside* `engine/trustValidate.js`, to reject "bland" funnels. The critical
gap it names: the runtime trust gate (TV2) rejects a **dead** question (no effect on the
outcome) but **not a mirror** question — a mirror question *does* affect the outcome (it
determines it 1:1), so it passes today. The ftd-os L2 rules
(`.claude/rules/layer-2-architecture.md`) add the 40% dominance, why-not, and real-SKU
gates. Our own generator (ADR-0015) currently emits a **mirror** primary question ("which
product type?" → answer = result 1:1) — so this gate is needed and must catch it.

## Decision

Add `authoring/author/qualityGate.js` — `antiBlandCheck(config)` → `{ok, findings}`,
deterministic, run over the same derived-signal **sweep** the trust gate uses (real
`decide()` / `buildRecommendations()`), enforcing the four patterns:

1. **Mirror (`BLAND_MIRROR`)** — reject if the result is a **function of a single
   decision signal alone** (that signal's value fixes the result across every other
   combination). This is the exact 1:1 case TV2 misses.
2. **Dominance (`BLAND_DOMINANCE`)** — per signal, an influence share = its pivotal
   result-transitions ÷ total; reject if any share exceeds the ceiling.
3. **Unjustified question (`BLAND_UNJUSTIFIED_Q`)** — a question whose signal changes
   neither the result nor any rendered offer/contextual across the whole space (RULE 4).
4. **Unjustified result** — every reachable result must have a real product URL
   (`BLAND_NO_REAL_SKU`), a `why` in every reachable case (`BLAND_NO_WHY`), and a
   `why-not` (`BLAND_NO_WHYNOT`) (RULE 9/11).

**Calibration (honest, empirical).** The dominance ceiling is enforced at **0.5**, not
0.40, on this influence metric — because the **reference bar**
(`pm-certification-advisor.json`, a known-sound funnel) legitimately measures **41%** for
its primary router; a 0.40 ceiling would false-positive the gold standard. The standard's
"~40%" is a guideline for the abstract "share of outcome"; the enforced number is metric-
specific and chosen so the reference passes while genuine single-question dominance (a
strict majority) and the exact 1:1 mirror both fail. The **mirror** check (100% functional
dependence) catches the case the "~40%" language is really aimed at. This is calibration,
**not weakening** — the reference must pass, and every bland pattern in the teeth test
still fails.

The gate is wired into the authoring output (ADR-0015): a config that trips any pattern is
**rejected and regenerated**; the generator is fixed to ask fact-based questions and derive
the product (never shipped bland). Tests (`author.antibland.test.mjs`) prove the reference
passes and each bland pattern (mirror, dominance-without-mirror, missing why-not, missing
real SKU) is rejected.

## Consequences

- AI-authored funnels can no longer ship a mirror/dropdown-menu funnel — the exact gap the
  standard names is closed in code, verified by a teeth test.
- The gate reuses the engine's real decision + explanation machinery, so it judges the
  funnel the user would actually experience, not a proxy.
- Consequence for the generator (ADR-0015): it must move from "primary axis = result" to
  **fact questions whose combination derives the product**, with a why-not per result —
  addressed in the next step. Catalogs that cannot yield a non-bland decision are refused
  (honest), not shipped bland.
