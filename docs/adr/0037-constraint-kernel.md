# ADR-0037 — Promise Principle v3: the Constraint Kernel

Status: Accepted · 2026-07-24 · **supersedes the ad-hoc hard-axis fixes of ADR-0034 (format) and
ADR-0035 (budget)** — both are now typed constraints inside ONE kernel. Full spec:
`audits/PROMISE-PRINCIPLE-v3-SPEC.md` (branch `claude/project-review-assessment-oj8azk`).

## Context

ADR-0034/0035/0036 closed real leaks, but format and budget were two special cases bolted onto
the covering assignment, and matching *meaning* lived in three places: `_assignCovering`'s bespoke
scoring, `decide`'s label-equality `matchRule`, and the renderer's disclosure. That is fragile —
a new constraint type means editing all three, and "does this product match this answer?" had no
single authoritative answer. An external design review pushed for a real, if lightweight,
**constraint-satisfaction core**: one place that defines matching, a proof carried on every result,
and a verification that runs on real funnels — not just synthetic CI.

## Decision

Introduce a **constraint kernel** (`engine/kernel/`) and make it the single authority, under two
standing guardrails:

- **G1 — the kernel is the single source of truth for "matches".** The decision table is now a
  **materialized cache the kernel generates** (`authoring/author/index.js` calls `kernel.select`
  per answer-path); it carries no independent matching logic. `_assignCovering` kept ONLY the
  coverage policy — expressed as the kernel's *allowed tie-break between equal-quality matches*.
- **G2 — every result carries `catalog_version` + `policy_version`, and a deterministic
  re-verification runs before display.** Content-hash versions (`version.js`) detect staleness; a
  cheap runtime verifier (`verifyRuntime.js`) refuses to render a never-relax break.

### The kernel (`constraintKernel.js`)

1. **Three-valued status** — `status(constraint, answer, unitValue) → SAT | VIOLATED | UNKNOWN`.
   An ungrounded / missing value is **UNKNOWN**, never silently a match.
2. **Typed predicates** (answers compile to predicates, not label-equality): `nominal` (set
   intersection), `taxonomy` (ancestor-or-equal), `ordinal` (SAT iff equal; VIOLATED magnitude =
   tier distance), `price` (directional ≤cap; over-budget grows, under-budget is cheaper — never
   equal), `variant` (SAT only if a **purchasable SKU** satisfies the variant answers).
3. **Separated fields**: `ask_order` ≠ `relaxation_priority` ≠ `mode ∈ {NEVER_RELAX, RELAXABLE,
   ADVISORY}` ≠ `violation_distance`. Defaults: product-form + strict budget cap + safety →
   NEVER_RELAX; merchant-overridable.
4. **Selection = lexicographic partial-CSP** (not "drop & retry"): exclude any unit where a
   NEVER_RELAX constraint is VIOLATED **or UNKNOWN**; for each survivor build a loss vector
   `⟨(viol@prio, magnitude)…, unknownPenalty, advisoryLoss, tie⟩`; pick the lexicographic minimum.
   **Coverage is a tie-break ONLY**, between equal-loss candidates — it never overrides fit. An
   EXACT candidate can never be passed over for a COMPROMISE (asserted, not assumed). Relaxation
   **bounds** turn "too far" into a first-class **NO_MATCH**, not a confident card with a footnote.
5. **Result states**: `EXACT` / `COMPROMISE` / `UNVERIFIED` / `NO_MATCH`.
6. **Disclosure** is a **fresh re-comparison of the chosen unit to every answer** — conflicts
   (VIOLATED) and relevant unknowns get **distinct wording** ("اخترت وسط، وده فاتح" vs "لم نتمكّن من
   تأكيد …"). The renderer reads STRUCTURED fields (`resultRenderer.relaxNote` → `rule.proof`), so
   mobile / i18n / a11y can never hide a compromise.
7. **Grounding is per unit × claim** (compiled in `compile.js`): a present, structured profile
   value is trusted; an absent one arrives as UNKNOWN. One ungrounded product does not demote a
   whole axis — that product is UNKNOWN on that axis.

### No bypass

There is exactly **one constructor** of a `SelectionResult`, and it demands a passing verification
certificate. No global "best product" fallback, no stock substitution, no coverage reranking can
mint a renderable result that skips the kernel. The result schema carries the proof:
`{ product_id, variant_id, catalog_version, policy_version, match_state, matches[], conflicts[],
unknowns[], tie_break_reason }`.

### Verification — per artifact, not just synthetic

- **Publish-time exhaustive verification** (`verifyFunnel.js`, wired into both authoring paths and
  the pipeline boundary in `authoring/index.js`): the table is a **finite** set of reachable paths,
  so we enumerate every one and assert the six exit criteria. A funnel whose promise can't be
  proven is **never returned** — refuse-to-publish at the source.
- **Runtime cheap verifier** before render (`verifyRuntime.js`): re-reads the fired rule's proof;
  on a never-relax break it reports `ok:false` and the card shows the honest state instead.
- **Property / fuzz catalogs** (`tests/kernel.fuzz.test.mjs`): nulls, duplicate/dominated profiles,
  multi-label, numeric boundaries, single-product, all-identical, deleted-after-compile, price
  mutation — the kernel never throws and never breaks an invariant; authoring either refuses
  honestly or ships a funnel that passes publish-time verify.

### v3 exit criteria — proven for every reachable path

1. product & SKU exist in the served catalog version · 2. every NEVER_RELAX = SAT · 3. every
VIOLATED/UNKNOWN answer appears in the disclosure · 4. an exact candidate is never passed over for
a compromise · 5. the chosen unit is best per the declared violation vector · 6. no fallback /
coverage reranking can corrupt that vector.

### By-construction rank-1 guarantee (2 lines)

The kernel EXCLUDES every unit whose rank-1 (NEVER_RELAX) constraint is not SAT *before* the loss
vector is even built; a survivor therefore satisfies rank-1 by construction, and the chosen unit is
a survivor. Hence rank-1 is never relaxed — disclosed or not — on any path.

### Honesty > depth

When the catalog can't honestly support depth the funnel gets **shorter** — the anti-bland /
richness gates are unchanged, but "rich" now means *enough trustworthy differentiating data*, not
product count. Coverage is named honestly as **SURFACED coverage** (every SKU is a primary OR a
clearly-labeled alternate; alternates also pass the kernel); we do not claim universal
exact-primary coverage, which duplicate profiles / nulls make impossible.

## Consequences

- **One matching authority.** Adding a constraint type is one typed predicate in the kernel; the
  table, the renderer, and both verifiers inherit it. `decide`/`resolve` stay the cache consumers.
- **Proven, not asserted.** Every published funnel carries a certificate; the six exit criteria are
  checked exhaustively at publish time and re-checked at render time. Fuzz proves robustness on
  adversarial catalogs. Metrics (`metrics.js`) add exact-path-rate, max-relaxation-severity,
  unknown-attribute-rate, prefix-support, predicate-evidence-coverage, variant-validity,
  versioned, disclosure-rendering — **alongside** the untouched trust / anti-bland / richness gates.
- **Battery results.** Publish-time verify is clean on the oud-shaped fixture (27 paths), laptops
  (9), coffee (9); exact-path-rate 37 % (oud) / 67 % (laptops, coffee), max relaxation severity 1
  tier, unknown-attribute-rate ≤ 3 %, evidence ≥ 98 %, disclosure-rendering 100 %, prefix-support
  100 %. All 55 suites green.
- **Deferred (unchanged meaning):** full runtime live-matching rebuild and live stock/price
  dereferencing. G1/G2 make that a change of *implementation*, not of *meaning* — the kernel and
  the versioned certificate are already in place. Preview only; live untouched. No PR.
