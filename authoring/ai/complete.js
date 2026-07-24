/**
 * authoring/ai/complete.js — runtime model call for grounded enrichment (ADR-0028).
 * ---------------------------------------------------------------------------
 * The single thin place that touches the network. Raw HTTPS to the Messages API
 * (Node 18+ global fetch) — no SDK dependency, keeping this zero-dependency repo
 * dependency-free and `npm test` install-free (the enrichment LOGIC is fully
 * tested with an injected `complete`; this wrapper is used only at runtime inside
 * the Netlify function, where the key is a server secret).
 *
 * Prompt caching on the stable system prompt; structured outputs (json_schema)
 * for a guaranteed-shape design; honest failure on any non-200 / refusal / bad
 * JSON — the caller then falls back to the deterministic author.
 */

export function createAnthropicComplete({ apiKey, fetch: injectedFetch, endpoint, timeoutMs } = {}) {
  const key = apiKey || (typeof process !== "undefined" && process.env && process.env.ANTHROPIC_API_KEY);
  const doFetch = injectedFetch || (typeof fetch === "function" ? fetch : null);
  const url = endpoint || "https://api.anthropic.com/v1/messages";
  const callTimeoutMs = typeof timeoutMs === "number" ? timeoutMs : 240000; // 4 min hard cap per call (ADR-0032)

  // 16000 default: a rich design maps every product across every axis, and Arabic is
  // token-dense — 4000 truncated real 51-product catalogs mid-JSON (ADR-0030). Billing is
  // on ACTUAL output, so a high cap costs nothing extra; the background job has 15 min.
  return async function complete({ model, system, user, schema, maxTokens = 16000 }) {
    if (!key) throw new Error("no-api-key");
    if (!doFetch) throw new Error("no-fetch");
    // Never hang forever on a stuck connection — abort after callTimeoutMs (ADR-0032).
    let controller = null, timer = null;
    if (typeof AbortController === "function") {
      controller = new AbortController();
      timer = setTimeout(() => { try { controller.abort(); } catch { /* noop */ } }, callTimeoutMs);
    }
    let res;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], // cache the stable rules
          messages: [{ role: "user", content: user }],
          output_config: { format: { type: "json_schema", schema } },                     // guaranteed-shape JSON
        }),
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("timeout");
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res || !res.ok) throw new Error("anthropic-http-" + (res && res.status));
    const data = await res.json();
    if (data && data.stop_reason === "refusal") throw new Error("refusal");
    // Honest truncation signal: a max_tokens stop means the JSON is incomplete — say so
    // clearly instead of letting JSON.parse fail with a confusing "Unterminated string".
    if (data && data.stop_reason === "max_tokens") throw new Error("truncated-max-tokens");
    const block = (data && data.content || []).find((b) => b.type === "text");
    if (!block || typeof block.text !== "string") throw new Error("no-text");
    return JSON.parse(block.text);
  };
}
