/**
 * tests/platform.tenant.test.mjs — Multi-tenant store isolation (ADR-0022).
 *
 * The security cornerstone: prove there is NO cross-tenant leakage — a tenant
 * can never read, list, overwrite, delete, or reparent another tenant's projects
 * or secrets. Exits non-zero on failure.
 */

import assert from "node:assert/strict";
import { createMemoryStore } from "../platform/tenantStore.js";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

console.log("\ntenant store — isolation:");

check("a non-empty tenantId is required on every op", () => {
  const s = createMemoryStore();
  assert.throws(() => s.getProject("", "p1"), /tenantId/);
  assert.throws(() => s.putProject(null, {}), /tenantId/);
  assert.throws(() => s.listProjects(undefined), /tenantId/);
});

check("putProject assigns an id and stamps the AUTHORITATIVE tenantId", () => {
  const s = createMemoryStore({ genId: () => "fixed1" });
  s.createTenant("A");
  const row = s.putProject("A", { brandUrl: "https://a.com", tenantId: "B" /* client lie */ });
  assert.equal(row.id, "fixed1");
  assert.equal(row.tenantId, "A", "client-supplied tenantId must be ignored");
});

check("a tenant reads only its own project; a foreign read → null", () => {
  const s = createMemoryStore();
  s.createTenant("A"); s.createTenant("B");
  const a = s.putProject("A", { brandUrl: "https://a.com" });
  assert.ok(s.getProject("A", a.id));
  assert.equal(s.getProject("B", a.id), null, "tenant B must not see tenant A's project");
});

check("listProjects returns only the caller's rows", () => {
  const s = createMemoryStore();
  s.createTenant("A"); s.createTenant("B");
  s.putProject("A", { brandUrl: "https://a1.com" });
  s.putProject("A", { brandUrl: "https://a2.com" });
  s.putProject("B", { brandUrl: "https://b1.com" });
  assert.equal(s.listProjects("A").length, 2);
  assert.equal(s.listProjects("B").length, 1);
  assert.ok(s.listProjects("A").every((p) => p.tenantId === "A"));
});

check("a cross-tenant overwrite is refused and leaves the row untouched", () => {
  const s = createMemoryStore();
  s.createTenant("A"); s.createTenant("B");
  const a = s.putProject("A", { brandUrl: "https://a.com", secretNote: "A-only" });
  const attempt = s.putProject("B", { id: a.id, brandUrl: "https://evil.com" });
  assert.equal(attempt, null, "cross-tenant write must be refused");
  assert.equal(s.getProject("A", a.id).brandUrl, "https://a.com", "row unchanged");
});

check("a cross-tenant delete is refused", () => {
  const s = createMemoryStore();
  s.createTenant("A"); s.createTenant("B");
  const a = s.putProject("A", { brandUrl: "https://a.com" });
  assert.equal(s.deleteProject("B", a.id), false);
  assert.ok(s.getProject("A", a.id), "still there");
  assert.equal(s.deleteProject("A", a.id), true);
  assert.equal(s.getProject("A", a.id), null);
});

check("per-tenant secrets never leak across tenants", () => {
  const s = createMemoryStore();
  s.createTenant("A"); s.createTenant("B");
  s.putSecret("A", "webhook", "https://hooks/A");
  assert.equal(s.getSecret("A", "webhook"), "https://hooks/A");
  assert.equal(s.getSecret("B", "webhook"), null, "tenant B must not read tenant A's secret");
});

check("secrets are not exposed through project reads", () => {
  const s = createMemoryStore();
  s.createTenant("A");
  s.putSecret("A", "apiKey", "sk-A");
  const a = s.putProject("A", { brandUrl: "https://a.com" });
  assert.equal(JSON.stringify(s.getProject("A", a.id)).includes("sk-A"), false);
});

if (process.exitCode === 1) console.error("\nFAIL — tenant isolation tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} tenant-isolation assertions passed.\n`);
