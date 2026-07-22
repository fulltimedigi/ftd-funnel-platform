/**
 * tests/leadqueue.test.mjs — Lead outbox tests (ADR-0006).
 *
 * Verifies the delivery-resilience layer: a lead is never silently lost, and a
 * lead is removed from the outbox ONLY when the transport confirms it (res.ok).
 * Covers enqueue/dedupe, drain (all-ok / all-fail / partial / throwing), the
 * resilient-sink submit loop, the offline→online recovery loop, and Node-safety.
 *
 * Node + a minimal localStorage shim. No browser, no deps. `window` is left
 * undefined on purpose. Exits non-zero on failure.
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

const {
  enqueueLead, removeLead, pendingLeads, drainOutbox, createResilientSink,
} = await import("../engine/leadQueue.js");

const FID = "qtest";
let n = 0;
const lead = (email) => ({ funnelId: FID, email, dedupeKey: email, timestamp: `t${n++}` });

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

/* -------------------------------------------------------------------- tests --- */
await (async () => {
  console.log("\nEnqueue:");
  await check("enqueued leads are readable; identical submit is not duplicated", () => {
    installStore();
    const a = lead("a@x.com");
    enqueueLead(a, FID);
    enqueueLead(a, FID); // same dedupeKey+timestamp → no duplicate
    enqueueLead(lead("b@x.com"), FID);
    const p = pendingLeads(FID);
    assert.equal(p.length, 2);
    assert.deepEqual(p.map((e) => e.email), ["a@x.com", "b@x.com"]);
  });

  console.log("\nDrain — honest send/keep semantics:");
  await check("all-ok transport delivers every lead and empties the outbox", async () => {
    installStore();
    enqueueLead(lead("a@x.com"), FID);
    enqueueLead(lead("b@x.com"), FID);
    const seen = [];
    const res = await drainOutbox(async (p) => { seen.push(p.email); return { ok: true }; }, FID);
    assert.deepEqual(res, { sent: 2, kept: 0, total: 2 });
    assert.equal(seen.length, 2);
    assert.equal(pendingLeads(FID).length, 0);
  });

  await check("failing transport KEEPS every lead — nothing is dropped", async () => {
    installStore();
    enqueueLead(lead("a@x.com"), FID);
    enqueueLead(lead("b@x.com"), FID);
    const res = await drainOutbox(async () => ({ ok: false, reason: "network" }), FID);
    assert.deepEqual(res, { sent: 0, kept: 2, total: 2 });
    assert.equal(pendingLeads(FID).length, 2); // still waiting
  });

  await check("partial: keeps only the leads the transport rejected", async () => {
    installStore();
    enqueueLead(lead("good@x.com"), FID);
    enqueueLead(lead("bad@x.com"), FID);
    enqueueLead(lead("good2@x.com"), FID);
    const res = await drainOutbox(async (p) => ({ ok: !p.email.startsWith("bad") }), FID);
    assert.deepEqual(res, { sent: 2, kept: 1, total: 3 });
    assert.deepEqual(pendingLeads(FID).map((e) => e.email), ["bad@x.com"]);
  });

  await check("a transport that THROWS is treated as not-sent (kept), never crashes", async () => {
    installStore();
    enqueueLead(lead("a@x.com"), FID);
    const res = await drainOutbox(async () => { throw new Error("boom"); }, FID);
    assert.deepEqual(res, { sent: 0, kept: 1, total: 1 });
    assert.equal(pendingLeads(FID).length, 1);
  });

  console.log("\nResilient sink — submit loop:");
  await check("successful submit removes the lead from the outbox (net-empty)", async () => {
    installStore();
    const sink = createResilientSink(async () => ({ ok: true }), FID);
    const res = await sink.submit(lead("a@x.com"));
    assert.equal(res.ok, true);
    assert.equal(sink.pending().length, 0);
  });

  await check("failed submit keeps the lead queued for a later drain (honest failure)", async () => {
    installStore();
    const sink = createResilientSink(async () => ({ ok: false, reason: "network" }), FID);
    const res = await sink.submit(lead("a@x.com"));
    assert.equal(res.ok, false);
    assert.equal(sink.pending().length, 1); // not lost
  });

  await check("a throwing transport → {ok:false} and the lead is kept", async () => {
    installStore();
    const sink = createResilientSink(async () => { throw new Error("offline"); }, FID);
    const res = await sink.submit(lead("a@x.com"));
    assert.equal(res.ok, false);
    assert.equal(sink.pending().length, 1);
  });

  console.log("\nEnd-to-end: offline → POST → honest failure → later delivery:");
  await check("a lead stranded offline is delivered on the next drain", async () => {
    installStore();
    let online = false;
    const transport = async () => (online ? { ok: true } : { ok: false, reason: "network" });
    const sink = createResilientSink(transport, FID);

    // 1) Submit while offline — honest failure, lead retained.
    const r1 = await sink.submit(lead("late@x.com"));
    assert.equal(r1.ok, false);
    assert.equal(sink.pending().length, 1);

    // 2) Network returns; a later drain delivers it and clears the outbox.
    online = true;
    const summary = await sink.drain();
    assert.deepEqual(summary, { sent: 1, kept: 0, total: 1 });
    assert.equal(sink.pending().length, 0);
  });

  console.log("\nNode-safety:");
  await check("createResilientSink does not throw with no `window`", () => {
    assert.equal(typeof globalThis.window, "undefined");
    createResilientSink(async () => ({ ok: true }), FID); // no online-listener install, no throw
    assert.ok(true);
  });

  await check("a throwing localStorage never crashes enqueue or drain", async () => {
    const saved = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    enqueueLead(lead("a@x.com"), FID);              // must not throw
    const res = await drainOutbox(async () => ({ ok: true }), FID);
    assert.deepEqual(res, { sent: 0, kept: 0, total: 0 }); // read degraded to []
    globalThis.localStorage = saved;
  });

  await check("ring buffer keeps only the newest 50 pending leads", () => {
    installStore();
    for (let i = 0; i < 55; i++) enqueueLead(lead(`u${i}@x.com`), FID);
    const p = pendingLeads(FID);
    assert.equal(p.length, 50);
    assert.equal(p[0].email, "u5@x.com");   // oldest 5 discarded
    assert.equal(p[49].email, "u54@x.com");
  });

  if (process.exitCode === 1) console.error("\nFAIL — lead-outbox tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} lead-outbox assertions passed.\n`);
})();
