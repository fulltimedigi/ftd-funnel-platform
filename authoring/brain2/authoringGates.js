/**
 * authoring/brain2/authoringGates.js — PHASE-A axis/value gates as RELATIONS (consultation round-8).
 * ===========================================================================================
 * Mirror is a SEMANTIC judgment the counts-only brain cannot make; it is decided HERE, in phase A, where the
 * axis VALUES, their evidence BASIS, and their SUPPORT (grounded families) are visible. Every gate is a
 * RELATION or an evidence-basis — never a free ratio (the permanent rule):
 *   • SEMANTIC-TYPE HOMOGENEITY (round-9, the guard that catches a product-line disguised as a value, e.g.
 *     "katana" among origins — 2 SKU/line, so it escapes every counting layer): all values must be ONE
 *     normalized semantic type; mixing types (origin vs product-line) ⇒ REJECT the axis, regardless of counts.
 *   • basis == "name_token" ∧ support == 1  ⇒ the "value" is a product NAME ⇒ DROP the value (all ⇒ axis drops).
 *   • EVIDENCE-BASIS (round-9, replaces |values|==|products|): REJECT only when every value is derived from
 *     PRODUCT IDENTITY (name_token) with no independent vocabulary. A catalog-INDEPENDENT vocabulary
 *     (structured field · variant option · taxonomy) is a real axis EVEN IF each value is unique to one
 *     product; count-equality is then a reported SIGNAL, not a rejection (the unique axis routes to a display
 *     mode in the brain, it is not rejected).
 *   • value ≈ its product's title  ⇒ merchant REVIEW queue (ق19), never an automatic rejection.
 * Pure, deterministic, dependency-free. Runs BEFORE the oracle (it decides which axes/values become resolved
 * contracts). The counts-only tree rule (brain2) never sees values, so it cannot and must not do this.
 */

/** bases that are a catalog-INDEPENDENT vocabulary (a real dimension), vs product-identity-derived tokens. */
const INDEPENDENT_VOCAB = new Set(["structured", "variant_option", "variant", "taxonomy", "ordinal", "price"]);
const IDENTITY_BASIS = new Set(["name_token", "title token", "title_token"]);

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
  const kept = [], rejectedValues = [], reviewValues = [], signals = [];
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
    // (1) SEMANTIC-TYPE HOMOGENEITY — the guard that catches a product-line disguised as a value (katana).
    const types = new Set(kept.map((v) => v.semantic_type).filter((t) => t != null));
    if (types.size > 1) {
      axisRejected = { reason: `semantic-type mix {${[...types].join(", ")}} — the values are not one dimension (a product-line disguised as a value); reject regardless of counts` };
    } else {
      // (2) EVIDENCE-BASIS gate — reject only when values are product-identity-derived with no independent
      //     vocabulary. A catalog-independent vocabulary is a real axis even if each value is unique.
      const allIdentity = kept.every((v) => IDENTITY_BASIS.has(v.basis) && !INDEPENDENT_VOCAB.has(v.basis));
      const anyIndependent = kept.some((v) => INDEPENDENT_VOCAB.has(v.basis));
      if (allIdentity && !anyIndependent) {
        axisRejected = { reason: "all values basis=product-identity (name_token) with no independent vocabulary — a naming, not an axis" };
      } else {
        // count-equality is a reported SIGNAL now (a legit unique-per-product axis routes to a display mode
        // in the brain — it is NOT rejected here).
        const distinct = new Set(kept.map((v) => String(v.value))).size;
        const groundedProducts = new Set(kept.flatMap((v) => v.families || [])).size;
        if (distinct === groundedProducts) signals.push({ signal: "count_equality", reason: `|distinct|(${distinct})==|grounded|(${groundedProducts}) — unique-per-product; legit on an independent vocabulary (route to display mode, not reject)` });
      }
    }
  }
  return { axis_key, kept, rejectedValues, reviewValues, axisRejected, signals };
}

export default { gateAxisCandidate };
