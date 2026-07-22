# ADR-0009 — Make configs/_schema.json executable at boot (and fix the drift it exposed)

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

Stage 0 (ADR-0003) calls for the config schema to be made **executable**: "both engines
left the schema decorative — fix that", and lists "schema ↔ validator drift" as a bug to
resolve with a "single executable source".

State from the v0 seed: `configs/_schema.json` is a complete draft-07 contract (types,
`required`, `enum`, `$ref`, `definitions`) but **nothing runs it** — a broken config is
only discovered when the engine happens to trip over the missing piece at render time.
The production engine has a 704-line hand-written `config-validator.js` whose rules
**drift** from the JSON schema (e.g. archetype-count bounds differ) — two sources of
truth that disagree.

Constraint (ADR-0004): zero-build, **no dependencies** — so no `ajv`.

## Options considered

1. **Port production's 704-line hand-written validator.** Rejected: it *is* the drift —
   a second source of truth that disagrees with the JSON schema, and far more code than
   our schema needs.
2. **Keep the schema decorative; rely on runtime failures.** Rejected: that is the gap
   ADR-0003 says to close; failures surface late and unclearly.
3. **Write a tiny dependency-free validator that executes the JSON schema itself, run it
   at boot, and make the schema the single source of truth.** Chosen.

## Decision

- **`engine/validateConfig.js`** — a ~130-line, dependency-free JSON-Schema (draft-07
  *subset*) checker: `type`, `enum`, `const`, `required`, `properties`, `items`, `$ref`
  (`#/definitions/…`), `minItems`/`maxItems`, `minLength`, `minimum`/`maximum`. Extra
  properties are allowed (the schema sets no `additionalProperties:false`); annotation
  keywords are ignored. Pure, Node-safe, and it **never throws** — a malformed schema
  yields errors, not a crash. Returns `{valid, errors:[{path,message}]}` plus
  `formatValidationErrors`.
- **Executable at boot** — `boot()` now loads the sibling `_schema.json` (derived from
  `configUrl`, or an explicit `schemaUrl`) and validates before starting; if the schema
  can't be fetched, validation is **skipped honestly** (logged), never faked.
  `createFunnel` accepts an optional `deps.schema`, validates when given, logs violations
  (`console.warn`), and exposes `api.getValidation()`. No schema supplied → skipped, so
  every existing suite is behaviourally unchanged.
- **Schema tightened** to encode the documented structural contract as executable rules:
  `questions minItems 1`, `options minItems 2`, `archetypes minItems 2` (a hard floor — a
  decision funnel needs ≥2 outcomes; the 4–7 "sweet spot" stays advisory). All four
  shipped configs satisfy these.

### Drift the executable schema immediately exposed (and how it was fixed)

Turning the schema on flagged `asq-perfume.json` as invalid: its **contextual**
recommendations lack `becauseTemplate`, which `definitions.recommendation` required for
*every* recommendation. Investigation showed the schema — not the config — was wrong:

- `engine/recommend.js` enforces the "no recommendation without a resolved because" rule
  on the **primary** only; a contextual offer whose `becauseTemplate` is absent/unresolved
  is simply **not given a reason line** (generic funnels) or **omitted** (decision-table
  funnels) — never fabricated.
- `engine/trustValidate.js` **TV1** blocks a primary missing `name/url/becauseTemplate`,
  but does **not** block a contextual one for a missing because.

So `becauseTemplate` is genuinely **mandatory for primary, optional for contextual**. The
schema was stricter than the engine's real, intentional contract. Fix: split the
definition into `recommendation` (primary — `becauseTemplate` required) and
`contextualRecommendation` (contextual — only `name`+`url` required), and point
`recommendations.contextual[]` at the latter. `asq-perfume.json` is valid under the
engine's true contract — no fabricated reasons were added to force a pass (rule 3).

## Consequences

- The schema is now the **single, executable source of truth**, run at every real boot;
  contract violations surface immediately with a path + message instead of as late,
  cryptic runtime failures.
- The `recommendation`/`contextualRecommendation` split makes the schema agree with the
  engine and the trust gate — the drift is gone, and the schema now *documents* the real
  primary-vs-contextual rule.
- `api.getValidation()` gives the (future) authoring layer and an operator "validate-config"
  tool a ready result to display.
- The subset validator can grow keywords as the schema does; it is not a general-purpose
  JSON-Schema engine, by design.
