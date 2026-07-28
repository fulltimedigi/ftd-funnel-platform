/**
 * tests/oracle.invariants.test.mjs — STEP 4-a (real repo, red-first). The Kernel Authoring Oracle's
 * SEVEN INVARIANTS + lineage + canaries + cache, proven against the REAL kernel (constraintKernel).
 *
 *   1. PARTITION            — exact ⊎ compromise ⊎ rejected = pool (covered in oracle.partition too)
 *   2. PROJECTION PURITY    — the brain-facing projection leaks no ids/vectors/evidence/scores/ranking
 *   3. REPLAY EQUALITY      — same legal inputs ⇒ same evaluation_hash (reconstructible; no random ref)
 *   4. RUNTIME MEMBERSHIP DIFFERENTIAL — certified pool vs runtime pool; a planted poison is caught
 *   5. MONOTONICITY (REFINE ONLY) — a REFINE transition can only SHRINK the eligible pool; BRANCH need not
 *   6. OVERLAY ISOLATION    — an overlay (merchant bound) on one evaluation never leaks into another
 *   7. SINGLE EVALUATION ORIGIN — measured by evaluation_hash (a second, independent code path collides)
 *
 * Plus: kernel-minted OPAQUE pools with LINEAGE receipts (MAC — tamper is caught), qualified_option_ref
 * (a fabricated transition ref is rejected), a cache whose internal key includes kernel_version, and an
 * OracleTranscript as proof material. Per operator pre-commitment (item 6): an invariant that fails
 * against the REAL kernel is shown as-is — NEVER weakened to pass.
 *
 * OWNERSHIP: everything under engine/kernel/authoringOracle/ (kernel-owned). The brain imports NONE of it.
 */
import assert from "node:assert/strict";
import { OracleSession } from "../engine/kernel/authoringOracle/session.js";
import { runtimeMembershipDifferential } from "../engine/kernel/authoringOracle/differential.js";
import { oracleHash } from "../engine/kernel/authoringOracle/hash.js";
import { NEVER_RELAX, RELAXABLE } from "../engine/kernel/constraintKernel.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const constraints = [
  { id: "type", type: "nominal", mode: NEVER_RELAX, priority: 1 },
  { id: "budget", type: "ordinal", mode: RELAXABLE, priority: 2, order: ["0", "1", "2", "3"] },
];
const U = (id, type, tier) => ({ id, values: { type: { value: type, grounded: true }, budget: { value: tier, grounded: true } } });
const units = [U("A", "oil", 0), U("B", "oil", 1), U("C", "spray", 0), U("D", "oil", 3), U("E", "spray", 2)];
const context = { structural_catalog_version: "cat_1", policy_version: "pol_1", kernel_version: "k_1" };
const session = () => new OracleSession({ constraints, units, context });

check("2. PROJECTION PURITY — brain projection carries counts+state_outcome+opaque refs, and NO roster", () => {
  const S = session();
  const proj = S.evaluate({ type: "oil", budget: 0 }).projection;
  const s = JSON.stringify(proj);
  for (const f of ["\"A\"", "\"B\"", "exact_ids", "violation_vectors", "evidence_receipts", "scores", "ranking", "pool_digest"]) {
    assert.ok(!s.includes(f), `projection must not leak ${f}`);
  }
  assert.equal(proj.state_outcome, "EXACT_AVAILABLE");
  assert.equal(proj.counts.exact + proj.counts.compromise + proj.counts.rejected, units.length, "counts cover the whole pool");
  assert.ok(proj.exact_pool_ref.startsWith("pool_"), "opaque exact ref");
});

check("3. REPLAY EQUALITY — two sessions, same legal inputs ⇒ identical evaluation_hash", () => {
  const a = session().evaluate({ type: "oil", budget: 0 }).evaluation_hash;
  const b = session().evaluate({ type: "oil", budget: 0 }).evaluation_hash;
  assert.equal(a, b);
  assert.ok(/^[0-9a-f]{16,}$/.test(a));
});

check("4. RUNTIME MEMBERSHIP DIFFERENTIAL — equal pools ⇒ empty; a planted poison SKU is caught (canary)", () => {
  const S = session();
  const node = S.evaluate({ type: "oil", budget: 0 });
  const certified = S.membersOf(node.pools.eligible_ref).sort(); // server-only resolve of the certified pool
  const dEqual = runtimeMembershipDifferential(certified, [...certified]);
  assert.ok(dEqual.equal && dEqual.onlyInCertified.length === 0 && dEqual.onlyInRuntime.length === 0, "identical membership ⇒ no differential");
  // POISON: the runtime serves a SKU the certified pool never admitted (C is a rejected spray)
  const dPoison = runtimeMembershipDifferential(certified, [...certified, "C"]);
  assert.ok(!dPoison.equal && dPoison.onlyInRuntime.includes("C"), "the differential canary bites on an unadmitted SKU");
});

check("5. MONOTONICITY (REFINE only) — ALL three inclusions + no compromise→exact; a BRANCH is exempt", () => {
  const S = session();
  const root = S.evaluate({});                                   // nothing asked ⇒ all eligible, all exact
  const r1 = S.refine(root, { type: "oil" });                   // drop the sprays
  const r2 = S.refine(r1, { type: "oil", budget: 0 });          // drop the over-cap oud
  const M = (n) => ({ elig: new Set(S.membersOf(n.pools.eligible_ref)), exact: new Set(S.membersOf(n.pools.exact_ref)), rej: new Set(S.membersOf(n.pools.rejected_ref)) });
  const sub = (a, b) => [...a].every((x) => b.has(x));
  for (const [c, p] of [[r1, root], [r2, r1]]) {
    const cc = M(c), pp = M(p);
    assert.ok(sub(cc.exact, pp.exact), "exact(child) ⊆ exact(parent) — no compromise→exact promotion");
    assert.ok(sub(cc.elig, pp.elig), "eligible(child) ⊆ eligible(parent)");
    assert.ok(sub(pp.rej, cc.rej), "rejected(parent) ⊆ rejected(child)");
  }
  assert.ok(M(r2).elig.size < M(root).elig.size, "refinement actually narrowed");
  const b1 = S.branch(root, { type: "spray" });
  assert.ok(![...M(b1).elig].every((x) => M(r1).elig.has(x)), "a BRANCH may leave the REFINE subtree (not monotone) — as designed");
  assert.equal(r1.transition.kind, "REFINE");
  assert.equal(b1.transition.kind, "BRANCH");
});

check("5b. MONOTONICITY is ENFORCED — a REFINE that would GROW the eligible pool is rejected, not silently accepted", () => {
  const S = session();
  const narrow = S.evaluate({ type: "oil", budget: 0 });        // eligible {A,B}
  // 'refine' from a narrow state to a broader one (drop the budget promise) GROWS eligibility → illegal REFINE
  assert.throws(() => S.refine(narrow, { type: "oil" }), /monotonic|REFINE/i, "a non-shrinking REFINE is a hard failure (use BRANCH)");
});

check("6. OVERLAY ISOLATION — a merchant bound on one evaluation does not leak into another", () => {
  const S = session();
  const withOverlay = S.evaluate({ type: "oil", budget: 0 }, { opts: { bounds: { maxPriceOvershoot: 0 } } });
  const without = S.evaluate({ type: "oil", budget: 0 });
  // different opts ⇒ different cache identity, and the plain evaluation is unaffected by the overlay run
  assert.notEqual(withOverlay.cache_key, without.cache_key, "overlay changes the internal cache key (no collision)");
  assert.equal(without.projection.state_outcome, "EXACT_AVAILABLE", "the non-overlay evaluation stands on its own");
});

check("7. SINGLE EVALUATION ORIGIN — an independent code path re-derives the SAME hash from primary inputs", () => {
  const node = session().evaluate({ type: "oil", budget: 0 });
  const independent = oracleHash({ units, constraints, answers: { type: "oil", budget: 0 }, context }); // second origin
  assert.equal(node.evaluation_hash, independent, "the hash is a function of the primary inputs alone");
});

check("LINEAGE — an EDGE receipt authorizes parent→child; membership tamper AND forged parent are caught", () => {
  const S = session();
  const root = S.evaluate({});
  const r1 = S.refine(root, { type: "oil" });
  const rec = r1.transition.lineage_receipt;
  assert.ok(rec && rec.ref && rec.mac, "a MAC'd edge receipt exists");
  assert.equal(rec.parent_pool_ref, root.pools.eligible_ref, "the edge names the TRUE parent pool (authorization, not just membership)");
  assert.equal(r1.transition.parent_hash, root.evaluation_hash);
  assert.ok(S.verifyLineage(r1), "an untampered edge verifies");
  assert.ok(!S.verifyLineage(r1, { tamperMembers: ["A", "B", "C", "D", "E"] }), "tampering the pool membership breaks the POOL mac (canary)");
  assert.ok(!S.verifyLineage(r1, { tamperParent: true }), "forging the edge's parent breaks the EDGE mac (unauthorized path canary)");
});

check("AUTHORIZATION (#3 fix) — the SAME child state from two different parents yields TWO distinct edges", () => {
  const S = session();
  const root = S.evaluate({});
  const other = S.evaluate({ budget: 0 });                       // a different parent state
  const e1 = S.branch(root, { type: "spray" }).transition.lineage_receipt;
  const e2 = S.branch(other, { type: "spray" }).transition.lineage_receipt;
  assert.equal(e1.child_pool_ref, e2.child_pool_ref, "both reach the identical child pool (pools are shared by membership)");
  assert.notEqual(e1.ref, e2.ref, "but each EDGE is distinct — keyed by (parent, transition), not by the child's hash");
  assert.notEqual(e1.parent_pool_ref, e2.parent_pool_ref, "each edge records the parent actually traversed (no first-write-wins)");
});

check("qualified_option_ref — a transition is named by a kernel-minted ref; a fabricated ref is rejected", () => {
  const S = session();
  const root = S.evaluate({});
  const r1 = S.refine(root, { type: "oil" });
  assert.ok(r1.transition.qualified_option_ref, "the kernel mints the option ref (the brain never fabricates one)");
  assert.ok(S.verifyTransition(r1.transition.qualified_option_ref, r1), "the genuine option ref verifies");
  assert.ok(!S.verifyTransition("qopt_forged_by_brain", r1), "a brain-fabricated transition ref does NOT verify (canary)");
});

check("CACHE — a repeat evaluation is a hit; changing kernel_version busts the key (kernel_version is IN the key)", () => {
  const S = session();
  S.evaluate({ type: "oil", budget: 0 });
  const before = S.callCount;
  S.evaluate({ type: "oil", budget: 0 });                       // identical ⇒ cache hit, no new kernel call
  assert.equal(S.callCount, before, "no new kernel evaluation on a cache hit");
  assert.ok(S.cacheHitCount >= 1, "the hit is counted");
  // a session under a different kernel_version must NOT reuse this session's cached pools
  const S2 = new OracleSession({ constraints, units, context: { ...context, kernel_version: "k_2" } });
  const h1 = S.evaluate({ type: "oil", budget: 0 }).evaluation_hash;
  const h2 = S2.evaluate({ type: "oil", budget: 0 }).evaluation_hash;
  assert.notEqual(h1, h2, "kernel_version is part of the evaluation identity — different builds never share a cache line");
});

check("OracleTranscript — an ordered proof record of every evaluation/transition accumulates", () => {
  const S = session();
  const root = S.evaluate({});
  S.refine(root, { type: "oil" });
  const t = S.transcript();
  assert.ok(Array.isArray(t) && t.length >= 2, "the transcript records each step");
  assert.ok(t.every((e) => e.evaluation_hash && e.transition_kind), "each entry is proof material (hash + transition_kind)");
  assert.equal(t[0].transition_kind, "ROOT");
});

if (process.exitCode === 1) console.error("\nFAIL — an oracle invariant broke against the real kernel.\n");
else console.log(`\nPASS — all ${passed} oracle-invariant assertions passed (real kernel).\n`);
