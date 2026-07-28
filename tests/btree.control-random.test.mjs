/**
 * tests/btree.control-random.test.mjs — THE CONTROL EXPERIMENT (round-10, step 1). Proves the axis-RANKING
 * rule is QUALITY, not SAFETY, by PROVING the classification instead of asserting it: rebuild the tree with a
 * DETERMINISTIC-RANDOM axis choice (fixed seed) among the ACCEPTED axes only — i.e. the acceptance GATES stay
 * on (decisive-mirror/all-singleton routing, min_exact_option_ratio, reduction>0, options cap), only the
 * ranking (Σsᵢ²+u₀² + tie-break) is removed. If the safety invariants still hold under random selection, the
 * ranking carries no safety ⇒ it is legitimate to freeze it as a quality component.
 *   SAFETY (must hold under ANY accepted selection): no hard-constraint violation (REFINE monotonicity) · no
 *   empty branch · no unsupported / dead-end option · every SKU reachable (no dead-end) · no silent compromise
 *   (every compromise leaf flagged) · edge bijection · reach ledger clean.
 *   QUALITY (the real price of the rule): depth · #questions (internal nodes) · surface@cap.
 */
import assert from "node:assert/strict";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree, RULE_V9 } from "../authoring/brain2/tree.js";
import { diagnoseAxesV9 } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

// deterministic string hash (fnv-1a) — no Math.random; pure function of (node hash, seed).
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }

// CONTROL rule: apply the SAME acceptance gates as v9 (diagnoseAxesV9 survivors), then pick a survivor by a
// deterministic pseudo-random function of (node hash, seed) — NO ranking, NO tie-break.
function randomRule(seed) {
  return {
    id: `control-random@seed${seed}`,
    pick(node, perAxisRefs, oracle, cfg = {}) {
      const S = node.projection.counts.exact;
      const stats = {};
      for (const [ax, refs] of Object.entries(perAxisRefs)) stats[ax] = { sizes: refs.map(({ option_ref }) => oracle.probeByRef(node, option_ref).projection.counts.exact), confirms: refs.map(() => true), evidence: oracle.groundedCount(ax) };
      const accepted = diagnoseAxesV9(stats, { S, minExactRatio: cfg.minExactRatio, maxOptions: cfg.maxOptions }).ranked.map((r) => r.ax).sort();
      if (!accepted.length) return null;
      return accepted[fnv(node.evaluation_hash + ":" + seed) % accepted.length];
    },
  };
}

// ── catalogs: oud + the three synthetic distributions ───────────────────────────────────────────────────
const G = (v) => (v == null ? { value: null, grounded: false } : { value: v, grounded: true });
const CONTRACTS = [
  { axis_id: "type", type: "nominal", mode: "NEVER_RELAX", priority: 1 },
  { axis_id: "budget", type: "ordinal", mode: "RELAXABLE", priority: 2, order: ["low", "mid", "high"], resolved: { thresholds: [1, 2] } },
  { axis_id: "origin", type: "nominal", mode: "RELAXABLE", priority: 3 },
];
function synCat(tuples) {
  const units = tuples.map(([t, b, o], i) => ({ id: `${t}-${b}-${o}-${i}`, values: { type: G(t), budget: G(b), origin: G(o) } }));
  const skusByFamily = {}; for (const u of units) skusByFamily[u.id] = [u.id];
  return { units, resolvedContracts: CONTRACTS, context: { structural_catalog_version: "syn", policy_version: "syn", kernel_version: "k_1" }, skusByFamily, skuCount: units.length };
}
const oud = await oudOneLevelInputs();
const CATS = [
  ["oud", { ...oud, limits: { ...oud.treeLimits, leaf_primary_cap: oud.leafCaps.primary }, cap: oud.leafCaps.total }],
  ["A one-dominant", { ...synCat([...Array(16)].map((_, i) => [`t${i % 8}`, "mid", "o1"])), limits: { ...oud.treeLimits, leaf_primary_cap: oud.leafCaps.primary }, cap: oud.leafCaps.total }],
  ["B equal-axes", { ...synCat([].concat(...["t1", "t2"].map((t) => [].concat(...["low", "mid", "high"].map((b) => ["o1", "o2"].map((o) => [t, b, o])))))), limits: { ...oud.treeLimits, leaf_primary_cap: oud.leafCaps.primary }, cap: oud.leafCaps.total }],
  ["C single-value", { ...synCat([].concat(...["t1", "t2", "t3"].map((t) => ["o1", "o2"].map((o) => [t, "mid", o])))), limits: { ...oud.treeLimits, leaf_primary_cap: oud.leafCaps.primary }, cap: oud.leafCaps.total }],
];

function analyze(cat, rule) {
  const o = new AuthoringOracle({ units: cat.units, resolvedContracts: cat.resolvedContracts, context: cat.context });
  const tree = buildFullTree(o, { limits: cat.limits, rule });
  const byHash = new Map(tree.nodes.map((n) => [n.evaluation_hash, n]));
  const Sset = (r) => new Set(o.membersOf(r));
  const sub = (a, b) => [...a].every((x) => b.has(x));
  const skusOf = (fams) => fams.flatMap((f) => cat.skusByFamily[f] || []);
  // SAFETY
  const reach = o.verifyReachability(tree.nodes);
  const bij = o.verifyTree(tree.nodes);
  let hardViol = 0, emptyBranch = 0, unsupported = 0, silentCompromise = 0;
  const kids = new Map(); for (const n of tree.nodes) if (n.transition.parent_hash) (kids.get(n.transition.parent_hash) || kids.set(n.transition.parent_hash, []).get(n.transition.parent_hash)).push(n);
  for (const n of tree.nodes) {
    if (n.transition.kind === "REFINE") { const p = byHash.get(n.transition.parent_hash); if (!(sub(Sset(n.pools.exact_ref), Sset(p.pools.exact_ref)) && sub(Sset(n.pools.eligible_ref), Sset(p.pools.eligible_ref)) && sub(Sset(p.pools.rejected_ref), Sset(n.pools.rejected_ref)))) hardViol++; }
  }
  for (const [, cs] of kids) for (const c of cs) if (o.membersOf(c.pools.eligible_ref).length === 0) emptyBranch++;
  for (const leaf of tree.leaves) { const elig = o.membersOf(leaf.pools.eligible_ref).length; if (elig === 0) unsupported++; const cOnly = (tree.meta.get(leaf.evaluation_hash) || {}).compromiseOnly; const hasExact = o.membersOf(leaf.pools.exact_ref).length > 0; if (!cOnly && !hasExact) silentCompromise++; }
  const cand = new Set(); for (const leaf of tree.leaves) for (const s of skusOf(o.membersOf(leaf.pools.eligible_ref))) cand.add(s);
  // QUALITY
  const atCap = new Set();
  for (const leaf of tree.leaves) { const shown = [...o.membersOf(leaf.pools.exact_ref).slice().sort(), ...o.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, cat.cap); for (const s of skusOf(shown)) atCap.add(s); }
  return { reachOk: reach.ok, exactDrops: reach.exact_drops, unrecorded: reach.unrecorded_eligible_drops, bijOk: bij.ok, hardViol, emptyBranch, unsupported, silentCompromise, inPool: cand.size, skuCount: cat.skuCount, depth: tree.depth, questions: tree.internalChoices.length, surface: atCap.size };
}

const SEEDS = [1, 7, 42];
for (const [name, cat] of CATS) {
  check(`CONTROL (${name}): SAFETY holds under a random accepted-axis choice (${SEEDS.length} seeds) — ranking carries no safety`, () => {
    const v9 = analyze(cat, RULE_V9);
    for (const seed of SEEDS) {
      const r = analyze(cat, randomRule(seed));
      // SAFETY invariants — must hold regardless of WHICH accepted axis is chosen
      assert.equal(r.hardViol, 0, `hard_violation must be 0 (seed ${seed})`);
      assert.equal(r.silentCompromise, 0, `silent_compromise must be 0 (seed ${seed})`);
      assert.equal(r.emptyBranch, 0, `no empty branch (seed ${seed})`);
      assert.equal(r.unsupported, 0, `no unsupported / dead-end option (seed ${seed})`);
      assert.equal(r.inPool, r.skuCount, `every SKU reachable — no dead-end (seed ${seed}: ${r.inPool}/${r.skuCount})`);
      assert.ok(r.reachOk && r.exactDrops === 0 && r.unrecorded === 0, `reach ledger clean (seed ${seed})`);
      assert.ok(r.bijOk, `edge bijection (seed ${seed})`);
      console.log(`    · ${name} seed ${seed}: SAFE ✓ | quality → depth=${r.depth} questions=${r.questions} surface@cap=${r.surface}/${r.skuCount}`);
    }
    // the QUALITY price of the ranking rule (v9 vs random) — measured, not judged
    console.log(`    · ${name} v9 (ranked): depth=${v9.depth} questions=${v9.questions} surface@cap=${v9.surface}/${v9.skuCount}  ← the ranking's quality gain over random above`);
  });
}

if (process.exitCode === 1) console.error("\nRESULT: a SAFETY invariant broke under random selection ⇒ the ranking rule CARRIES SAFETY ⇒ DO NOT FREEZE. See the ✗ above.\n");
else console.log(`\nRESULT: all ${passed} control checks passed — every safety invariant holds under random accepted-axis selection across oud + 3 catalogs × ${SEEDS.length} seeds.\nCLASSIFICATION PROVEN: the axis-ranking rule is QUALITY, not SAFETY ⇒ freezing it (as a quality component, gates excluded) is legitimate.\n`);
