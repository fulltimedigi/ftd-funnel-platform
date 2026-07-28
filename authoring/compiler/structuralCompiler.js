/**
 * authoring/compiler/structuralCompiler.js — the STRUCTURAL COMPILER (round-10, ADR-0058 §compiler).
 * ===========================================================================================
 * Turns a REAL oracle-authored tree into a `CertificationInput` that encodes the tree AS A TREE — never as
 * flat paths. It is a pure SHAPE transform:
 *   • ZERO matching logic. It never calls the constraint kernel, its unit-classifier, or its selector. It does
 *     not choose a product, order alternatives, phrase a disclosure, resolve a variant, or apply any default.
 *   • It NEVER interprets a ref. Pool refs and the node id ride through opaquely (the kernel owns their
 *     meaning; the Certifier, phase 2, re-derives).
 *   • LEAK BOUNDARY: it carries the tree STRUCTURE only — node_kind, children, accumulated answers, per-leaf
 *     kernel receipts (counts + opaque pool refs + state_outcome). It carries NO "why": no display reason, no
 *     axis grade, no mirror share, no rejection log, no ranking / v10 trace. The compiler needs WHAT the tree
 *     is, not WHY its axes were chosen. Decisive test: change the display-mode REASON with the structure
 *     fixed ⇒ byte-identical output. So the compiler reads NONE of tree.guardRejections / tree.mirrorSignals /
 *     tree.displayModeNodes (those stay in the brain transcript, for build-time inspection only).
 *   • `d*` is computed HERE from the tree depth (ق20), not taken from the brain.
 *
 * node_kind is derived PURELY from structure (no reason needed):
 *   • question — the node branches (it has children).
 *   • terminal — a leaf whose resolved pool (exact ∪ compromise) is ≤ leaf_primary_cap (a single decided pick).
 *   • display — a leaf with more than that (a grid / selector of alternatives; ق20 oversized-leaf).
 */

/** keys that would leak the "why" — the compiler must never emit them; the consumer rejects them if present. */
export const FORBIDDEN_KEYS = ["reason", "grade", "mirror_singleton_share", "penalized", "guardRejections", "displayModeNodes", "mirrorSignals", "rank", "ranked", "v10", "evidence", "rejection", "rejected"];

const CINPUT_VERSION = "cinput-1";

/**
 * @param {AuthoringOracle} oracle  the oracle that built the tree (used ONLY for answersOf — the "what").
 * @param {object} tree             the buildFullTree result.
 * @param {{catalogVersion,policyVersion,kernelVersion,leafPrimaryCap,leafTotalCap}} opts
 * @returns {CertificationInput}
 */
export function compileTree(oracle, tree, opts = {}) {
  if (!tree || !tree.root || !Array.isArray(tree.nodes)) throw new Error("compileTree: a built tree is required");
  const leafPrimaryCap = opts.leafPrimaryCap ?? 1;
  // children index by parent hash — a STRUCTURAL fact of the tree (no reason involved).
  const kids = new Map();
  for (const n of tree.nodes) { const ph = n.transition && n.transition.parent_hash; if (ph) (kids.get(ph) || kids.set(ph, []).get(ph)).push(n); }
  const isQuestion = new Set(tree.internalChoices.map((c) => c.node.evaluation_hash));
  const axisAt = new Map(tree.internalChoices.map((c) => [c.node.evaluation_hash, c.axisId]));

  const nodeInput = (node, parentAnswers) => {
    const answers = oracle.answersOf(node); // accumulated answers — the structural "what"
    const proj = node.projection; // {state_outcome, counts, *_pool_ref} — counts + OPAQUE refs, no roster
    const base = { node_id: node.evaluation_hash, answers: canonicalAnswers(answers) };
    if (isQuestion.has(node.evaluation_hash)) {
      const axis = axisAt.get(node.evaluation_hash);
      const children = (kids.get(node.evaluation_hash) || []).map((child) => {
        // the edge label = the ONE answer this child adds (a structural fact — the answer that leads here).
        const ca = oracle.answersOf(child);
        const optionAxis = Object.keys(ca).find((k) => !(k in answers)) || axis;
        return { option: { axis: optionAxis, value: ca[optionAxis] }, child: nodeInput(child, answers) };
      });
      // sort children by (axis,value) for canonical, order-independent bytes.
      children.sort((a, b) => cmp(a.option.axis + "=" + a.option.value, b.option.axis + "=" + b.option.value));
      return { ...base, node_kind: "question", axis, children };
    }
    // leaf — terminal vs display, purely by resolved-pool size vs leaf_primary_cap.
    const resolved = proj.counts.exact + proj.counts.compromise;
    if (resolved <= 0) throw new Error(`compileTree: input-completeness violated — leaf ${node.evaluation_hash} has an empty resolved pool (a dead-end the tree must never publish)`);
    if (!proj.state_outcome) throw new Error(`compileTree: input-completeness violated — leaf ${node.evaluation_hash} lacks a kernel state_outcome`);
    const receipt = {
      evaluation_hash: node.evaluation_hash,
      state_outcome: proj.state_outcome,
      counts: { exact: proj.counts.exact, compromise: proj.counts.compromise },
      exact_pool_ref: proj.exact_pool_ref, compromise_pool_ref: proj.compromise_pool_ref,
    };
    return { ...base, node_kind: resolved <= leafPrimaryCap ? "terminal" : "display", receipt };
  };

  const root = nodeInput(tree.root, {});
  return {
    version: CINPUT_VERSION,
    context: { catalog_version: opts.catalogVersion ?? null, policy_version: opts.policyVersion ?? null, kernel_version: opts.kernelVersion ?? null },
    d_star: tree.depth, // ق20: 0 → grid · 1 → selector · ≥2 → quiz (computed from depth by the compiler)
    expected_reachable_paths: tree.leaves.length,
    root,
  };
}

/** canonical, order-independent bytes (sorted keys) — re-run ⇒ identical bytes. */
export function canonicalBytes(obj) {
  return JSON.stringify(sortKeys(obj));
}

/**
 * THE THIN CONSUMER (phase 1) — verifies SHAPE + terminal COMPLETENESS, so the compiler is wired from birth.
 * (Full consumption + real mint rate is the Certifier, phase 2.) Returns { ok, findings, reachable_paths }.
 */
export function verifyShapeAndCompleteness(cinput) {
  const findings = [];
  if (!cinput || cinput.version !== CINPUT_VERSION) findings.push("bad or missing version");
  if (!cinput || typeof cinput.expected_reachable_paths !== "number" || cinput.expected_reachable_paths <= 0) findings.push("expected_reachable_paths must be > 0");
  // forbidden-key scan (leak boundary) over the whole document
  for (const k of collectKeys(cinput)) if (FORBIDDEN_KEYS.includes(k)) findings.push(`forbidden 'why' key present: ${k}`);
  let reachable = 0;
  (function visit(n, path) {
    if (!n || typeof n !== "object") { findings.push(`missing node at ${path}`); return; }
    if (!n.node_id) findings.push(`node missing node_id at ${path}`);
    if (!["question", "display", "terminal"].includes(n.node_kind)) { findings.push(`bad node_kind at ${path}: ${n.node_kind}`); return; }
    if (!("answers" in n)) findings.push(`node missing answers at ${path}`);
    if (n.node_kind === "question") {
      if (!Array.isArray(n.children) || n.children.length < 1) { findings.push(`question with no children at ${path} (a dropped path)`); return; }
      n.children.forEach((c, i) => { if (!c || !c.child) findings.push(`child ${i} missing at ${path}`); else visit(c.child, `${path}/${i}`); });
    } else {
      reachable++;
      if (!n.receipt || !n.receipt.state_outcome) findings.push(`leaf missing kernel receipt/state_outcome at ${path}`);
      else if (!(n.receipt.counts && (n.receipt.counts.exact + n.receipt.counts.compromise) > 0)) findings.push(`leaf has an empty resolved pool at ${path} (dead-end)`);
    }
  })(cinput && cinput.root, "root");
  if (cinput && reachable !== cinput.expected_reachable_paths) findings.push(`reachable paths ${reachable} ≠ expected_reachable_paths ${cinput.expected_reachable_paths}`);
  return { ok: findings.length === 0, findings, reachable_paths: reachable };
}

// ── helpers (pure) ──────────────────────────────────────────────────────────────────────────────────────
function canonicalAnswers(answers) { const out = {}; for (const k of Object.keys(answers || {}).sort()) out[k] = answers[k]; return out; }
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]); return o; } return v; }
function collectKeys(v, acc = new Set()) { if (Array.isArray(v)) v.forEach((x) => collectKeys(x, acc)); else if (v && typeof v === "object") for (const k of Object.keys(v)) { acc.add(k); collectKeys(v[k], acc); } return acc; }

export default { compileTree, canonicalBytes, verifyShapeAndCompleteness, FORBIDDEN_KEYS };
