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

import { assertUrlAllowed } from "./ssrfGuard.js";

export const DEFAULT_USER_AGENT = "FullTimeDigiBot/1.0 (+https://fulltimedigi.com/bot)";

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

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
  const maxRetries = typeof opts.maxRetries === "number" ? opts.maxRetries : 3;
  const retryBaseMs = typeof opts.retryBaseMs === "number" ? opts.retryBaseMs : 3000;
  const maxBackoffMs = 30000;
  // SSRF: never fetch loopback/private/internal/metadata (ADR-0032). Localhost is
  // blocked server-side by default; a dev caller can opt in for a local sample.
  const allowLocalhost = opts.allowLocalhost === true;
  const maxRedirects = typeof opts.maxRedirects === "number" ? opts.maxRedirects : 5;

  let count = 0;
  let lastAt = -Infinity;

  /** Raise/lower the politeness gap (e.g. to honor robots.txt crawl-delay). */
  function setMinDelay(ms) { if (typeof ms === "number" && ms >= 0) minDelayMs = ms; }

  /** Backoff for a 429/503: honor a numeric Retry-After, else exponential. */
  function _retryDelay(res, attempt) {
    const ra = res && res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : null;
    const s = ra != null ? parseInt(ra, 10) : NaN;
    const ms = !isNaN(s) ? s * 1000 : retryBaseMs * Math.pow(2, attempt);
    return Math.min(ms, maxBackoffMs);
  }

  /**
   * GET a URL. Never throws. Retries 429/503 (Retry-After / exponential backoff)
   * and transient network errors up to maxRetries — one rate-limit reply must not
   * abandon the whole ingest.
   * @returns {Promise<{ok:boolean, status?:number, url:string, finalUrl?:string,
   *   contentType?:string, text?:string, reason?:string}>}
   */
  /** One request to a single URL (retries 429/503 + timeout). redirect:"manual" so we
   *  re-validate every hop ourselves. Returns { redirectTo } or { result }. */
  async function _fetchOnce(u) {
    for (let attempt = 0; ; attempt++) {
      lastAt = now();
      let controller = null, timer = null;
      if (typeof AbortController === "function") {
        controller = new AbortController();
        timer = setTimeout(() => { try { controller.abort(); } catch { /* noop */ } }, timeoutMs);
      }
      try {
        const res = await _fetch(u, {
          method: "GET",
          redirect: "manual",
          headers: { "User-Agent": userAgent, "Accept": "*/*" },
          signal: controller ? controller.signal : undefined,
        });
        if (REDIRECT_STATUS.has(res.status)) {
          const loc = res.headers && typeof res.headers.get === "function" ? res.headers.get("location") : null;
          if (loc) return { redirectTo: loc };
          // a redirect with no Location → treat as a normal (final) response below
        }
        if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
          await sleep(_retryDelay(res, attempt));
          continue; // back off and retry the same URL
        }
        const text = typeof res.text === "function" ? await res.text() : "";
        const ct = res.headers && typeof res.headers.get === "function" ? res.headers.get("content-type") || "" : "";
        if (!res.ok) return { result: { ok: false, url: u, finalUrl: res.url || u, status: res.status, contentType: ct, text, reason: "http-" + res.status } };
        return { result: { ok: true, url: u, finalUrl: res.url || u, status: res.status, contentType: ct, text } };
      } catch (err) {
        const aborted = err && (err.name === "AbortError");
        if (!aborted && attempt < maxRetries) { await sleep(Math.min(retryBaseMs * Math.pow(2, attempt), maxBackoffMs)); continue; }
        return { result: { ok: false, url: u, reason: aborted ? "timeout" : "network", error: String(err && err.message || err) } };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }

  async function get(url) {
    if (count >= maxPages) return { ok: false, url, reason: "page-cap-reached" };
    if (!_fetch) return { ok: false, url, reason: "no-fetch" };
    // SSRF: refuse loopback / private / link-local / *.internal / metadata BEFORE the
    // first byte leaves (ADR-0032).
    const guard = assertUrlAllowed(url, { allowLocalhost });
    if (!guard.ok) return { ok: false, url, reason: "blocked-url:" + guard.reason };

    const wait = minDelayMs - (now() - lastAt);
    if (wait > 0) await sleep(wait);
    count++;

    let currentUrl = url;
    for (let hop = 0; ; hop++) {
      const out = await _fetchOnce(currentUrl);
      if (!out.redirectTo) return out.result;
      if (hop >= maxRedirects) return { ok: false, url, finalUrl: currentUrl, reason: "too-many-redirects" };
      let next;
      try { next = new URL(out.redirectTo, currentUrl).href; } catch { return { ok: false, url, reason: "bad-redirect-location" }; }
      // Re-validate EVERY hop — a public URL can redirect to an internal one (ADR-0032).
      const g = assertUrlAllowed(next, { allowLocalhost });
      if (!g.ok) return { ok: false, url, finalUrl: currentUrl, reason: "blocked-redirect:" + g.reason };
      currentUrl = next;
    }
  }

  return {
    get,
    setMinDelay,
    userAgent,
    stats: () => ({ requests: count, maxPages, minDelayMs }),
  };
}
