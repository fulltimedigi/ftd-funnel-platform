/**
 * tests/houseplant.decision.test.mjs — Houseplant Advisor decision logic.
 * Mirrors the PM reference's decision test: personas + totality + pipeline.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { score } from "../engine/scoring.js";
import { decide } from "../engine/decide.js";
import { resolve } from "../engine/resolver.js";

const CFG = JSON.parse(readFileSync(fileURLToPath(new URL("../configs/houseplant-advisor.json", import.meta.url))));
let passed = 0;
const check = (n, fn) => { try { fn(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const X = { none: "opt_none", struggled: "opt_struggled", some: "opt_some", thriving: "opt_thriving" };
const C = { min: "opt_minimal", reg: "opt_regular", unsure: "opt_careunsure" };
const L = { low: "opt_low", bright: "opt_bright" };
const P = { pets: "opt_pets", no: "opt_nopets" };
const a = (x, c, l, p, g) => { const o = { q_experience: x }; if (c) o.q_care = c; if (l) o.q_light = l; if (p) o.q_pets = p; if (g) o.q_goal = g; return o; };

console.log("\nPersonas → result:");
const PERSONAS = [
  ["new beginner, low light",        a(X.none, C.min, L.low, P.no),   "LOWLIGHT"],
  ["new beginner, bright",           a(X.none, C.min, L.bright, P.no),"BRIGHT"],
  ["committed, bright",              a(X.some, C.reg, L.bright, P.no), "FUSSY"],
  ["committed but LOW light (clamp)",a(X.some, C.reg, L.low, P.no),    "LOWLIGHT"],
  ["committed + pets",               a(X.some, C.reg, L.bright, P.pets),"SAFE_FUSSY"],
  ["easy + pets",                    a(X.some, C.min, L.bright, P.pets),"SAFE_EASY"],
  ["unsure care, no pets",           a(X.none, C.unsure, L.low, P.no), "SAFESTART"],
  ["unsure care + pets (safe default)",a(X.none, C.unsure, L.low, P.pets),"SAFE_EASY"],
  ["thriving + pets (short-circuit)",a(X.thriving, null, null, P.pets),"EXPERT"],
  ["struggled→new: stays easy (not demanding)", a(X.struggled, C.reg, L.bright, P.no), "BRIGHT"],
];
for (const [n, ans, exp] of PERSONAS) check(`${n} → ${exp}`, () => {
  const r = score(CFG, ans);
  assert.equal(r.primary, exp, `got ${r.primary} (rule ${r.ruleId})`);
});

console.log("\nTotality — the table is a complete partition:");
check("every derived-signal cell resolves to exactly one result; all 7 reachable", () => {
  const PETS = ["pets", "none"], LIGHT = ["low", "bright"], TIER = ["new", "growing", "expert"], READY = ["easy", "demanding", "unsure"];
  const hits = new Set(); let cells = 0;
  for (const DS_pets of PETS) for (const DS_light of LIGHT) for (const DS_tier of TIER) for (const DS_ready of READY) {
    cells++;
    const { result } = decide({ DS_pets, DS_light, DS_tier, DS_ready }, CFG.decisionTable);
    assert.ok(result, `no result for ${DS_pets}/${DS_light}/${DS_tier}/${DS_ready}`);
    hits.add(result);
  }
  assert.equal(cells, 2 * 2 * 3 * 3);
  assert.deepEqual([...hits].sort(), ["BRIGHT", "EXPERT", "FUSSY", "LOWLIGHT", "SAFESTART", "SAFE_EASY", "SAFE_FUSSY"]);
});
check("struggled experience never reaches a demanding plant (over-capture guard)", () => {
  // struggled → tier 'new', and the demanding case needs experience some/thriving → stays easy
  const r = score(CFG, a(X.struggled, C.reg, L.bright, P.no));
  assert.equal(r.signals.DS_tier, "new");
  assert.equal(r.signals.DS_ready, "easy");
});

console.log("\nPipeline — resolver consumes the output:");
check("resolve maps result id → archetype object", () => {
  const r = score(CFG, a(X.none, C.min, L.low, P.no));
  const resolved = resolve(r, CFG);
  assert.equal(resolved.primary.id, "LOWLIGHT");
  assert.ok(resolved.primary.name);
});

if (process.exitCode === 1) console.error("\nFAIL\n"); else console.log(`\nPASS — all ${passed} houseplant-decision assertions passed.\n`);
