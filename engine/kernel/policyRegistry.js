/**
 * engine/kernel/policyRegistry.js — the ONE numbered, normative matching-policy registry
 * (ADR-0037/0039 P0; audit finding #6 "budget bound / verifier independence").
 * ===========================================================================================
 * The matcher (constraintKernel eligibility) and the INDEPENDENT reference evaluator each read the
 * relaxation bound FROM HERE, directly, and each derives + applies the comparison in its OWN code.
 * A bound is NEVER passed matcher → verifier (that would make the "independent" check inherit the
 * value it is meant to check). Every certificate carries `policy_hash`; the verifier compares it.
 *
 * TYPED NUMBERS — the original bug was passing a TierCount (how many tiers exist, e.g. 3) where a
 * TierDistance (how far a price may relax, = 1) was meant. They are tagged so a TierCount can never
 * be mistaken for a TierDistance again; `maxBudgetTierDistance()` returns a plain integer and throws
 * if the stored value is not a TierDistance.
 *
 * Pure, deterministic, dependency-free.
 */

export const TierDistance = (n) => Object.freeze({ kind: "TierDistance", value: n });
export const TierCount = (n) => Object.freeze({ kind: "TierCount", value: n });

const POLICY = Object.freeze({
  version: "policy-1",
  // A RELAXABLE ordinal (budget) may relax at most ONE tier — a DISTANCE, not a tier count.
  maxBudgetTierDistance: TierDistance(1),
  maxPriceOvershoot: null, // (future numeric-price relax bound; null = strict)
});

export function activePolicy() { return POLICY; }

/** The relaxation DISTANCE the matcher/verifier each read INDEPENDENTLY. Returns a plain integer. */
export function maxBudgetTierDistance() {
  const t = POLICY.maxBudgetTierDistance;
  if (!t || t.kind !== "TierDistance") throw new Error("policy misconfigured: maxBudgetTierDistance must be a TierDistance, not a " + (t && t.kind));
  return t.value;
}

export function policyVersion() { return POLICY.version; }

/** FNV-1a hash of the matching-relevant policy fields — the certificate stamp. */
export function policyHash() {
  const s = `${POLICY.version}|budgetDist:${POLICY.maxBudgetTierDistance.value}|priceOver:${POLICY.maxPriceOvershoot}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return "pol_" + POLICY.version + "_" + ("0000000" + h.toString(16)).slice(-8);
}

export default { activePolicy, maxBudgetTierDistance, policyVersion, policyHash, TierDistance, TierCount };
