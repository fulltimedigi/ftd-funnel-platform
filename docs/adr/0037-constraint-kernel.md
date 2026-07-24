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

## Closing corrections (after independent live verification on oudfactory)

Independent review confirmed the kernel killed the original bug (zero silent never-relax breaks,
zero budget jumps) but flagged five gaps between *the guarantee claimed* and *the guarantee
proven*. These are completeness fixes, not a redesign:

- **BLOCKER-1 — the verifier is now genuinely independent (C11).** `verifyFunnel` no longer re-runs
  the kernel's own chooser; it calls a separate **reference oracle** (`referenceEvaluator.js`) that
  shares ONLY the base predicates (`status`/`evaluateUnit`) and re-implements eligibility, the loss
  representation, the comparator, exact-dominance, and the tie-break from scratch. It brute-forces
  every eligible SKU to prove exact-dominance, lexicographic optimality, disclosure soundness +
  completeness, and variant validity. `tests/kernel.reference.test.mjs` proves it catches all seven
  corruptions (worse-SKU swap · compromise-over-exact · UNKNOWN-as-SAT · deleted disclosure ·
  never-relax bypass · coverage-picks-worse · bad-variant) **and** an injection test feeds a
  deliberately reversed chooser and asserts the oracle rejects it — so independence is *tested*.
- **BLOCKER-2 — real grounding per unit × claim.** `grounding.js` decides, for every product value,
  whether it is grounded and by what provenance (structured > merchant > ontology > validated
  extraction > uncorroborated); a bare token next to a negation/"free-of" qualifier is NOT proof.
  `compileUnits` no longer stamps `grounded:true` blindly — an ungrounded value stays UNKNOWN. On
  the oud-shaped catalog: format **12/12 grounded (ontology)**, budget **13/13 (structured)**, soft
  axes grounded by structured/merchant/extraction with the rest honestly UNKNOWN-at-runtime.
- **BLOCKER-3 — no renderable result without a proof.** Every surfaced alternate now carries its own
  kernel proof (and is DROPPED if it can't be proven for its archetype's path); the default rule is
  proven **unreachable by construction** (the combo rules cover the full answer space) and
  `verifyFunnel` asserts `proofCoverage === 1`. Measured proof coverage: **100 %** on every store.
- **POLICY-1 — UNKNOWN vs known violation (C6).** UNKNOWN is scored WITHIN its constraint's own
  priority, not as a global tail: a *known, bounded* violation is preferred over an UNKNOWN; an
  over-cap violation makes a unit ineligible (→ NoExactMatch) and never beats an UNKNOWN; UNKNOWN on
  a never-relax / require-proof claim excludes the candidate.
- **FIX-4 — canonical budget cut.** `tierOf` and the tier LABEL derive from the same cut with the
  same inclusivity; the top tier is now "X فأكثر" (inclusive) so a price exactly at the cut reads
  truthfully. `tests/budget-boundary.test.mjs` locks boundary-ε / boundary / boundary+ε.

Re-run on oudfactory (oud-shaped proxy; the real catalog isn't cached in-repo — the live preview
applies the identical kernel): **EXACT 10 / COMPROMISE 17 / UNVERIFIED 0 / NoExactMatch 0** across
27 paths; proof coverage **100 %**; max relaxation severity **1 tier**; top conflict axes budget
then a character facet; independent-oracle findings **0**. All 57 suites green; trust / anti-bland /
richness untouched. Preview only; no PR.

## Final closing (verified-snapshot scope)

A last pass bound the guarantee to a **named, verified snapshot** and locked the by-construction
links with regression tests (not a rebuild — client-side evaluation against the loaded config,
rendered from one record):

- **Rule-based promise binding.** An option's meaning is its **predicate**; its group is derived
  (`group = { SKU : SAT }`), never authored separately — on conflict the predicate/value/derived
  grouping win, the label may not widen or narrow. Strict labels come from the ontology/template
  (form, price band); the model only proposes copy. A publish-time per-option **witness** fails the
  funnel on a dead option or an inverted/widened label (`promiseBinding.js`), and authoring now
  **prunes** any option value no SKU carries — honesty > depth, the funnel shortens rather than ask
  a dead question. AI-designed soft axes are grounded via a *validated external mapping* tier
  (`designToAxes` confirms real url + in-domain), so the moat survives while a hard filter can still
  never be manufactured from an inferred value.
- **Presentation / handoff / version coherence locked by tests.** A result's name/price/image/url
  come from ONE real SKU record (non-composite); the CTA is the **proven** product/variant url with
  **no** parent/brand-home fallback (`handoff.js` → `HANDOFF_UNBOUND` when a variant isn't
  deep-linkable); and five stamps — `catalog_version`, `policy_version`, `answer_contract_version`,
  `config_hash`, `locale_bundle_version` — must all match what the client saw or the result is
  **STALE** (`version.js` / `verifyRuntime.js`).
- **Fail-closed safety guard** (`safety.js`, preventive): a safety/allergen/compatibility/legal axis
  is hard only from a single official source with no competing evidence; disagreement →
  CONTRADICTED, unofficial-only → UNKNOWN — never a silent SAT (`NEVER_RELAX` + require-proof).
- **Structural verifier independence:** `tests/verifier-architecture.test.mjs` fails CI if the
  reference oracle or the verifier ever imports the kernel's chooser; predicate truth tables +
  metamorphic properties pin the shared TCB.

### The bounded guarantee (as written)

> For a catalog + policy + answer-contract (including locale) **named in the certificate and
> verified exhaustively on every path**, every result is either **(a)** a recommendation with a
> certificate — its title, price, image, attributes, and exit link all from the **same real,
> eligible SKU**; every hard constraint SAT; every other answer either SAT or explicitly disclosed;
> exact match dominating; and no step (fallback / coverage / boost / render / handoff) corrupting the
> certificate — **or (b)** an explicit base state: **NO_MATCH / UNVERIFIED / STALE /
> HANDOFF_UNBOUND**. The guarantee is **relative to the named snapshot**; it does not warrant the
> merchant's live stock, live price, cart substitution, or physical reality after handoff. A
> safety-sensitive claim counts as verified **only** if its official evidence is uncontradicted.

Closing metrics (oud-shaped proxy): mutation matrix **9/9 + injection** caught (incl. CTA-mismatch
and stale-hash); architecture import-ban **green**; promise-binding witness **all options pass, 0
dead / 0 inverted** after pruning; version coherence **5/5 stamps present and enforced**. All **62**
suites green; trust / anti-bland / richness untouched. Preview only; no PR.
