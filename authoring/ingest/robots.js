/**
 * authoring/ingest/robots.js — Robots Exclusion Protocol (RFC 9309) parser + matcher.
 * ---------------------------------------------------------------------------
 * Stage 1 compliance core (ADR-0013). Before any product page is fetched, the
 * ingester consults the site's robots.txt and obeys it for our user-agent.
 *
 * Implements the RFC 9309 essentials:
 *   - group selection by the most specific matching user-agent (else `*`);
 *   - Allow/Disallow path matching with `*` (any run) and `$` (end-anchor);
 *   - longest-match wins, ties resolve to Allow; empty Disallow = allow all;
 *   - `Sitemap:` (global) and de-facto `Crawl-delay:` (per group) are surfaced.
 *
 * Pure + Node-safe. No network here — the caller fetches robots.txt and passes
 * the text in. A missing/empty robots.txt means "allow all" (RFC 9309 §2.3.1.3).
 */

/** Escape a literal char for use inside a RegExp. */
function _escape(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile a robots path pattern (`*` and `$`) to an anchored RegExp. */
function _patternToRegExp(pattern) {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") re += ".*";
    else if (ch === "$" && i === pattern.length - 1) re += "$";
    else re += _escape(ch);
  }
  return new RegExp(re);
}

/** Specificity of a rule = its character length (wildcards included, `$` excluded). */
function _specificity(pattern) {
  return pattern.replace(/\$$/, "").length;
}

/**
 * Parse robots.txt text into { groups: [{agents, rules, crawlDelay}], sitemaps }.
 * @param {string} text
 */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let sawRuleInCurrent = false;

  const lines = String(text || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // A user-agent line after rules starts a NEW group; consecutive UA lines share one.
      if (!current || sawRuleInCurrent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
        sawRuleInCurrent = false;
      }
      if (value) current.agents.push(value.toLowerCase());
    } else if (field === "disallow" || field === "allow") {
      if (!current) { current = { agents: ["*"], rules: [], crawlDelay: null }; groups.push(current); }
      sawRuleInCurrent = true;
      // Empty Disallow = no restriction; skip empty Allow too.
      if (value !== "") current.rules.push({ type: field, path: value });
    } else if (field === "crawl-delay") {
      if (current) { const n = parseFloat(value); if (!isNaN(n)) current.crawlDelay = n; }
    } else if (field === "sitemap") {
      if (value) sitemaps.push(value);
    }
  }
  return { groups, sitemaps };
}

/** Pick the group whose user-agent best matches ours (longest token; else `*`). */
function _selectGroup(robots, userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  let best = null, bestLen = -1, star = null;
  for (const g of robots.groups) {
    for (const agent of g.agents) {
      if (agent === "*") { if (!star) star = g; continue; }
      if (ua.includes(agent) && agent.length > bestLen) { best = g; bestLen = agent.length; }
    }
  }
  return best || star || null;
}

/**
 * Is `path` allowed for `userAgent` under these robots rules?
 * @param {{groups:Array}} robots - from parseRobots
 * @param {string} userAgent
 * @param {string} path - URL path (e.g. "/products/x"); a full URL is reduced to its path.
 * @returns {boolean}
 */
export function isAllowed(robots, userAgent, path) {
  let p = String(path || "/");
  if (/^https?:\/\//i.test(p)) { try { p = new URL(p).pathname; } catch { /* keep as-is */ } }
  if (!p.startsWith("/")) p = "/" + p;

  const group = _selectGroup(robots, userAgent);
  if (!group || group.rules.length === 0) return true; // no applicable rules → allow

  let allow = -1, disallow = -1;
  for (const rule of group.rules) {
    if (_patternToRegExp(rule.path).test(p)) {
      const spec = _specificity(rule.path);
      if (rule.type === "allow") allow = Math.max(allow, spec);
      else disallow = Math.max(disallow, spec);
    }
  }
  if (disallow === -1) return true;      // nothing disallows it
  return allow >= disallow;              // ties (and stronger allows) → allowed
}

/** Crawl-delay (seconds) declared for our user-agent, or null. */
export function crawlDelay(robots, userAgent) {
  const g = _selectGroup(robots, userAgent);
  return g && g.crawlDelay != null ? g.crawlDelay : null;
}

/** Sitemap URLs declared in robots.txt (global). */
export function sitemaps(robots) {
  return robots.sitemaps.slice();
}
