/**
 * tests/step1.publish-reachability.test.mjs — STEP 1 reachability. The recurring failure mode on this
 * project is "the guard exists but the production entry doesn't reach it" (the three unwired guards; the
 * brain tests on derived data; the whole kernel). A publish gate is worthless if the real publish entry
 * calls a path BESIDE it. There are exactly TWO server-side publish entries; this suite proves BOTH
 * route through the SAME proof-coverage gate — statically (the wiring exists) AND behaviourally (a
 * proofless funnel driven from each entry is NOT published).
 *
 *   entry 1 (async / Netlify): generate-background handler → runJob → recordFrom  (gate in recordFrom)
 *   entry 2 (Studio lifecycle): studio.generate / studio.publish → _gatesGreen    (gate in _gatesGreen)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runJob, recordFrom } from "../platform/jobs/generateJob.js";
import { createDraft, generate, publish } from "../platform/studio.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const checkA = async (n, f) => { try { await f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/* ── STATIC reachability: the wiring from each production entry to the gate exists ── */
check("entry 1: generate-background (the Netlify publish entry) routes through runJob (not a side path)", () => {
  const src = read("../netlify/functions/generate-background.mjs");
  assert.ok(/import\s*\{[^}]*\brunJob\b[^}]*\}\s*from\s*["'][^"']*generateJob/.test(src), "imports runJob from the job core");
  assert.ok(/runJob\s*\(/.test(src), "actually calls runJob (the persist path with the gate)");
});
check("runJob persists ONLY through recordFrom (the gate), and recordFrom gates on verify.ok", () => {
  const src = read("../platform/jobs/generateJob.js");
  const runJobBody = src.slice(src.indexOf("export async function runJob"));
  assert.ok(/const\s+record\s*=\s*recordFrom\(/.test(runJobBody), "runJob shapes its stored record via recordFrom");
  // recordFrom fails closed on the publish gate
  const recBody = src.slice(src.indexOf("export function recordFrom"), src.indexOf("export async function runJob"));
  assert.ok(/res\.verify\s*\|\|\s*res\.verify\.ok\s*!==\s*true|!res\.verify\s*\|\|\s*res\.verify\.ok\s*!==\s*true/.test(recBody), "recordFrom refuses ready unless verify.ok === true (fail closed)");
});
check("entry 2: studio publish gate _gatesGreen requires verify.ok (not just trust + bland)", () => {
  const src = read("../platform/studio.js");
  const g = src.slice(src.indexOf("function _gatesGreen"));
  assert.ok(/gates\.verify\s*&&\s*gates\.verify\.ok/.test(g), "_gatesGreen conjunction includes verify.ok");
  assert.ok(/_gatesGreen\(gates\)/.test(src) && /_gatesGreen\(project\.gates\)/.test(src), "both generate() and publish() consult _gatesGreen");
});

/* ── BEHAVIOURAL reachability: a PROOFLESS funnel driven from EACH real entry is NOT published ── */
const CFG = { id: "f", scoring: { mode: "decision-table" }, questions: [], archetypes: [] };
const CATALOG = { origin: "https://b.com", products: [{ name: "P" }] };
const prooflessRes = { ok: true, source: "ai", config: CFG, catalog: CATALOG,
  trust: { ok: true, findings: [] }, bland: { ok: true, findings: [] }, verify: { ok: false, findings: [{ code: "PROOF_COVERAGE" }] } };
const passingRes = { ...prooflessRes, verify: { ok: true, findings: [] } };

await checkA("entry 1 behaviour: runJob(proofless) → stored record is NOT 'ready' (withheld at the gate)", async () => {
  const m = new Map();
  const store = { async get(k) { return m.has(k) ? m.get(k) : null; }, async set(k, v) { m.set(k, v); } };
  await runJob({ id: "j1", url: "https://b.com", store, generate: async () => prooflessRes });
  assert.equal((await store.get("j1")).status, "error", "a proofless funnel is not served");
  assert.equal((await store.get("j1")).reason, "publish-gate:proof-coverage-below-100");
  // control: a passing funnel from the SAME entry IS served (the gate isn't over-blocking)
  await runJob({ id: "j2", url: "https://b.com", store, generate: async () => passingRes });
  assert.equal((await store.get("j2")).status, "ready");
});

await checkA("entry 2 behaviour: studio.generate(proofless) → blocked; publish() refuses it", async () => {
  const p = await generate(createDraft({ tenantId: "A", url: "https://b.com" }), { generate: async () => prooflessRes });
  assert.equal(p.status, "blocked", "the Studio entry withholds a proofless funnel");
  assert.equal(publish({ ...p, status: "in-review" }, { origin: "https://x.com" }).ok, false, "publish refuses it even if forced in-review");
  // control: a passing funnel reaches in-review and publishes
  const ok = await generate(createDraft({ tenantId: "A", url: "https://b.com" }), { generate: async () => passingRes });
  assert.equal(ok.status, "in-review");
});

if (process.exitCode === 1) console.error("\nFAIL — a production publish entry does NOT reach the proof-coverage gate.\n");
else console.log(`\nPASS — all ${passed} publish-reachability assertions passed (both entries gated).\n`);
