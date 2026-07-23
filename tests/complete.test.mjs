/**
 * tests/complete.test.mjs — Anthropic wrapper honesty (ADR-0028/0030).
 * `fetch` is INJECTED, so no network and no key needed. Proves: a max_tokens stop is
 * reported as an HONEST "truncated-max-tokens" (not a confusing JSON parse error), a
 * refusal throws, non-200 throws, the request carries our max_tokens, and a good
 * response parses to the design object.
 */

import assert from "node:assert/strict";
import { createAnthropicComplete } from "../authoring/ai/complete.js";

/** A fake fetch that returns `resp` and captures the request body. */
function fakeFetch(resp, sink = {}) {
  return async (_url, init) => {
    sink.body = JSON.parse(init.body);
    return { ok: resp.ok !== false, status: resp.status || 200, async json() { return resp.json; } };
  };
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

await (async () => {
  console.log("\ncomplete() honesty:");

  await check("a good response parses to the design object", async () => {
    const complete = createAnthropicComplete({ apiKey: "k", fetch: fakeFetch({ json: { stop_reason: "end_turn", content: [{ type: "text", text: '{"axes":[]}' }] } }) });
    const out = await complete({ model: "m", system: "s", user: "u", schema: {} });
    assert.deepEqual(out, { axes: [] });
  });

  await check("max_tokens stop → HONEST 'truncated-max-tokens' (not a parse error)", async () => {
    // The text is deliberately truncated/invalid JSON — we must NOT try to parse it.
    const complete = createAnthropicComplete({ apiKey: "k", fetch: fakeFetch({ json: { stop_reason: "max_tokens", content: [{ type: "text", text: '{"axes":[{"id":"a","productValues":[{"i":0,"value":"me' }] } }) });
    await assert.rejects(() => complete({ model: "m", system: "s", user: "u", schema: {} }), /truncated-max-tokens/);
  });

  await check("refusal → throws", async () => {
    const complete = createAnthropicComplete({ apiKey: "k", fetch: fakeFetch({ json: { stop_reason: "refusal", content: [] } }) });
    await assert.rejects(() => complete({ model: "m", system: "s", user: "u", schema: {} }), /refusal/);
  });

  await check("non-200 → throws with status", async () => {
    const complete = createAnthropicComplete({ apiKey: "k", fetch: fakeFetch({ ok: false, status: 529, json: {} }) });
    await assert.rejects(() => complete({ model: "m", system: "s", user: "u", schema: {} }), /anthropic-http-529/);
  });

  await check("passes our max_tokens through to the API request", async () => {
    const sink = {};
    const complete = createAnthropicComplete({ apiKey: "k", fetch: fakeFetch({ json: { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] } }, sink) });
    await complete({ model: "m", system: "s", user: "u", schema: {}, maxTokens: 24000 });
    assert.equal(sink.body.max_tokens, 24000);
  });

  await check("default max_tokens is generous (>= 16000, not the old 4000)", async () => {
    const sink = {};
    const complete = createAnthropicComplete({ apiKey: "k", fetch: fakeFetch({ json: { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] } }, sink) });
    await complete({ model: "m", system: "s", user: "u", schema: {} });
    assert.ok(sink.body.max_tokens >= 16000, "default cap is " + sink.body.max_tokens);
  });

  if (process.exitCode === 1) console.error("\nFAIL — complete tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} complete assertions passed.\n`);
})();
