/**
 * tests/errormonitor.test.mjs — Error-monitor tests (ADR-0005).
 *
 * Verifies the ported production error monitor is: (a) Node-safe — never throws,
 * even pre-init, with no `window`, or when storage itself throws; (b) a working
 * localStorage ring buffer; and (c) PII-masking — the reason this module exists.
 *
 * Node + a minimal localStorage shim. No browser, no deps. `window` is left
 * undefined on purpose — the module must install its global handlers guarded.
 * Exits non-zero on failure.
 */

import assert from "node:assert/strict";

/* ------------------------------------------------ minimal localStorage shim --- */
let _ls = {};
function installStore() {
  _ls = {};
  globalThis.localStorage = {
    getItem: (k) => (k in _ls ? _ls[k] : null),
    setItem: (k, v) => { _ls[k] = String(v); },
    removeItem: (k) => { delete _ls[k]; },
  };
}
installStore();

/* --------------------------------------- silence + capture console output ---- */
const _console = { error: console.error, warn: console.warn, info: console.info };
const seen = { error: 0, warn: 0, info: 0 };
console.error = () => { seen.error++; };
console.warn  = () => { seen.warn++; };
console.info  = () => { seen.info++; };
function restoreConsole() { Object.assign(console, _console); }

/* ------------------------------------------------------------------ harness --- */
const mon = await import("../engine/error-monitor.js");

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; _console.info(`  ✓ ${name}`); })
    .catch((err) => { _console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

/* -------------------------------------------------------------------- tests --- */
await (async () => {
  _console.info("\nNode-safety (must never throw):");
  await check("logging before init is console-only and does not touch storage", () => {
    mon.error("pre-init error", { foo: "bar" });
    // No funnel key written yet (init not called).
    assert.deepEqual(Object.keys(_ls), []);
    assert.ok(seen.error > 0, "console.error was called pre-init");
  });

  await check("initMonitor does not throw with no `window` (global handlers guarded)", () => {
    assert.equal(typeof globalThis.window, "undefined"); // no DOM in this harness
    mon.initMonitor("errmon_test", null); // must not throw ReferenceError
    assert.ok(true);
  });

  _console.info("\nlocalStorage ring buffer:");
  await check("error/warn/info after init enqueue to localStorage", () => {
    mon.clearStoredErrors();
    mon.error("boom");
    mon.warn("odd");
    mon.info("fyi");
    const stored = mon.getStoredErrors();
    assert.equal(stored.length, 3);
    assert.deepEqual(stored.map((e) => e.level), ["error", "warn", "info"]);
    assert.equal(stored[0].funnelId, "errmon_test");
    assert.ok(stored[0].id.startsWith("err_"));
    assert.ok(stored[0].timestamp.includes("T")); // ISO
  });

  await check("ring buffer keeps only the newest 50 entries", () => {
    mon.clearStoredErrors();
    for (let i = 0; i < 55; i++) mon.info(`e${i}`);
    const stored = mon.getStoredErrors();
    assert.equal(stored.length, 50);
    assert.equal(stored[0].message, "e5");   // oldest 5 discarded
    assert.equal(stored[49].message, "e54");
  });

  await check("clearStoredErrors empties the queue", () => {
    mon.info("temp");
    assert.ok(mon.getStoredErrors().length > 0);
    mon.clearStoredErrors();
    assert.equal(mon.getStoredErrors().length, 0);
  });

  _console.info("\nPII masking (the reason this module exists):");
  await check("email → ***@domain, phone → last 4, name → ***", () => {
    mon.clearStoredErrors();
    mon.error("lead failed", {
      email: "Saif@Example.com",
      phone: "+96598765432",
      name: "Saif Ali",
      userEmail: "other@host.io", // key *contains* 'email'
      step: 3,                    // non-PII passthrough
    });
    const ctx = mon.getStoredErrors()[0].context;
    assert.equal(ctx.email, "***@Example.com");
    assert.equal(ctx.phone.slice(-4), "5432");
    assert.ok(!ctx.phone.includes("9876")); // leading digits masked
    assert.equal(ctx.name, "***");
    assert.equal(ctx.userEmail, "***@host.io");
    assert.equal(ctx.step, 3);
  });

  await check("nested objects are sanitized one level deep", () => {
    mon.clearStoredErrors();
    mon.error("nested", { user: { email: "a@b.com", age: 30 } });
    const ctx = mon.getStoredErrors()[0].context;
    assert.equal(ctx.user.email, "***@b.com");
    assert.equal(ctx.user.age, 30);
  });

  await check("error(msg, Error) captures name + trimmed stack, no PII, no throw", () => {
    mon.clearStoredErrors();
    mon.error("threw", new TypeError("bad thing"));
    const ctx = mon.getStoredErrors()[0].context;
    assert.equal(ctx.errorName, "TypeError");
    assert.equal(typeof ctx.stack, "string");
  });

  _console.info("\nHonest failure (storage itself throws):");
  await check("a throwing localStorage never crashes a log call", () => {
    const saved = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => { throw new Error("storage denied"); },
      setItem: () => { throw new Error("storage denied"); },
      removeItem: () => { throw new Error("storage denied"); },
    };
    // Must not throw; queue read degrades to [].
    mon.error("during storage outage", { email: "x@y.com" });
    assert.deepEqual(mon.getStoredErrors(), []);
    globalThis.localStorage = saved;
  });

  restoreConsole();
  if (process.exitCode === 1) console.error("\nFAIL — error-monitor tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} error-monitor assertions passed.\n`);
})();
