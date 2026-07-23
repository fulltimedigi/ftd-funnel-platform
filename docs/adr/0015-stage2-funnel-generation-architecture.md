# ADR-0015 — Stage 2: catalog → funnel-config generation architecture

- **Status:** Accepted
- **Date:** 2026-07-22
- **Scope:** Stage 2 authoring. Standing operator approval for Stage 2.

## Context

After deriving decision axes (ADR-0014), Stage 2 must emit a **complete, runnable funnel
`config`** — one the Decision core validates and the Runtime renders. The bar is high and
fixed: the generated config must pass **both** gates a hand-built one must pass —
`engine/validateConfig.js` (schema) and `engine/trustValidate.js` (the trust gate: TV1–TV5,
incl. a Cartesian **sweep** proving no dead-end cell and every result explained). The
design law is Results First, Questions Last, and the anti-fabrication law is absolute:
every result is a real SKU with a real URL, every reason resolves from the answers.

The trust gate is unforgiving, so the generator must be **correct by construction**. Read
against `trustValidate.js`, the sweep requires, for every reachable cell: a resolved
archetype, a `becauseTemplate` that resolves, ≥1 `why` bullet that fires, and a
`nextAction`. TV2 requires every question to feed a signal, every option of a required
signal to map, and every *derived decision* signal to be used by the table.

## Options considered

1. **Free-form / LLM-authored config, then validate-and-hope.** Rejected for v1: non-
   deterministic, risks fabricated reasons, and would frequently fail the sweep — the gate
   would reject most attempts. (An LLM *polish* pass is a later, separately-ADR'd option.)
2. **Score-and-match every product at runtime (no archetypes).** Rejected: doesn't fit the
   engine's decision-table + trust-sweep model, and makes "no dead ends" hard to prove.
3. **Deterministic decision-table generation, correct-by-construction against the gate.**
   Chosen.

## Decision

`authoring/author/index.js` — `authorFunnel(catalog)` builds a `decision-table` config:

- **Primary axis → results.** The top discriminating axis (ADR-0014; prefer product
  *type*) becomes the first question `q_primary`; each value becomes an **archetype**
  anchored to a **real representative product** from that group (most-complete product
  wins, deterministically). A `derivedSignals` identity `D_primary` feeds an ordered
  `decisionTable`: one rule per value → its archetype.
- **Totality without an orphan result.** A final `{ when:{}, result: <largest group> }`
  rule guarantees every cell resolves (no dead end) while reusing an existing archetype —
  so there is no unreachable "fallback" archetype (zero TV1 warnings).
- **Secondary axes → offer signals.** Up to two further axes (e.g. price band) become
  `role:"offer"` signals with their own questions; they gate **contextual** real-product
  recommendations within a group (offer optimization, design RULE 4). They are not derived
  signals, so they aren't orphan-checked; the sweep evaluates them at their declared
  default.
- **Reasons that always resolve + always defend.** Every `becauseTemplate` and `claim` is
  a **plain, token-free Arabic sentence** grounded in the user's choice — so
  `resolveTemplate` always resolves it — and every archetype carries a `why:[{needs:{}}]`
  (fires in every cell) plus a `nextAction`. This makes the sweep pass by construction. No
  fake-intelligence phrasing (no “% match”, personality, readiness, etc.).
- **No fabrication.** If the catalog has fewer than a handful of products or **no
  discriminating axis**, `authorFunnel` returns `{ ok:false, reason }` → the caller uses a
  vertical template. It never invents a product, a group, or a reason.

Deterministic, dependency-free, Node-safe. Result layout `commerce`. Output is a plain
config validated by the same two gates in tests — on a synthetic catalog now and on the
real **oudfactory** catalog as the live sample.

## Consequences

- The AI/authoring layer **cannot ship a funnel that fails the gates a hand-built one must
  pass** — the promise in `docs/ARCHITECTURE.md` is enforced in code.
- Every recommended product is real with a real URL; every shown reason traces to the
  user's answer (rules 3, 11).
- v1 copy is templated Arabic around real product/category names (honest, if plain); an
  LLM copy-polish and richer per-axis question wording are later enhancements (own ADR,
  cost surfaced), layered on top of this provenance-guaranteed base — never replacing it.
- Catalogs too thin to separate cleanly degrade to an honest "can't author" signal, not a
  fabricated funnel.
