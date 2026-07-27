/**
 * engine/kernel/authoringOracle/hash.js — the ONE canonical digest for the Kernel Authoring Oracle.
 * ===========================================================================================
 * `evaluation_hash` is RECONSTRUCTIBLE from the primary inputs alone (Single Evaluation Origin,
 * measured by hash not by ref): canonical constraint state + canonical candidate pool + answers +
 * context versions (structural_catalog_version · policy_version · kernel_version). There is NO
 * random ref and NO captured_at in the digest — two evaluations of the same legal inputs collide
 * (Replay equality), and a mere INPUT-ORDER shuffle cannot change it (mechanical determinism),
 * because every list is canonicalized (sorted) before hashing.
 *
 * Pure FNV-1a (64-bit, BigInt) → 16 lowercase hex. Dependency-free, Node- and browser-safe (no
 * node:crypto), matching constraintKernel's ethos so the browser can re-derive it on load.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit of a string → 16 lowercase hex chars. */
export function fnvHex(str) {
  let h = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i) & 0xff);
    // include the high bits of multi-byte code units so unicode can't silently collide
    const hi = str.charCodeAt(i) >> 8;
    if (hi) { h = (h * FNV_PRIME) & MASK64; h ^= BigInt(hi); }
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}

/** Canonical constraint state: only the matching-relevant fields, sorted by id (order-independent). */
function canonicalConstraints(constraints) {
  return (constraints || [])
    .map((c) => ({
      id: String(c.id),
      type: c.type || null,
      mode: c.mode || null,
      priority: c.priority || 0,
      order: Array.isArray(c.order) ? c.order.map(String) : null,
      requireProof: !!c.requireProof,
      strict: !!c.strict,
      descendants: c.descendants || null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Canonical grounded value of a unit on one constraint (mirrors kernel unitValue shape). */
function groundedOf(values, id) {
  const g = values && values.get ? values.get(id) : (values || {})[id];
  if (g == null) return { value: null, grounded: false };
  if (typeof g === "object" && !Array.isArray(g) && "value" in g) return { value: g.value, grounded: g.grounded !== false };
  return { value: g, grounded: true };
}

/** Canonical candidate-pool digest: each unit's id + its grounded value per constraint, sorted by id. */
function canonicalPool(units, constraints) {
  const ids = canonicalConstraints(constraints).map((c) => c.id);
  return (units || [])
    .map((u) => ({
      id: String(u.id),
      values: ids.map((cid) => {
        const gv = groundedOf(u.values, cid);
        return [cid, gv.grounded ? String(gv.value) : "∅"];
      }),
      variants: Array.isArray(u.variants)
        ? u.variants.map((v) => ({ id: v && v.id != null ? String(v.id) : null, purchasable: !(v && v.purchasable === false), attributes: (v && v.attributes) || {} }))
        : null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Canonical answers: entries sorted by constraint id. */
function canonicalAnswers(answers) {
  return Object.keys(answers || {})
    .sort()
    .map((k) => [k, answers[k]]);
}

/**
 * Canonical overlay: the merchant price-overshoot bound is the only per-evaluation matching overlay.
 * Absent / default (null) contributes NOTHING (→ null), so a plain evaluation's hash equals the pure
 * primary-input hash; a real overlay changes the evaluation identity (as it changes what matches).
 */
function canonicalOpts(opts) {
  const b = opts && opts.bounds;
  if (!b || b.maxPriceOvershoot == null) return null;
  return { maxPriceOvershoot: b.maxPriceOvershoot };
}

/** Canonical context: only the three versions, never data, never a mode, never a timestamp. */
function canonicalContext(context) {
  const c = context || {};
  return {
    structural_catalog_version: c.structural_catalog_version ?? c.structural_catalog_digest ?? null,
    policy_version: c.policy_version ?? null,
    kernel_version: c.kernel_version ?? null,
  };
}

/** THE reconstructible evaluation digest. Same legal inputs (any order) ⇒ same 16-hex string. */
export function oracleHash({ units, constraints, answers, context, opts }) {
  const payload = {
    v: 1,
    c: canonicalConstraints(constraints),
    p: canonicalPool(units, constraints),
    a: canonicalAnswers(answers),
    x: canonicalContext(context),
    o: canonicalOpts(opts),
  };
  return fnvHex(JSON.stringify(payload));
}

/**
 * An OPAQUE pool ref: a digest of (class · sorted member ids · evaluation_hash). It is stable and
 * reconstructible server-side but NOT reversible to the member ids by the brain — the brain sees a
 * handle, never a roster (id-sets are themselves a manipulation channel).
 */
export function poolRef(klass, ids, evaluation_hash) {
  const sorted = [...(ids || [])].map(String).sort();
  return "pool_" + fnvHex(klass + "|" + sorted.join(",") + "|" + evaluation_hash);
}

export default { fnvHex, oracleHash, poolRef };
