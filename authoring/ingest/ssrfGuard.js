/**
 * authoring/ingest/ssrfGuard.js — SSRF protection for outbound fetches (ADR-0032).
 * ---------------------------------------------------------------------------
 * The generator fetches arbitrary user-supplied URLs server-side. Without a guard
 * that is a Server-Side Request Forgery hole: a URL (or a redirect hop) pointing at
 * a loopback / link-local / private address, a *.internal name, or a cloud metadata
 * endpoint (169.254.169.254) could make our function read internal services.
 *
 * Pure and dependency-free (no DNS) so it runs identically in Node and the browser and is fully
 * unit-tested. It blocks by literal-IP range (in EVERY IPv4 encoding — dotted-decimal, hex, octal,
 * short-form, and a bare 32-bit integer — plus IPv6 literal/mapped) and by hostname pattern.
 *
 * This module does NOT resolve DNS (so it stays browser-safe). DNS rebinding — a PUBLIC name that
 * resolves to a PRIVATE IP — is handled at fetch time in fetcher.js, which resolves the host and
 * refuses the fetch if ANY resolved A/AAAA record is private, and re-validates every redirect hop.
 * (A residual sub-request TOCTOU between resolve and connect remains — full socket-pinning to the
 * validated IP is a later hardening; the resolve-time check closes the practical rebinding vector of
 * a hostile domain that simply points its DNS at a private/metadata address.)
 */

/** Strict dotted-decimal a.b.c.d → uint32, or null. (Kept for callers that want strict parsing.) */
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

/** Parse ONE inet_aton part in decimal / 0x-hex / 0-octal. Returns a non-negative integer or null. */
function parsePart(str) {
  if (/^0x[0-9a-f]+$/i.test(str)) return parseInt(str, 16);
  if (/^0[0-7]+$/.test(str)) return parseInt(str, 8);
  if (/^0$/.test(str)) return 0;
  if (/^[1-9][0-9]*$/.test(str)) return parseInt(str, 10);
  return null; // anything else (leading-zero decimal, letters, empty) is rejected
}

/**
 * Parse ANY IPv4 encoding a caller might use to smuggle a private address past a naive
 * dotted-quad check (ADR-0040): decimal (2130706433), hex (0x7f000001, 0x7f.0.0.1),
 * octal (0177.0.0.1), and short forms (127.1, 127.0.1) — the classic inet_aton rules:
 *   • 1 part  → the whole 32-bit address.
 *   • 2 parts → a.(24 bits).
 *   • 3 parts → a.b.(16 bits).
 *   • 4 parts → a.b.c.d.
 * Returns a uint32 or null (null = not a numeric IPv4 literal → treat as a hostname).
 */
export function parseIPv4Any(host) {
  const h = String(host || "").trim();
  if (!/^[0-9a-fx.]+$/i.test(h) || h === "" || h.endsWith(".")) return null;
  const parts = h.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = parts.map(parsePart);
  if (nums.some((n) => n == null || n < 0)) return null;
  let n;
  if (parts.length === 1) { n = nums[0]; }
  else {
    // the LAST part fills the remaining bytes; every earlier part is one byte (0..255).
    for (let i = 0; i < nums.length - 1; i++) if (nums[i] > 0xff) return null;
    const last = nums[nums.length - 1];
    const remainingBytes = 4 - (nums.length - 1);
    if (last >= Math.pow(256, remainingBytes)) return null;
    n = 0;
    for (let i = 0; i < nums.length - 1; i++) n = n * 256 + nums[i];
    n = n * Math.pow(256, remainingBytes) + last;
  }
  if (n < 0 || n > 0xffffffff) return null;
  return n >>> 0;
}

/** Is a uint32 IPv4 address in a loopback / private / link-local / this-host / CGNAT range? */
function isPrivateV4Int(n) {
  if (n == null) return false;
  const asInt = (base) => { const p = base.split(".").map(Number); return ((p[0] << 24) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0; };
  const inRange = (base, bits) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((asInt(base) & mask) >>> 0);
  };
  return inRange("0.0.0.0", 8) || inRange("10.0.0.0", 8) || inRange("100.64.0.0", 10)
    || inRange("127.0.0.0", 8) || inRange("169.254.0.0", 16) || inRange("172.16.0.0", 12)
    || inRange("192.168.0.0", 16);
}

/** IPv4 (in ANY encoding) in a loopback / private / link-local / this-host / CGNAT range. */
export function isPrivateV4(ip) {
  // strict dotted-quad OR any inet_aton encoding (decimal/hex/octal/short-form).
  const n = ipv4ToInt(ip);
  if (n != null) return isPrivateV4Int(n);
  return isPrivateV4Int(parseIPv4Any(ip));
}

/** Expand an IPv6 string to its 8 hextets (numbers), or null if unparseable. Handles "::" once. */
function expandV6(str) {
  let s = String(str).toLowerCase().replace(/^\[|\]$/g, "");
  if (!s || s.indexOf(":") === -1) return null;
  // a trailing dotted-quad (mapped) → convert to two hextets
  const m = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m) {
    const v4 = ipv4ToInt(m[2]);
    if (v4 == null) return null;
    s = m[1] + ((v4 >>> 16) & 0xffff).toString(16) + ":" + (v4 & 0xffff).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part) => part === "" ? [] : part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some((n) => Number.isNaN(n))) return null;
  let hextets;
  if (halves.length === 2) {
    const zeros = 8 - head.length - tail.length;
    if (zeros < 0) return null;
    hextets = [...head, ...Array(zeros).fill(0), ...tail];
  } else hextets = head;
  return hextets.length === 8 ? hextets : null;
}

/** IPv6 loopback / ULA (fc00::/7 incl. fd00::/8) / link-local / IPv4-mapped-private (any form). */
export function isPrivateV6(ip) {
  const s = String(ip).toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::1" || s === "::") return true;
  const h = expandV6(s);
  if (!h) {
    // fall back to a cheap prefix check if expansion failed
    const head = s.split(":")[0];
    return /^f[cd][0-9a-f]*$/.test(head) || /^fe[89ab][0-9a-f]*$/.test(head);
  }
  if (h.every((x, i) => (i < 7 ? x === 0 : x === 1))) return true; // ::1 loopback
  // IPv4-mapped ::ffff:a.b.c.d (in ANY textual form, incl. Node's normalized ::ffff:hhhh:hhhh)
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return isPrivateV4Int((((h[6] << 16) >>> 0) + h[7]) >>> 0);
  }
  const first = h[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** Classify a hostname: { localhost?, blocked? }. Blocked = never allowed. Numeric hosts are decoded
 *  in EVERY IPv4 encoding (decimal/hex/octal/short-form) and as IPv6 literals before the range check,
 *  so 2130706433 / 0x7f000001 / 0177.0.0.1 / 127.1 / [::1] can't slip past a dotted-quad regex. */
export function classifyHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return { blocked: true };
  if (host === "localhost" || host.endsWith(".localhost")) return { localhost: true };
  if (host === "metadata" || host.startsWith("metadata.")) return { blocked: true };
  if (host.endsWith(".internal")) return { blocked: true };
  if (host.includes(":")) return isPrivateV6(host) ? { blocked: true } : {}; // IPv6 literal
  // Any numeric IPv4 encoding → decode to an int and range-check. A bare integer / hex / octal host
  // that decodes to a private address is blocked; one that decodes to a public address is allowed.
  const v4 = parseIPv4Any(host);
  if (v4 != null) return isPrivateV4Int(v4) ? { blocked: true } : {};
  return {}; // a real hostname (DNS rebinding is handled at fetch time in fetcher.js)
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
