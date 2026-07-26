/**
 * tests/brain.corpus.baseline.mjs — Part-2 brain baseline (RED-FIRST) against the GOLD SET.
 * Runs the frozen gold intents (tests/fixtures/gold-set.json) through the OLD brain via the
 * gold-based 5-category scorer (tests/lib/evalScorer.mjs) and prints the binding numbers. The
 * rebuild must beat this on the SAME gold set: raise exact_fulfillment, drive silent_compromise
 * and hard_violation to 0, keep the identity exact+honest_no_match+disclosed=100%. Standalone
 * (not in npm test) — measures the OLD brain; the wired green version lands after the rebuild.
 * NOTE: baseline is PROVISIONAL until gold-set.json is human-reviewed (reviewed:false).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { productsFromShopifyJson } from "../authoring/ingest/shopify.js";
import { cleanCatalog } from "../authoring/author/axes.js";
import { authorFunnel } from "../authoring/author/index.js";
import { scoreAgainstGold, oldBrainAdapter } from "./lib/evalScorer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "gold-set.json"), "utf8"));
const products = cleanCatalog(productsFromShopifyJson(fs.readFileSync(process.argv[2] || "/tmp/oud_p1.json", "utf8"), "https://oudfactory.com", "KWD"));
const config = authorFunnel({ products, origin: "https://oudfactory.com", brandUrl: "https://oudfactory.com" }).config;

const s = scoreAgainstGold(gold, oldBrainAdapter(config, products));
const pct = (x) => (x * 100).toFixed(0) + "%";
console.log("================ Part-2 BRAIN — OLD-BRAIN BASELINE vs GOLD SET ================");
console.log("gold:", gold.gold_version, "| reviewed:", gold.reviewed, "by", gold.reviewed_by || "-", "| intents:", s.N, "(BINDING baseline)");
console.log("  exact_fulfillment_rate   =", s.cats.exact_fulfillment + "/" + s.N, "=", pct(s.rates.exact_fulfillment_rate));
console.log("  honest_no_match_rate     =", s.cats.honest_no_match + "/" + s.N, "=", pct(s.rates.honest_no_match_rate));
console.log("  disclosed_compromise_rate=", s.cats.disclosed_compromise + "/" + s.N, "=", pct(s.rates.disclosed_compromise_rate));
console.log("  silent_compromise_rate   =", s.cats.silent_compromise + "/" + s.N, "=", pct(s.rates.silent_compromise_rate), " ← must be 0 (ق9)");
console.log("  hard_violation_rate      =", s.cats.hard_violation + "/" + s.N, "=", pct(s.rates.hard_violation_rate), " ← must be 0 (ق8)");
console.log("  false_no_match (diag)    =", s.cats.false_no_match + "/" + s.N, "=", pct(s.rates.false_no_match_rate));
console.log("  unserved_intent_rate (6) =", s.unserved + "/" + s.N, "=", pct(s.rates.unserved_intent_rate), " ← axis-starvation overlay (report, not gate)");
console.log("     unserved intents:", s.unservedList.map(u => u.id + "[" + u.missing_axis + "]").join(", ") || "none");
const g = s.gates;
console.log("");
console.log("  === ACCEPTANCE GATES (computed on SERVED = " + g.served + " intents, not 27) ===");
console.log("  hard_violation = 0 (over 27):", g.hard_zero ? "✅" : "❌ " + s.cats.hard_violation);
console.log("  silent_compromise = 0 (over 27):", g.silent_zero ? "✅" : "❌ " + s.cats.silent_compromise);
console.log("  exact = ceiling (" + s.cats.exact_fulfillment + "/" + g.exact_ceiling + "):", g.exact_meets_ceiling ? "✅" : "❌");
console.log("  identity exact+honest+disclosed = served (" + (s.cats.exact_fulfillment + s.cats.honest_no_match + s.cats.disclosed_compromise) + "/" + g.served + "):", g.identity_served ? "✅" : "❌");
console.log("  unserved ≤ baseline(" + 9 + ") or G4-recorded:", g.unserved_within_baseline ? "✅" : "❌");
console.log("  PROOF item#1 — EXACT-expected intents that are UNSERVED:", g.exact_ceiling - (g.exact_ceiling), "computed →", (g.no_exact_in_unserved ? "0 ✅ (all 11 achievable matches lie inside served)" : "❌ some EXACT are unserved"));
console.log("  → GATES:", g.pass ? "PASS ✅" : "FAIL ❌ (expected for old brain — baseline)");
