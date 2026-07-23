/**
 * tests/platform.studio.test.mjs — Funnel-project lifecycle (ADR-0022).
 *
 * draft → generate → in-review | blocked → refine* → publish → published.
 * Authoring is injected (fake), so this suite tests the STATE MACHINE and its
 * hard rules — blocked-on-gate-fail, refuse-on-refine-break, honest publish —
 * not the gates themselves (they have their own suites). Exits non-zero on fail.
 */

import assert from "node:assert/strict";
import { createDraft, generate, refine, publish } from "../platform/studio.js";
import { createMemoryStore } from "../platform/tenantStore.js";

const GREEN = { trust: { ok: true, findings: [] }, bland: { ok: true, findings: [] } };
const CFG = (id = "brand-advisor") => ({ id, brand: { name: "Brand" }, leadForm: {}, analytics: {} });
const CATALOG = { origin: "https://brand.com", products: [{ name: "P1" }], report: {} };
const genOk = async () => ({ ok: true, config: CFG(), catalog: CATALOG, ...GREEN, meta: {} });

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

await (async () => {
  console.log("\nstudio — draft + generate:");
  await check("createDraft starts in 'draft'", () => {
    const p = createDraft({ tenantId: "A", url: "https://brand.com", goal: "sell high-margin" });
    assert.equal(p.status, "draft");
    assert.equal(p.goal, "sell high-margin");
  });
  await check("generate + both gates green → in-review with config & catalog", async () => {
    const p = await generate(createDraft({ tenantId: "A", url: "https://brand.com" }), { generate: genOk });
    assert.equal(p.status, "in-review");
    assert.equal(p.config.id, "brand-advisor");
    assert.equal(p.catalog.brandUrl, "https://brand.com");
    assert.ok(p.gates.trust.ok && p.gates.bland.ok);
  });
  await check("authoring failure → blocked with an honest stage:reason", async () => {
    const gen = async () => ({ ok: false, stage: "ingest", reason: "empty-catalog" });
    const p = await generate(createDraft({ tenantId: "A", url: "https://brand.com" }), { generate: gen });
    assert.equal(p.status, "blocked");
    assert.equal(p.blockedReason, "ingest:empty-catalog");
  });
  await check("a FAILING gate never reaches review → blocked 'failed-gate' (with findings)", async () => {
    const gen = async () => ({ ok: true, config: CFG(), catalog: CATALOG,
      trust: { ok: true, findings: [] }, bland: { ok: false, findings: [{ code: "BLAND_MIRROR" }] } });
    const p = await generate(createDraft({ tenantId: "A", url: "https://brand.com" }), { generate: gen });
    assert.equal(p.status, "blocked");
    assert.equal(p.blockedReason, "failed-gate");
    assert.equal(p.gates.bland.ok, false);
    assert.ok(p.config, "config kept so the operator can see WHY it was blocked");
  });

  console.log("\nstudio — refine (gate-guarded):");
  const reviewable = await generate(createDraft({ tenantId: "A", url: "https://brand.com" }), { generate: genOk });
  await check("a refine that keeps gates green is accepted and updates the config", () => {
    const reauthor = () => ({ ok: true, config: CFG("brand-advisor-v2"), ...GREEN });
    const r = refine(reviewable, { brandName: "Brand X" }, { reauthor });
    assert.equal(r.ok, true);
    assert.equal(r.project.config.id, "brand-advisor-v2");
    assert.equal(r.project.knobs.brandName, "Brand X");
    assert.equal(r.project.status, "in-review");
  });
  await check("a refine that BREAKS a gate is REFUSED; project unchanged (gate not weakened)", () => {
    const reauthor = () => ({ ok: true, config: CFG("broken"), trust: { ok: false, findings: [{ code: "TV1" }] }, bland: { ok: true, findings: [] } });
    const r = refine(reviewable, { brandName: "Bad" }, { reauthor });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "failed-gate");
    assert.equal(r.project.config.id, "brand-advisor", "still the last good config");
  });
  await check("refine is rejected when not in-review", () => {
    const draft = createDraft({ tenantId: "A", url: "https://brand.com" });
    const r = refine(draft, {}, { reauthor: () => ({ ok: true, config: CFG(), ...GREEN }) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not-in-review");
  });

  console.log("\nstudio — publish (honest):");
  await check("publish from in-review + green → artifact (hosted URL + embed) + published", () => {
    const r = publish(reviewable, { origin: "https://fulltimedigi.com" });
    assert.equal(r.ok, true);
    assert.equal(r.artifact.funnelId, "a-brand-advisor", "tenant-scoped id");
    assert.equal(r.artifact.hostedUrl, "https://fulltimedigi.com/embed/funnel.html?funnel=a-brand-advisor");
    assert.ok(r.artifact.embedSnippet.includes('data-ftd-funnel="a-brand-advisor"'));
    assert.equal(r.project.status, "published");
  });
  await check("publish wires the chosen webhook sink into the published config", () => {
    const r = publish(reviewable, { origin: "https://fulltimedigi.com", sink: { webhookUrl: "https://hooks.example/z" } });
    assert.equal(r.artifact.config.leadForm.webhookUrl, "https://hooks.example/z");
    assert.deepEqual(r.artifact.sink.kinds, ["webhook"]);
  });
  await check("publish refuses when not in-review", () => {
    const draft = createDraft({ tenantId: "A", url: "https://brand.com" });
    assert.equal(publish(draft, { origin: "https://x.com" }).ok, false);
  });
  await check("publish refuses a project whose gates are not green (guard, not reachable via generate)", () => {
    const bad = { ...reviewable, gates: { trust: { ok: false }, bland: { ok: true } } };
    const r = publish(bad, { origin: "https://x.com" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "failed-gate");
  });

  console.log("\nstudio + store — end to end, tenant-scoped:");
  await check("draft → generate → publish, persisted and isolated", async () => {
    const store = createMemoryStore();
    store.createTenant("acme");
    let p = store.putProject("acme", createDraft({ tenantId: "acme", url: "https://acme.com" }));
    p = store.putProject("acme", await generate(p, { generate: genOk }));
    assert.equal(store.getProject("acme", p.id).status, "in-review");
    const pub = publish(store.getProject("acme", p.id), { origin: "https://fulltimedigi.com" });
    store.putProject("acme", pub.project);
    assert.equal(store.getProject("acme", p.id).status, "published");
    assert.equal(store.getProject("other", p.id), null, "another tenant still can't see it");
  });

  if (process.exitCode === 1) console.error("\nFAIL — studio lifecycle tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} studio-lifecycle assertions passed.\n`);
})();
