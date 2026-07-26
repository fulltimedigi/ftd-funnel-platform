/**
 * tests/lib/goldPin.mjs — FROZEN-SET pins (literal, inside the checker; never read from the file being
 * checked). Guarding against EMPTY sets is not enough — a SHRUNKEN set is worse: a truncated gold (ceiling
 * 1 instead of 11) makes `exact===ceiling`, `hard=0`, `silent=0` all read TRUE on a corpus that no longer
 * exists. So we pin the exact frozen shape + a content hash; any drift is an immediate RED build, never a
 * warning. A deliberate re-sign of the gold must re-pin these here (that's the point).
 */
import crypto from "node:crypto";

export const PINS = {
  intents: 27,
  exact: 11,
  gold_version: "gold-1.0.0",
  sha256: "9fc9334066c5e84ccb086165b5bb3d8673f8d4e1aa1cd8246268d097bd9797c8",
  // oudfactory real-ingest frozen counts (the recorded products.json fixture)
  oud_families: 50,
  oud_skus: 80,
  oud_active_skus: 85,
};

/** Throws if the gold's frozen shape/content has drifted from the pinned values. */
export function assertGoldPinned(gold, goldText) {
  const errs = [];
  const n = (gold.intents || []).length;
  if (n !== PINS.intents) errs.push(`intents ${n} !== ${PINS.intents}`);
  const exact = (gold.intents || []).filter((it) => (Array.isArray(it.expected) ? it.expected : [it.expected]).includes("EXACT")).length;
  if (exact !== PINS.exact) errs.push(`EXACT count ${exact} !== ${PINS.exact}`);
  if (gold.gold_version !== PINS.gold_version) errs.push(`gold_version ${gold.gold_version} !== ${PINS.gold_version}`);
  if (goldText != null) {
    const sha = crypto.createHash("sha256").update(goldText).digest("hex");
    if (sha !== PINS.sha256) errs.push(`sha256 drift ${sha.slice(0, 12)}… !== ${PINS.sha256.slice(0, 12)}…`);
  }
  if (errs.length) throw new Error("GOLD PIN VIOLATION (the frozen corpus changed — a shrunken/edited gold makes every 0 and every =ceiling vacuously true): " + errs.join(" · "));
}
