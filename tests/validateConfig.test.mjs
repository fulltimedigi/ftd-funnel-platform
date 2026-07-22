/**
 * tests/validateConfig.test.mjs — Executable config schema (ADR-0009).
 *
 * Verifies the config validator against the REAL configs/_schema.json: every
 * shipped config validates clean (proving the schema is a true, consistent
 * contract now that it executes), and each class of violation is caught —
 * missing required, wrong type, bad enum (top-level + nested), count floors
 * (archetypes / options), and a $ref-resolved rule (recommendation.becauseTemplate).
 *
 * Pure Node, no deps. Exits non-zero on failure.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { validateConfig, formatValidationErrors } = await import("../engine/validateConfig.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const configsDir = join(__dirname, "../configs");
const schema = JSON.parse(readFileSync(join(configsDir, "_schema.json"), "utf8"));

const load = (name) => JSON.parse(readFileSync(join(configsDir, name), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const base = load("freelancex.json");

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

const hasErrAt = (res, substr) => res.errors.some((e) => e.path.includes(substr));

await (async () => {
  console.log("\nEvery shipped config validates clean against the real schema:");
  const configFiles = readdirSync(configsDir).filter((f) => f.endsWith(".json") && f !== "_schema.json");
  for (const f of configFiles) {
    await check(`${f} is valid`, () => {
      const res = validateConfig(load(f), schema);
      assert.ok(res.valid, `expected valid, got:\n${formatValidationErrors(res)}`);
    });
  }

  console.log("\nViolations are caught:");
  await check("missing a required top-level key (questions) → invalid", () => {
    const c = clone(base); delete c.questions;
    const res = validateConfig(c, schema);
    assert.equal(res.valid, false);
    assert.ok(hasErrAt(res, "questions"));
  });

  await check("wrong type (id as number) → invalid", () => {
    const c = clone(base); c.id = 123;
    const res = validateConfig(c, schema);
    assert.equal(res.valid, false);
    assert.ok(hasErrAt(res, "id"));
  });

  await check("bad top-level enum (resultLayout) → invalid", () => {
    const c = clone(base); c.resultLayout = "carousel";
    const res = validateConfig(c, schema);
    assert.equal(res.valid, false);
    assert.ok(hasErrAt(res, "resultLayout"));
  });

  await check("bad nested enum (scoring.mode) → invalid", () => {
    const c = clone(base); c.scoring.mode = "vibes";
    const res = validateConfig(c, schema);
    assert.equal(res.valid, false);
    assert.ok(hasErrAt(res, "scoring.mode"));
  });

  await check("archetypes below the count floor (1) → invalid", () => {
    const c = clone(base); c.archetypes = [c.archetypes[0]];
    const res = validateConfig(c, schema);
    assert.equal(res.valid, false);
    assert.ok(hasErrAt(res, "archetypes"));
  });

  await check("a question with fewer than 2 options → invalid", () => {
    const c = clone(base); c.questions[0].options = [c.questions[0].options[0]];
    const res = validateConfig(c, schema);
    assert.equal(res.valid, false);
    assert.ok(hasErrAt(res, "options"));
  });

  await check("$ref rule enforced: a recommendation missing becauseTemplate → invalid", () => {
    const c = clone(base);
    delete c.archetypes[0].recommendations.primary.becauseTemplate;
    const res = validateConfig(c, schema);
    assert.equal(res.valid, false);
    assert.ok(hasErrAt(res, "becauseTemplate"));
  });

  console.log("\nLenient where the schema is lenient; helpful output:");
  await check("unknown extra property is allowed (no additionalProperties:false)", () => {
    const c = clone(base); c.somethingNew = { anything: true };
    assert.equal(validateConfig(c, schema).valid, true);
  });

  await check("formatValidationErrors renders each error on its own line", () => {
    const c = clone(base); delete c.cta; c.resultLayout = "nope";
    const res = validateConfig(c, schema);
    const text = formatValidationErrors(res);
    assert.ok(text.includes("cta"));
    assert.ok(text.includes("resultLayout"));
    assert.equal(text.split("\n").length, res.errors.length);
  });

  await check("validateConfig never throws on a malformed schema", () => {
    const res = validateConfig(base, { type: "object", properties: null, required: "oops" });
    assert.ok(res && Array.isArray(res.errors)); // returned a result, did not throw
  });

  if (process.exitCode === 1) console.error("\nFAIL — config-validation tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} config-validation assertions passed.\n`);
})();
