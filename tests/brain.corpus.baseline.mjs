/**
 * tests/brain.corpus.baseline.mjs — Part-2 brain exit-suite, RED-FIRST baseline on the OLD brain.
 * Runs the frozen evaluation corpus (tests/fixtures/eval-corpus.json) through the current brain via
 * the independent scorer (tests/lib/evalScorer.mjs) and prints the four binding numbers. This is the
 * baseline the rebuild must beat (raise exact_fulfillment, cut silent_compromise) on the SAME corpus.
 * Standalone (NOT in npm test yet) — it measures the OLD brain; the wired green version lands after
 * the rebuild. No production code touched.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { productsFromShopifyJson } from "../authoring/ingest/shopify.js";
import { cleanCatalog } from "../authoring/author/axes.js";
import { authorFunnel } from "../authoring/author/index.js";
import { scoreCorpus, oldBrainAdapter } from "./lib/evalScorer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "eval-corpus.json"), "utf8")).intents;
const oudPath = process.argv[2] || "/tmp/oud_p1.json";
const products = cleanCatalog(productsFromShopifyJson(fs.readFileSync(oudPath, "utf8"), "https://oudfactory.com", "KWD"));

const config = authorFunnel({ products, origin: "https://oudfactory.com", brandUrl: "https://oudfactory.com" }).config;
const r = scoreCorpus({ corpus, products, recommend: oldBrainAdapter(config, products) });
const pct = (x) => (x * 100).toFixed(0) + "%";

console.log("================ Part-2 BRAIN CORPUS — OLD-BRAIN BASELINE ================");
console.log("corpus (fixed):", r.N, "buyer intents");
console.log("  exact_fulfillment_rate =", r.cats.exact_fulfillment + "/" + r.N, "=", pct(r.rates.exact_fulfillment_rate));
console.log("  silent_compromise_rate =", r.cats.silent_compromise + "/" + r.N, "=", pct(r.rates.silent_compromise_rate), " ← betrayal");
console.log("  hard_violation_rate    =", r.cats.hard_violation + "/" + r.N, "=", pct(r.rates.hard_violation_rate), " ← worst");
console.log("  honest_no_match_rate   =", r.cats.honest_no_match + "/" + r.N, "=", pct(r.rates.honest_no_match_rate));
console.log("  false_no_match (diag)  =", r.cats.false_no_match + "/" + r.N, "=", pct(r.rates.false_no_match_rate));
