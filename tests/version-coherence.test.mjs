/**
 * tests/version-coherence.test.mjs — VERSION COHERENCE (ADR-0037 closing, item 2).
 * The certificate carries catalog_version + policy_version + answer_contract_version + config_hash
 * + locale_bundle_version. Every stamp must match what the client actually saw; any drift → STALE,
 * and two versions are never mixed.
 */
import assert from "node:assert/strict";
import { authorFunnel } from "../authoring/author/index.js";
import { verifyServedResult } from "../engine/kernel/verifyRuntime.js";
import { catalogVersion } from "../engine/kernel/version.js";
import { readFileSync } from "node:fs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const cat = JSON.parse(readFileSync(new URL("./fixtures/oud-shaped.synthetic.json", import.meta.url), "utf8"));
const gen = authorFunnel(cat, { brandName: "Oud" });
const cfg = gen.config;
const aRule = cfg.decisionTable.find((r) => r.when && Object.keys(r.when).length);
const resolved = { scoring: { ruleId: aRule.id }, primary: cfg.archetypes.find((a) => a.id === aRule.result) };

check("the config carries all five coherence stamps", () => {
  for (const k of ["catalog_version", "policy_version", "answer_contract_version", "config_hash", "locale_bundle_version"]) {
    assert.ok(cfg[k], `config.${k} present`);
  }
});

check("a same-version client → coherent (not stale)", () => {
  const client = { catalog_version: cfg.catalog_version, policy_version: cfg.policy_version, answer_contract_version: cfg.answer_contract_version, config_hash: cfg.config_hash, locale_bundle_version: cfg.locale_bundle_version };
  const r = verifyServedResult(cfg, resolved, client);
  assert.equal(r.stale, false);
  assert.equal(r.ok, true, r.reasons.join("; "));
});

check("a stale catalog_version → STALE, result refused", () => {
  const client = { catalog_version: "cat_OLD.9", policy_version: cfg.policy_version, answer_contract_version: cfg.answer_contract_version, config_hash: cfg.config_hash, locale_bundle_version: cfg.locale_bundle_version };
  const r = verifyServedResult(cfg, resolved, client);
  assert.equal(r.stale, true);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /STALE.*catalog_version/.test(x)));
});

check("a stale answer_contract (questions/options changed under the shopper) → STALE", () => {
  const client = { catalog_version: cfg.catalog_version, policy_version: cfg.policy_version, answer_contract_version: "ans_OLD", config_hash: cfg.config_hash, locale_bundle_version: cfg.locale_bundle_version };
  const r = verifyServedResult(cfg, resolved, client);
  assert.equal(r.stale, true);
  assert.ok(r.reasons.some((x) => /answer_contract_version/.test(x)));
});

check("a stale locale bundle (labels swapped) → STALE (a compromise can't hide behind a re-translation)", () => {
  const client = { catalog_version: cfg.catalog_version, policy_version: cfg.policy_version, answer_contract_version: cfg.answer_contract_version, config_hash: cfg.config_hash, locale_bundle_version: "loc_OLD" };
  const r = verifyServedResult(cfg, resolved, client);
  assert.equal(r.stale, true);
});

check("changing the catalog changes the catalog_version (no silent reuse of a stale snapshot)", () => {
  const base = catalogVersion(cat.products);
  const bumped = cat.products.map((p, i) => (i === 0 ? { ...p, price: p.price + 123 } : p));
  assert.notEqual(catalogVersion(bumped), base, "any price change → a new catalog_version");
  assert.notEqual(catalogVersion(cat.products.slice(1)), base, "removing a product → a new catalog_version");
  assert.equal(catalogVersion(cat.products), base, "the same snapshot hashes stably (deterministic)");
});

if (process.exitCode === 1) console.error("\nFAIL — version coherence broke.\n");
else console.log(`\nPASS — all ${passed} version-coherence assertions passed.\n`);
