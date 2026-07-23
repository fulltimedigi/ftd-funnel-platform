/**
 * platform/jobs/blobStore.js — Netlify Blobs adapter for the job core (ADR-0029/0030).
 * ---------------------------------------------------------------------------
 * A minimal { get, set, healthy } store backed by Netlify Blobs. `@netlify/blobs`
 * is DYNAMICALLY imported so `npm test` (which injects a fake store) never loads it —
 * keeping the engine + tests + CI dependency-free.
 *
 * This deploy's runtime does NOT inject Blobs auto-context (ADR-0030): no
 * NETLIFY_BLOBS_CONTEXT, no `globalThis.Netlify`. So we PREFER manual config
 * (siteID + token) when a token is present, and fall back to auto-context
 * `getStore(name)` for properly-provisioned sites. `_getStore` is injectable so the
 * selection logic is unit-tested without the real dependency or the network.
 */

/** Choose manual config (siteID+token) when available, else auto-context. */
export function pickStoreArgs(name, env = (typeof process !== "undefined" ? process.env : {}) || {}) {
  const token = env.NETLIFY_BLOBS_TOKEN || env.NETLIFY_API_TOKEN;
  const siteID = env.SITE_ID || env.NETLIFY_SITE_ID;
  if (token && siteID) return { name, siteID, token };
  return name; // auto-context (getStore(name))
}

export async function createBlobStore(name = "ftd-funnels", deps = {}) {
  const getStore = deps._getStore || (await import("@netlify/blobs")).getStore;
  const env = deps.env || (typeof process !== "undefined" ? process.env : {}) || {};
  const store = getStore(pickStoreArgs(name, env));
  return {
    async get(key) {
      try { return await store.get(key, { type: "json" }); }
      catch { return null; }
    },
    async set(key, value) {
      await store.setJSON(key, value);
    },
    /** True only if a tiny write+read round-trips — proves storage is configured. */
    async healthy() {
      try {
        const k = "__health__";
        await store.setJSON(k, { t: 1 });
        const v = await store.get(k, { type: "json" });
        return !!(v && v.t === 1);
      } catch { return false; }
    },
  };
}
