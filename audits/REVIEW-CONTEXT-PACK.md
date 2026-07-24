# Review Context Pack — paste this at the top of every external-AI review round

> You are reviewing one artifact for a real, in-progress system. You have NO access to the
> repo and NO memory of previous rounds — everything you need is in this pack + the artifact
> pasted below it. Do not re-litigate decisions in the "Decisions log". Stay within the stated
> stage/scope. Answer ONLY the lens you are assigned. Be adversarial and concrete: prefer a
> falsifiable counter-example ("shopper picks X → gets Y, a broken promise") over general advice.

## 1. Mission
A self-service SaaS: a merchant pastes their store URL; we ingest the real product catalog and
auto-author a short "decision funnel" (a few multiple-choice questions) that leads each visitor
to the single best-fitting **real** product from that store. It must work on ANY vertical.

## 2. Non-negotiables (rules of engagement — respect these in any suggestion)
- Recommendations are ALWAYS real catalog products/SKUs. Never fabricate a product, price,
  image, or attribute.
- Runtime (per visitor) is 100% deterministic — no LLM. All "intelligence" is design-time.
- The funnel never dead-ends — there is always a result (or an honest "no exact match" state).
- Every question we ask is a PROMISE: an explicit shopper choice must be honored, or the result
  must disclose that it couldn't be.
- ~100% surfaced catalog coverage (every sellable SKU is primary or a clearly-labeled alternate).

## 3. Architecture (current)
Two layers:
- **Authoring (design-time, once):** an LLM designs the decision axes + assigns each product a
  value per axis; a deterministic compiler materializes a decision table.
- **Runtime (per visitor):** deterministic table lookup.
The **Constraint Kernel** (`engine/kernel/constraintKernel.js`) is the SINGLE source of truth
for "matches": three-valued status (SAT/VIOLATED/UNKNOWN; a missing/ungrounded value is UNKNOWN,
never a silent match), typed predicates (nominal set-membership, taxonomy, ordinal, directional
price, variant/SKU), lexicographic partial-CSP selection (exclude NEVER_RELAX violations →
smallest loss → exact-dominance → relaxation bounds → first-class NO_MATCH), disclosure computed
by re-comparing the final unit to every answer, ONE `SelectionResult` constructor that demands a
verification certificate (no bypass). The decision table is a materialized cache of the kernel.
Gates (unchanged, always green): trust (no dead-ends/real products), anti-bland (not a mirror),
richness (depth + coverage). Prior-art framing: constraint-based recommendation (Felfernig),
constraint hierarchies (Borning), lexicographic/partial CSP, QuickXplain/minimal-correction-set.

## 4. Current status
- Original bug (soft scoring silently overriding explicit choices) is DEAD — verified on a live
  real store (oudfactory): 0 format leaks / 144 paths, no gross budget violation, alternates
  respect hard constraints, versions + per-rule proofs present, 55/55 tests green.
- ADR-0037 closing in progress: (B1) make the publish verifier INDEPENDENT of the matcher;
  (B2) real per-claim grounding (don't mark AI-inferred soft values as verified); (B3) no
  renderable result without a proof (close the default-rule door); (C6) known-bounded-violation
  beats UNKNOWN at same priority; (FIX-4) one canonical price-boundary value.
- Next phases (separate): funnel-depth tuning (compromise rate), then full code audit.

## 5. Decisions log (do NOT reopen without new evidence)
- Keep the two-layer design; keep the materialized table as a CACHE of the kernel (not separate
  logic). Migrate to pure runtime matching only when axis count / adaptivity / live stock demands.
- Format & budget are grounded hard constraints; taste axes are hard only where grounded.
- Live stock/price dereferencing is deferred; "current catalog" = latest in-system snapshot.
- Honesty > depth: a short honest funnel beats a padded one with lies.

## 6. Stage/scope anchor
We are closing the correctness contract of one subsystem, NOT shipping a full production
marketplace. Flag production-grade rigor (full evidence schemas, variant availability infra,
monitoring) as "later" — do not require it now unless it closes a correctness hole.

## 7. Your lens (fill one per reviewer)
- [ ] CORRECTNESS — find inputs that produce a wrong/broken-promise result.
- [ ] ARCHITECTURE — is the structure right for where this is going? trade-offs?
- [ ] ADVERSARIAL — try to break it: a catalog/answer that defeats a guarantee.
- [ ] PRIOR-ART — what established pattern/algorithm are we reinventing?
Answer ONLY your lens. Rank findings by severity. For each: the concrete failing case, why it
breaks a non-negotiable, and the smallest fix.

## 8. Artifact under review
<paste the exact code file / spec section / live JSON output here — prefer real code and real
output over prose descriptions>
