/**
 * platform/jobs/blobStore.js — Netlify Blobs adapter for the job core (ADR-0029).
 * ---------------------------------------------------------------------------
 * A minimal { get, set } store backed by Netlify Blobs. `@netlify/blobs` is
 * DYNAMICALLY imported so `npm test` (which injects a fake store) never loads it —
 * keeping the engine + tests + CI dependency-free. Used only inside the Netlify
 * functions, where Blobs is provided by the runtime.
 */

export async function createBlobStore(name = "ftd-funnels") {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore(name);
  return {
    async get(key) {
      try { return await store.get(key, { type: "json" }); }
      catch { return null; }
    },
    async set(key, value) {
      await store.setJSON(key, value);
    },
  };
}
