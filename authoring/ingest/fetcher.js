/**
 * authoring/ingest/fetcher.js — Polite, identified, rate-limited HTTP GET.
 * ---------------------------------------------------------------------------
 * Stage 1 compliance core (ADR-0013). Every network read in ingestion goes
 * through here so the tool "does not interfere with the regular operation of a
 * site" (RFC 9309): it identifies itself, spaces requests out, caps total pages,
 * times out, and fails honestly (never throws, never fakes a response).
 *
 * `fetch`, `sleep`, and `now` are injected → `npm test` runs fully offline and
 * deterministically against fixtures (no real network, no real waiting).
 */

export const DEFAULT_USER_AGENT = "FullTimeDigiBot/1.0 (+https://fulltimedigi.com/bot)";

/**
 * @param {Object} [opts]
 * @param {Function} [opts.fetch]   - fetch impl (default globalThis.fetch)
 * @param {Function} [opts.sleep]   - (ms)=>Promise (default real timer)
 * @param {Function} [opts.now]     - ()=>ms (default Date.now)
 * @param {string}   [opts.userAgent]
 * @param {number}   [opts.minDelayMs] - politeness gap between requests (default 1000)
 * @param {number}   [opts.timeoutMs]  - per-request timeout (default 15000)
 * @param {number}   [opts.maxPages]   - hard cap on total requests (default 200)
 */
export function createFetcher(opts = {}) {
  const _fetch = opts.fetch || (typeof fetch === "function" ? fetch : null);
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now || Date.now;
  const userAgent = opts.userAgent || DEFAULT_USER_AGENT;
  let minDelayMs = typeof opts.minDelayMs === "number" ? opts.minDelayMs : 1000;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 15000;
  const maxPages = typeof opts.maxPages === "number" ? opts.maxPages : 200;

  let count = 0;
  let lastAt = -Infinity;

  /** Raise/lower the politeness gap (e.g. to honor robots.txt crawl-delay). */
  function setMinDelay(ms) { if (typeof ms === "number" && ms >= 0) minDelayMs = ms; }

  /**
   * GET a URL. Never throws.
   * @returns {Promise<{ok:boolean, status?:number, url:string, finalUrl?:string,
   *   contentType?:string, text?:string, reason?:string}>}
   */
  async function get(url) {
    if (count >= maxPages) return { ok: false, url, reason: "page-cap-reached" };
    if (!_fetch) return { ok: false, url, reason: "no-fetch" };

    const wait = minDelayMs - (now() - lastAt);
    if (wait > 0) await sleep(wait);
    lastAt = now();
    count++;

    let controller = null, timer = null;
    if (typeof AbortController === "function") {
      controller = new AbortController();
      timer = setTimeout(() => { try { controller.abort(); } catch { /* noop */ } }, timeoutMs);
    }
    try {
      const res = await _fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": userAgent, "Accept": "*/*" },
        signal: controller ? controller.signal : undefined,
      });
      const text = typeof res.text === "function" ? await res.text() : "";
      const ct = res.headers && typeof res.headers.get === "function" ? res.headers.get("content-type") || "" : "";
      if (!res.ok) return { ok: false, url, finalUrl: res.url || url, status: res.status, contentType: ct, text, reason: "http-" + res.status };
      return { ok: true, url, finalUrl: res.url || url, status: res.status, contentType: ct, text };
    } catch (err) {
      const aborted = err && (err.name === "AbortError");
      return { ok: false, url, reason: aborted ? "timeout" : "network", error: String(err && err.message || err) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    get,
    setMinDelay,
    userAgent,
    stats: () => ({ requests: count, maxPages, minDelayMs }),
  };
}
