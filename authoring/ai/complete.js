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

export function createAnthropicComplete({ apiKey, fetch: injectedFetch, endpoint } = {}) {
  const key = apiKey || (typeof process !== "undefined" && process.env && process.env.ANTHROPIC_API_KEY);
  const doFetch = injectedFetch || (typeof fetch === "function" ? fetch : null);
  const url = endpoint || "https://api.anthropic.com/v1/messages";

  return async function complete({ model, system, user, schema, maxTokens = 4000 }) {
    if (!key) throw new Error("no-api-key");
    if (!doFetch) throw new Error("no-fetch");
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], // cache the stable rules
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema } },                     // guaranteed-shape JSON
      }),
    });
    if (!res || !res.ok) throw new Error("anthropic-http-" + (res && res.status));
    const data = await res.json();
    if (data && data.stop_reason === "refusal") throw new Error("refusal");
    const block = (data && data.content || []).find((b) => b.type === "text");
    if (!block || typeof block.text !== "string") throw new Error("no-text");
    return JSON.parse(block.text);
  };
}
