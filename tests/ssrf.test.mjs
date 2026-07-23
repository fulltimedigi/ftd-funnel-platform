/**
 * tests/ssrf.test.mjs — SSRF protection (ADR-0032).
 * The classifier refuses loopback / private / link-local / metadata / *.internal, and
 * the fetcher refuses a URL AND a redirect hop pointing at such a host — no network.
 */

import assert from "node:assert/strict";
import { assertUrlAllowed, isPrivateV4, isPrivateV6, classifyHost } from "../authoring/ingest/ssrfGuard.js";
import { createFetcher } from "../authoring/ingest/fetcher.js";

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

await (async () => {
  console.log("\nssrf — the classifier:");
  await check("private / loopback / link-local IPv4 are private", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1"]) assert.equal(isPrivateV4(ip), true, ip);
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) assert.equal(isPrivateV4(ip), false, ip);
  });
  await check("IPv6 loopback / ULA / link-local are private", () => {
    for (const ip of ["::1", "fd00::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.equal(isPrivateV6(ip), true, ip);
    assert.equal(isPrivateV6("2606:4700:4700::1111"), false);
  });
  await check("internal / metadata / localhost hostnames classified", () => {
    assert.equal(classifyHost("metadata.google.internal").blocked, true);
    assert.equal(classifyHost("foo.internal").blocked, true);
    assert.equal(classifyHost("metadata").blocked, true);
    assert.equal(classifyHost("localhost").localhost, true);
    assert.deepEqual(classifyHost("example.com"), {});
  });

  console.log("\nssrf — assertUrlAllowed:");
  await check("refuses localhost / 169.254.169.254 / private IP / ::1 / .internal", () => {
    for (const u of ["http://localhost/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "http://[::1]/", "https://svc.internal/", "http://metadata.google.internal/"]) {
      assert.equal(assertUrlAllowed(u).ok, false, "should block " + u);
    }
  });
  await check("allows a normal public https URL; localhost only with allowLocalhost", () => {
    assert.equal(assertUrlAllowed("https://oudfactory.com/").ok, true);
    assert.equal(assertUrlAllowed("http://localhost:8000/x", { allowLocalhost: true }).ok, true);
    assert.equal(assertUrlAllowed("ftp://x.com/").ok, false); // scheme
  });

  console.log("\nssrf — the fetcher enforces it (URL + every redirect hop):");
  await check("a URL pointing at the metadata IP is refused before any fetch", async () => {
    let called = false;
    const f = createFetcher({ fetch: async () => { called = true; return { ok: true, status: 200, url: "x", text: async () => "", headers: new Map() }; }, minDelayMs: 0 });
    const r = await f.get("http://169.254.169.254/latest/meta-data/");
    assert.equal(r.ok, false);
    assert.match(r.reason, /blocked-url/);
    assert.equal(called, false, "never hit the network");
  });
  await check("a redirect hop to a private IP is refused (redirect:manual re-validation)", async () => {
    const headers = (loc) => ({ get: (k) => (k.toLowerCase() === "location" ? loc : k.toLowerCase() === "content-type" ? "text/html" : null) });
    const fetch = async (u) => {
      if (u === "https://safe.example/") return { ok: false, status: 302, url: u, headers: headers("http://169.254.169.254/"), text: async () => "" };
      return { ok: true, status: 200, url: u, headers: headers(null), text: async () => "ok" };
    };
    const f = createFetcher({ fetch, minDelayMs: 0 });
    const r = await f.get("https://safe.example/");
    assert.equal(r.ok, false);
    assert.match(r.reason, /blocked-redirect/);
  });
  await check("a normal 200 still works (no redirect)", async () => {
    const headers = { get: (k) => (k.toLowerCase() === "content-type" ? "text/html" : null) };
    const f = createFetcher({ fetch: async (u) => ({ ok: true, status: 200, url: u, headers, text: async () => "<html>hi</html>" }), minDelayMs: 0 });
    const r = await f.get("https://oud.example/");
    assert.equal(r.ok, true);
    assert.match(r.text, /hi/);
  });

  if (process.exitCode === 1) console.error("\nFAIL — ssrf tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} ssrf assertions passed.\n`);
})();
