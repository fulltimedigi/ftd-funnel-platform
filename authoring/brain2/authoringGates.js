/**
 * authoring/brain2/authoringGates.js — PHASE-A axis/value gates as RELATIONS (consultation round-8).
 * ===========================================================================================
 * Mirror is a SEMANTIC judgment the counts-only brain cannot make; it is decided HERE, in phase A, where the
 * axis VALUES, their evidence BASIS, and their SUPPORT (grounded families) are visible. Every gate is a
 * RELATION or an evidence-basis — never a free ratio (the permanent rule):
 *   • basis == "name_token" ∧ support == 1  ⇒ the "value" is a product NAME, not an axis value ⇒ DROP the
 *     value. If every value drops, the axis drops.
 *   • |distinct values| == |grounded products|  ⇒ the axis is a one-to-one NAMING of products ⇒ REJECT axis.
 *   • value ≈ its product's title  ⇒ merchant REVIEW queue (ق19), never an automatic rejection.
 * Pure, deterministic, dependency-free. Runs BEFORE the oracle (it decides which axes/values become resolved
 * contracts). The counts-only tree rule (brain2) never sees values, so it cannot and must not do this.
 */

/** value ≈ title: the value string is a substring of the product title (a weak, review-only signal). */
function resemblesTitle(value, title) {
  const v = String(value).toLowerCase().trim();
  const t = String(title || "").toLowerCase();
  return v.length > 2 && t.length > 0 && t.includes(v);
}

/**
 * @param {{axis_key:string, values:Array<{value:*, families:string[], basis?:string, title?:string}>}} axis
 *   families = the grounded (Exact-supported) families carrying this value; support = its size.
 * @returns {{axis_key, kept:Array, rejectedValues:Array<{value,reason}>, reviewValues:Array<{value,reason}>,
 *            axisRejected: null | {reason}}}
 */
export function gateAxisCandidate({ axis_key, values = [] } = {}) {
  const kept = [], rejectedValues = [], reviewValues = [];
  for (const v of values) {
    const support = new Set(v.families || []).size;
    if (v.basis === "name_token" && support === 1) {
      rejectedValues.push({ value: v.value, reason: "name_token ∧ support==1 — a product NAME, not an axis value" });
      continue;
    }
    if (resemblesTitle(v.value, v.title)) reviewValues.push({ value: v.value, reason: "value resembles its product title — ق19 merchant review (not auto-rejected)" });
    kept.push(v);
  }
  let axisRejected = null;
  if (!kept.length) {
    axisRejected = { reason: "all values dropped as product names (name_token ∧ support==1)" };
  } else {
    const distinct = new Set(kept.map((v) => String(v.value))).size;
    const groundedProducts = new Set(kept.flatMap((v) => v.families || [])).size;
    if (distinct === groundedProducts) axisRejected = { reason: `|distinct values|(${distinct}) == |grounded products|(${groundedProducts}) — the axis is a one-to-one naming of products` };
  }
  return { axis_key, kept, rejectedValues, reviewValues, axisRejected };
}

export default { gateAxisCandidate };
