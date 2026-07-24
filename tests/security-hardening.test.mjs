/**
 * tests/security-hardening.test.mjs — the fail-closed security round (ADR-0040).
 * ===========================================================================================
 * Every assertion is a REVERT-CATCHER: it fails if the specific fix is undone. Grouped by the
 * audit item it closes. No network — env is toggled in-process; fetch/lookup/store are injected.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { isProd, safeEqual, requireSecret } from "../platform/security/secrets.js";
import { keyFor, reserveDailySlot, IN_FLIGHT_MS } from "../platform/jobs/generateJob.js";
import { assertUrlAllowed, classifyHost, parseIPv4Any, isPrivateV4 } from "../authoring/ingest/ssrfGuard.js";
import { createFetcher } from "../authoring/ingest/fetcher.js";
import { safeConfigPath, safeFunnelId, resolveConfigSource } from "../platform/configSource.js";
import { tokenOk } from "../netlify/functions/lib/http.mjs";
import { triggerBase } from "../netlify/functions/generate-submit.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}
/** Run fn with a given process.env patch, then restore. */
async function withEnv(patch, fn) {
  const saved = {};
  for (const k of Object.keys(patch)) { saved[k] = process.env[k]; if (patch[k] === undefined) delete process.env[k]; else process.env[k] = patch[k]; }
  try { return await fn(); }
  finally { for (const k of Object.keys(patch)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const PROD = { CONTEXT: "production", NODE_ENV: undefined };
const DEV = { CONTEXT: "dev", NODE_ENV: undefined };

await (async () => {

  console.log("\n[1] secrets triad — fail-closed in production, lenient only in dev:");
  await check("isProd(): production/deploy-preview/branch-deploy = prod; dev = not", async () => {
    await withEnv({ CONTEXT: "production", NODE_ENV: undefined }, () => assert.equal(isProd(), true));
    await withEnv({ CONTEXT: "deploy-preview", NODE_ENV: undefined }, () => assert.equal(isProd(), true, "a public preview must fail-closed too"));
    await withEnv({ CONTEXT: "branch-deploy", NODE_ENV: undefined }, () => assert.equal(isProd(), true));
    await withEnv({ CONTEXT: "dev", NODE_ENV: undefined }, () => assert.equal(isProd(), false));
    await withEnv({ CONTEXT: undefined, NODE_ENV: "production" }, () => assert.equal(isProd(), true));
  });
  await check("requireSecret: prod + missing → {ok:false, prod:true} (refuse); dev + missing → prod:false (lenient)", async () => {
    await withEnv({ ...PROD, FTD_X: undefined }, () => { const r = requireSecret("FTD_X"); assert.equal(r.ok, false); assert.equal(r.prod, true); });
    await withEnv({ ...DEV, FTD_X: undefined }, () => { const r = requireSecret("FTD_X"); assert.equal(r.ok, false); assert.equal(r.prod, false); });
    await withEnv({ FTD_X: "v" }, () => { const r = requireSecret("FTD_X"); assert.equal(r.ok, true); assert.equal(r.value, "v"); });
  });
  await check("FTD_INTERNAL_SECRET fail-closed: background refuses (503) in prod when unset; 401 on wrong; runs on right", async () => {
    const { handler } = await import("../netlify/functions/generate-background.mjs");
    await withEnv({ ...PROD, FTD_INTERNAL_SECRET: undefined }, async () => {
      const r = await handler({ headers: {}, body: "{}" });
      assert.equal(r.statusCode, 503, "prod + no internal secret → 503 (was: silently skipped → wide open)");
    });
    await withEnv({ FTD_INTERNAL_SECRET: "abc" }, async () => {
      const wrong = await handler({ headers: { "x-ftd-internal": "nope" }, body: "{}" });
      assert.equal(wrong.statusCode, 401, "wrong secret → 401");
      const right = await handler({ headers: { "x-ftd-internal": "abc" }, body: JSON.stringify({ url: "https://x.example/" }) });
      assert.notEqual(right.statusCode, 401, "correct secret passes auth");
      assert.notEqual(right.statusCode, 503);
    });
    await withEnv({ ...DEV, FTD_INTERNAL_SECRET: undefined }, async () => {
      const r = await handler({ headers: {}, body: JSON.stringify({ url: "https://x.example/" }) });
      assert.notEqual(r.statusCode, 503, "dev + no secret → lenient (not refused)");
    });
  });
  await check("FTD_PUBLIC_TOKEN default-DENY in prod when unset; lenient in dev", async () => {
    await withEnv({ ...PROD, FTD_PUBLIC_TOKEN: undefined }, () => assert.equal(tokenOk({ headers: {} }), false, "prod + no token → DENY (was: return true → open)"));
    await withEnv({ ...DEV, FTD_PUBLIC_TOKEN: undefined }, () => assert.equal(tokenOk({ headers: {} }), true, "dev + no token → allow"));
    await withEnv({ FTD_PUBLIC_TOKEN: "s3cret" }, () => {
      assert.equal(tokenOk({ headers: { "x-ftd-token": "s3cret" } }), true);
      assert.equal(tokenOk({ headers: { "x-ftd-token": "wrong" } }), false);
    });
  });

  console.log("\n[2] job id — HMAC + mandatory salt (never hash with empty key):");
  await check("prod + no FTD_ID_SALT → keyFor THROWS (never falls back to empty/guessable)", async () => {
    await withEnv({ ...PROD, FTD_ID_SALT: undefined }, () => assert.throws(() => keyFor("https://brand.com/"), /FTD_ID_SALT is required/));
  });
  await check("keyFor is an HMAC (≠ the old sha256(salt+url)); salted≠unsalted; deterministic", async () => {
    const salt = "salt-A", url = "https://brand.com/";
    const oldWay = createHash("sha256").update(salt + "|" + "https://brand.com").digest("hex").slice(0, 32);
    assert.notEqual(keyFor(url, salt), oldWay, "must be HMAC-keyed, not a plain salt+url hash");
    assert.equal(keyFor(url, salt), keyFor("brand.com", salt), "deterministic across url normalization");
    assert.notEqual(keyFor(url, "salt-A"), keyFor(url, "salt-B"), "salt changes the key");
    assert.match(keyFor(url, salt), /^[0-9a-f]{32}$/);
  });

  console.log("\n[3] SSRF — every IPv4 encoding + IPv6 literal is decoded before the range check:");
  await check("parseIPv4Any decodes decimal / hex / octal / short-form to 127.0.0.1", () => {
    const loopback = parseIPv4Any("127.0.0.1");
    for (const form of ["2130706433", "0x7f000001", "0177.0.0.1", "127.1", "0x7f.0.0.1"]) {
      assert.equal(parseIPv4Any(form), loopback, `${form} must decode to 127.0.0.1`);
    }
  });
  await check("assertUrlAllowed BLOCKS obfuscated loopback/metadata in every encoding", () => {
    for (const u of [
      "http://2130706433/",           // decimal 127.0.0.1
      "http://0x7f000001/",           // hex
      "http://0177.0.0.1/",           // octal
      "http://127.1/",                // short-form
      "http://[::1]/",                // IPv6 loopback literal
      "http://[::ffff:169.254.169.254]/", // IPv6-mapped metadata
      "http://2852039166/",           // decimal 169.254.169.254
    ]) assert.equal(assertUrlAllowed(u).ok, false, "must block " + u);
    // a real public host/IP still passes
    assert.equal(assertUrlAllowed("https://oud.example/").ok, true);
    assert.equal(assertUrlAllowed("http://8.8.8.8/").ok, true);
  });

  console.log("\n[4] SSRF — DNS rebinding: a public name resolving to a private IP is refused at fetch:");
  await check("a public hostname that resolves to 169.254.169.254 is BLOCKED (not fetched)", async () => {
    let fetched = false;
    const f = createFetcher({
      fetch: async () => { fetched = true; return { status: 200, url: "x", headers: { get: () => "" }, text: async () => "" }; },
      lookup: async () => [{ address: "169.254.169.254", family: 4 }], // rebind: public name → metadata IP
      minDelayMs: 0,
    });
    const r = await f.get("https://evil.example/");
    assert.equal(r.ok, false);
    assert.match(r.reason, /blocked-url:blocked-dns-private/);
    assert.equal(fetched, false, "must refuse BEFORE the fetch leaves");
  });
  await check("a redirect target that rebinds to a private IP is BLOCKED on the hop", async () => {
    let hop = 0;
    const f = createFetcher({
      fetch: async () => { hop++; return hop === 1 ? { status: 302, headers: { get: (k) => k === "location" ? "https://inner.evil/" : "" } } : { status: 200, url: "x", headers: { get: () => "" }, text: async () => "" }; },
      lookup: async (host) => host === "start.example" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }],
      minDelayMs: 0,
    });
    const r = await f.get("https://start.example/");
    assert.equal(r.ok, false);
    assert.match(r.reason, /blocked-redirect:blocked-dns-private/);
  });
  await check("offline fixture tests (fetch injected, no lookup) SKIP DNS — hermetic, unchanged", async () => {
    let fetched = false;
    const f = createFetcher({ fetch: async () => { fetched = true; return { ok: true, status: 200, url: "x", headers: { get: () => "text/html" }, text: async () => "ok" }; }, minDelayMs: 0 });
    const r = await f.get("https://oud.example/");
    assert.equal(r.ok, true); assert.equal(fetched, true);
  });

  console.log("\n[5] ?config — same-origin only (no arbitrary cross-origin content under our origin):");
  await check("safeConfigPath rejects cross-origin / scheme / protocol-relative; accepts same-origin relative", () => {
    const base = "https://ftd.example/embed/funnel.html", origin = "https://ftd.example";
    assert.equal(safeConfigPath("https://evil.com/x.json", base, origin), null, "cross-origin absolute → null");
    assert.equal(safeConfigPath("//evil.com/x.json", base, origin), null, "protocol-relative → null");
    assert.equal(safeConfigPath("javascript:alert(1)", base, origin), null, "scheme → null");
    assert.equal(safeConfigPath("..\\..\\x", base, origin), null, "backslash trick → null");
    assert.equal(safeConfigPath("../configs/x.json", base, origin), "../configs/x.json", "same-origin relative → kept");
    assert.equal(safeConfigPath("configs/x.json", base, origin), "configs/x.json", "same-origin relative → kept");
    // relative-only by design: even a same-origin ABSOLUTE url is refused (tightest posture — the app only uses relative)
    assert.equal(safeConfigPath("https://ftd.example/configs/x.json", base, origin), null, "scheme-bearing url → null (relative-only)");
    assert.equal(safeFunnelId("pm-cert-advisor"), "pm-cert-advisor");
    assert.equal(safeFunnelId("../etc/passwd"), null);
  });
  await check("resolveConfigSource: a cross-origin ?config is IGNORED, falls through to ?funnel", () => {
    const ctx = { href: "https://ftd.example/p/review.html", origin: "https://ftd.example", funnelBase: "../../configs/" };
    const spoof = resolveConfigSource("?config=https://evil.com/fake.json&funnel=pm-cert", ctx);
    assert.equal(spoof.funnelId, "pm-cert", "the cross-origin config was refused; the safe funnel id won");
    assert.equal(spoof.configUrl, "../../configs/pm-cert.json");
  });

  console.log("\n[6] daily cost cap — atomic CAS, no TOCTOU over-spend:");
  await check("reserveDailySlot: concurrent submits cannot exceed the cap (CAS + retry)", async () => {
    // a CAS store; an injected competitor writes once between A's read and A's write (a lost race).
    const casStore = () => {
      const m = new Map(); const et = new Map(); let seq = 0; let inject = null;
      return {
        m, setInject(fn) { inject = fn; },
        async getWithMeta(k) { return { value: m.get(k) ?? null, etag: et.get(k) }; },
        async setIfMatch(k, v, tag) { if (inject) { const f = inject; inject = null; await f(); } if (tag !== et.get(k)) return { ok: false }; m.set(k, v); et.set(k, "e" + (++seq)); return { ok: true }; },
      };
    };
    const store = casStore();
    // competitor grabs the only slot (cap=1) during A's CAS window
    store.setInject(async () => { await reserveDailySlot({ store, key: "spend", cap: 1 }); });
    const a = await reserveDailySlot({ store, key: "spend", cap: 1 });
    assert.equal(a, false, "A lost the race and, on retry, saw the cap reached → denied (no over-spend)");
    assert.equal(store.m.get("spend").count, 1, "the counter never exceeded the cap");
  });
  await check("reserveDailySlot: exactly `cap` reservations succeed, the rest are denied", async () => {
    const m = new Map(); const et = new Map(); let seq = 0;
    const store = { async getWithMeta(k) { return { value: m.get(k) ?? null, etag: et.get(k) }; }, async setIfMatch(k, v, tag) { if (tag !== et.get(k)) return { ok: false }; m.set(k, v); et.set(k, "e" + (++seq)); return { ok: true }; } };
    let ok = 0; for (let i = 0; i < 5; i++) if (await reserveDailySlot({ store, key: "d", cap: 3 })) ok++;
    assert.equal(ok, 3, "cap=3 → exactly 3 succeed");
  });

  console.log("\n[7] internal trigger base — trusted env only, NEVER event.headers.host:");
  await check("triggerBase reads DEPLOY_PRIME_URL/URL only; empty when neither set (→ handler 503)", async () => {
    await withEnv({ DEPLOY_PRIME_URL: "https://deploy.example", URL: undefined }, () => assert.equal(triggerBase(), "https://deploy.example"));
    await withEnv({ DEPLOY_PRIME_URL: undefined, URL: "https://site.example" }, () => assert.equal(triggerBase(), "https://site.example"));
    await withEnv({ DEPLOY_PRIME_URL: undefined, URL: undefined }, () => assert.equal(triggerBase(), "", "no trusted base → empty (never a host fallback)"));
  });
  await check("submit with a SPOOFED Host and no trusted base → 503 trigger-unconfigured (secret never sent to Host)", async () => {
    const { handler } = await import("../netlify/functions/generate-submit.mjs");
    await withEnv({ DEPLOY_PRIME_URL: undefined, URL: undefined, FTD_PUBLIC_TOKEN: undefined, CONTEXT: "dev" }, async () => {
      const r = await handler({ httpMethod: "POST", headers: { host: "attacker.example" }, body: JSON.stringify({ url: "https://oud.example/", authorized: true }) });
      assert.equal(r.statusCode, 503);
      assert.equal(JSON.parse(r.body).reason, "trigger-unconfigured", "must refuse, not fetch attacker.example with the secret");
    });
  });

  console.log("\n[8] in-flight window ≥ background runtime (no concurrent double-generation):");
  await check("IN_FLIGHT_MS ≥ 15 min (the Netlify background max runtime)", () => {
    assert.ok(IN_FLIGHT_MS >= 15 * 60 * 1000, `IN_FLIGHT_MS must be ≥ 15 min, is ${IN_FLIGHT_MS / 60000} min`);
  });

  console.log("\n[9] constant-time secret comparison:");
  await check("safeEqual: true on equal, false on different, SAFE on unequal length (no throw/leak)", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abd"), false);
    assert.equal(safeEqual("short", "muchlongervalue"), false, "unequal lengths compare false, never throw");
    assert.equal(safeEqual("", "x"), false);
    assert.equal(safeEqual(undefined, "x"), false);
  });

  console.log("\n[CSP] /embed keeps the FULL hardened policy (not just frame-ancestors):");
  await check("netlify.toml /embed CSP still carries default-src/object-src/base-uri (only frame-ancestors widened)", () => {
    const toml = readFileSync(fileURLToPath(new URL("../netlify.toml", import.meta.url)), "utf8");
    const embedBlock = toml.split('for = "/embed/*"')[1] || "";
    const csp = (embedBlock.match(/Content-Security-Policy = "([^"]*)"/) || [])[1] || "";
    assert.match(csp, /default-src 'self'/, "default-src must survive (was dropped by the one-line override)");
    assert.match(csp, /object-src 'none'/, "object-src must survive");
    assert.match(csp, /base-uri 'self'/, "base-uri must survive");
    assert.match(csp, /frame-ancestors \*/, "frame-ancestors is intentionally wide for the embed product");
  });

  if (process.exitCode === 1) console.error("\nFAIL — a security fix regressed.\n");
  else console.log(`\nPASS — all ${passed} security-hardening assertions passed.\n`);
})();
