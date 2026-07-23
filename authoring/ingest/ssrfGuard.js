/**
 * authoring/ingest/ssrfGuard.js — SSRF protection for outbound fetches (ADR-0032).
 * ---------------------------------------------------------------------------
 * The generator fetches arbitrary user-supplied URLs server-side. Without a guard
 * that is a Server-Side Request Forgery hole: a URL (or a redirect hop) pointing at
 * a loopback / link-local / private address, a *.internal name, or a cloud metadata
 * endpoint (169.254.169.254) could make our function read internal services.
 *
 * Pure and dependency-free (no DNS) so it runs identically in Node and the browser
 * and is fully unit-tested. It blocks by literal-IP range + hostname pattern; the
 * fetcher additionally re-validates every REDIRECT hop (redirect:"manual"). DNS
 * rebinding (a public name that resolves to a private IP) is a residual risk noted
 * in the ADR — closed in 3ج-2 with a resolve-then-pin fetch.
 */

function ipv4ToInt(ip) {
  const p = String(ip).split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const b = Number(part);
    if (b < 0 || b > 255) return null;
    n = (n << 8) + b;
  }
  return n >>> 0;
}

/** IPv4 in a loopback / private / link-local / this-host / CGNAT range. */
export function isPrivateV4(ip) {
  const n = ipv4ToInt(ip);
  if (n == null) return false;
  const inRange = (base, bits) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
  };
  return inRange("0.0.0.0", 8)        // "this" network / 0.0.0.0
    || inRange("10.0.0.0", 8)         // RFC1918
    || inRange("100.64.0.0", 10)      // CGNAT
    || inRange("127.0.0.0", 8)        // loopback
    || inRange("169.254.0.0", 16)     // link-local (incl. 169.254.169.254 metadata)
    || inRange("172.16.0.0", 12)      // RFC1918
    || inRange("192.168.0.0", 16);    // RFC1918
}

/** IPv6 loopback / ULA (fc00::/7 incl. fd00::/8) / link-local / mapped-private. */
export function isPrivateV6(ip) {
  let s = String(ip).toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::1" || s === "::") return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  const head = s.split(":")[0];
  if (/^f[cd][0-9a-f]*$/.test(head)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]*$/.test(head)) return true; // fe80::/10 link-local
  return false;
}

/** Classify a hostname: { localhost?, blocked? }. Blocked = never allowed. */
export function classifyHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host) return { blocked: true };
  if (host === "localhost" || host.endsWith(".localhost")) return { localhost: true };
  if (host === "metadata" || host.startsWith("metadata.")) return { blocked: true };
  if (host.endsWith(".internal")) return { blocked: true };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateV4(host) ? { blocked: true } : {};
  if (host.includes(":")) return isPrivateV6(host) ? { blocked: true } : {};
  return {};
}

/**
 * Is this URL safe to fetch? http/https only, host not private/internal/metadata.
 * @param {string} urlStr
 * @param {{allowLocalhost?:boolean}} [opts]
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
export function assertUrlAllowed(urlStr, opts = {}) {
  let u;
  try { u = new URL(urlStr); } catch { return { ok: false, reason: "bad-url" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "bad-scheme" };
  const c = classifyHost(u.hostname);
  if (c.localhost) return opts.allowLocalhost ? { ok: true } : { ok: false, reason: "blocked-localhost" };
  if (c.blocked) return { ok: false, reason: "blocked-private-host" };
  return { ok: true };
}
