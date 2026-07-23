/**
 * netlify/functions/blobprobe.mjs — TEMPORARY diagnostic (ADR-0029 debug).
 * Reports ONLY the presence (boolean) of Blobs-relevant env vars and whether
 * getStore() works, plus the error name if not. No secret values are ever
 * returned. Deleted once the Blobs wiring is fixed.
 */

const has = (k) => !!process.env[k];

export const handler = async () => {
  const env = {
    NETLIFY_BLOBS_CONTEXT: has("NETLIFY_BLOBS_CONTEXT"),
    NETLIFY_SITE_ID: has("NETLIFY_SITE_ID"),
    SITE_ID: has("SITE_ID"),
    NETLIFY_API_TOKEN: has("NETLIFY_API_TOKEN"),
    NETLIFY_TOKEN: has("NETLIFY_TOKEN"),
    URL: has("URL"),
    DEPLOY_ID: has("DEPLOY_ID"),
    DEPLOY_PRIME_URL: has("DEPLOY_PRIME_URL"),
    CONTEXT: process.env.CONTEXT || null,
    ANTHROPIC_API_KEY: has("ANTHROPIC_API_KEY"),
    node: process.version,
  };

  const runtime = {
    hasNetlifyGlobal: typeof globalThis.Netlify !== "undefined",
    netlifyEnvKeys: (typeof globalThis.Netlify !== "undefined" && globalThis.Netlify.env && typeof globalThis.Netlify.env.has === "function")
      ? { blobsCtx: globalThis.Netlify.env.has("NETLIFY_BLOBS_CONTEXT"), siteId: globalThis.Netlify.env.has("SITE_ID") }
      : null,
  };

  let getStoreAuto = null, getStoreErr = null;
  try {
    const { getStore } = await import("@netlify/blobs");
    const s = getStore("ftd-probe");
    await s.set("ping", "1");
    getStoreAuto = (await s.get("ping")) === "1";
  } catch (e) {
    getStoreErr = { name: (e && e.name) || "Error", message: String((e && e.message) || e).slice(0, 200) };
  }

  // Manual config with the SITE_ID we DO have + any token env — proves whether a
  // token is the only missing piece.
  let getStoreManual = null, getStoreManualErr = null;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_TOKEN;
  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  try {
    if (token && siteID) {
      const { getStore } = await import("@netlify/blobs");
      const s = getStore({ name: "ftd-probe", siteID, token });
      await s.set("ping", "1");
      getStoreManual = (await s.get("ping")) === "1";
    } else {
      getStoreManualErr = { skipped: true, haveSiteID: !!siteID, haveToken: !!token };
    }
  } catch (e) {
    getStoreManualErr = { name: (e && e.name) || "Error", message: String((e && e.message) || e).slice(0, 200) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ env, runtime, getStoreAuto, getStoreErr, getStoreManual, getStoreManualErr }, null, 2),
  };
};

export default handler;
