/**
 * tests/ratelimit.test.mjs — per-key fixed-window abuse limiter (pre-generation guard).
 * Proves reserveRateSlot enforces a per-key cap, resets each window, keeps keys isolated,
 * and works over the store's atomic CAS path — the machinery that stops one IP from
 * exhausting the shared daily generation budget or hammering the Opus path.
 */

import assert from "node:assert/strict";
import { windowKey, reserveRateSlot, reserveDailySlot } from "../platform/jobs/generateJob.js";

/** Non-CAS store (exercises the fallback path). */
function plainStore() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async set(k, v) { m.set(k, v); } };
}
/** CAS store (exercises the atomic path used in production Netlify Blobs). */
function casStore() {
  const m = new Map(); let seq = 0;
  return {
    m,
    async get(k) { const r = m.get(k); return r ? r.value : null; },
    async set(k, v) { m.set(k, { value: v, etag: String(++seq) }); },
    async getWithMeta(k) { const r = m.get(k); return r ? { value: r.value, etag: r.etag } : null; },
    async setIfMatch(k, v, etag) {
      const cur = m.get(k);
      // Real CAS semantics: no etag → create only if absent; with etag → replace only if it matches.
      const ok = (etag == null) ? (cur === undefined) : (cur && cur.etag === etag);
      if (!ok) return { ok: false };
      m.set(k, { value: v, etag: String(++seq) }); return { ok: true };
    },
  };
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

await (async () => {
  console.log("\nrate-limit — window keying:");
  await check("key includes the window bucket and rolls over at the boundary", () => {
    const win = 3600e3; // buckets are absolute epoch multiples: [0..win-1]=0, [win..2win-1]=1
    const a = windowKey("ip-h", "X", win, () => 1000);        // bucket 0
    const b = windowKey("ip-h", "X", win, () => win - 1);     // still bucket 0
    const c = windowKey("ip-h", "X", win, () => win);         // bucket 1
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^rl:ip-h:X:\d+$/);
  });

  console.log("\nrate-limit — cap enforcement (plain store):");
  await check("first CAP reservations pass, then it denies within the window", async () => {
    const store = plainStore(); const now = () => 5_000; const cap = 3;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await reserveRateSlot({ store, scope: "ip-h", id: "1.2.3.4", cap, windowMs: 3600e3, now }));
    assert.deepEqual(results, [true, true, true, false, false]);
  });

  await check("a new window resets the budget", async () => {
    const store = plainStore(); const cap = 2; const win = 3600e3;
    let t = 0; const now = () => t;
    assert.equal(await reserveRateSlot({ store, scope: "ip-h", id: "ip", cap, windowMs: win, now }), true);
    assert.equal(await reserveRateSlot({ store, scope: "ip-h", id: "ip", cap, windowMs: win, now }), true);
    assert.equal(await reserveRateSlot({ store, scope: "ip-h", id: "ip", cap, windowMs: win, now }), false); // capped
    t += win; // roll into the next window
    assert.equal(await reserveRateSlot({ store, scope: "ip-h", id: "ip", cap, windowMs: win, now }), true);  // fresh budget
  });

  await check("different keys have independent budgets", async () => {
    const store = plainStore(); const cap = 1; const now = () => 0;
    assert.equal(await reserveRateSlot({ store, scope: "ip-h", id: "A", cap, windowMs: 3600e3, now }), true);
    assert.equal(await reserveRateSlot({ store, scope: "ip-h", id: "A", cap, windowMs: 3600e3, now }), false);
    assert.equal(await reserveRateSlot({ store, scope: "ip-h", id: "B", cap, windowMs: 3600e3, now }), true); // B unaffected
    assert.equal(await reserveRateSlot({ store, scope: "ip-d", id: "A", cap, windowMs: 86400e3, now }), true); // different scope
  });

  console.log("\nrate-limit — atomic CAS path:");
  await check("cap is enforced over the CAS store too", async () => {
    const store = casStore(); const cap = 2; const now = () => 9_000;
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await reserveRateSlot({ store, scope: "ip-h", id: "z", cap, windowMs: 3600e3, now }));
    assert.deepEqual(r, [true, true, false, false]);
  });

  await check("reserveDailySlot still enforces its own cap (unchanged)", async () => {
    const store = casStore(); const now = () => 0;
    assert.equal(await reserveDailySlot({ store, key: "spend:d", cap: 1, now }), true);
    assert.equal(await reserveDailySlot({ store, key: "spend:d", cap: 1, now }), false);
  });

  console.log(`\nratelimit — ${passed} checks passed.\n`);
})();
