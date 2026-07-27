/**
 * tests/lib/mintedFunnel.mjs — a funnel config MINTED from the REAL authoring pipeline (ADR-0042).
 * oudfactory (recorded real catalog, string prices) → ingest → author → a DECISIVE commerce config
 * carrying REAL kernel proofs. Render tests that need a certified product use THIS — never a config
 * with hand-written proof fields (that would reintroduce the exact "fake proof passes the mechanism"
 * disease the certificate exists to prevent).
 */
import fs from "node:fs";
import { generateFunnelFromUrl } from "../../authoring/index.js";

const FIXTURE = fs.readFileSync(new URL("../fixtures/oudfactory.products.json", import.meta.url), "utf8");
const fetcher = {
  userAgent: "mintedFunnel", setMinDelay() {}, stats: () => ({ requests: 0, maxPages: 200, minDelayMs: 0 }),
  async get(u) {
    if (u.endsWith("/robots.txt")) return { ok: false, url: u, reason: "http-404" };
    if (u.includes("/products.json")) { const p1 = !/[?&]page=([2-9]|\d\d+)/.test(u); return { ok: true, url: u, finalUrl: u, status: 200, text: p1 ? FIXTURE : '{"products":[]}' }; }
    return { ok: true, url: u, finalUrl: u, status: 200, text: "<html></html>" };
  },
};

/** @returns {Promise<{config:Object, script:Object}>} a certified decisive commerce funnel + a full
 *  answer script (first option of each question — every oudfactory full path fires a COMMERCE rule). */
export async function mintedFunnel() {
  const res = await generateFunnelFromUrl("https://www.oudfactory.com", { authorized: true, fetcher, currency: "AED" });
  if (!res.ok) throw new Error("mintedFunnel: authoring failed — " + res.reason);
  const script = {};
  for (const q of res.config.questions) script[q.id] = (q.options[0] || {}).id;
  return { config: res.config, script };
}
