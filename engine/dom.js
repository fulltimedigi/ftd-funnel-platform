/**
 * engine/dom.js — Minimal DOM helpers (no framework).
 *
 * Responsibility (SPEC §5):
 *   Tiny safe DOM creation/append helpers. Text is set via textContent (auto-
 *   escaped by the DOM), so config copy can't inject markup.
 *
 * el(tag, attrs, children):
 *   attrs keys: class, text, style, href, type, disabled, data-*, etc.
 *     - "class"   → className
 *     - "text"    → textContent (leaf nodes only; do not combine with children)
 *     - "onClick" → addEventListener('click', fn)
 *     - "href"    → sanitized via safeHref (blocks javascript:/data:/etc.)
 *     - null/undefined values are skipped
 *   children: a node | string | (node|string|null)[] — strings become text nodes,
 *     null/false are skipped.
 */

/**
 * Sanitize an href so a poisoned/scraped config can't inject a javascript:/data:
 * URL (ADR-0032). Allows http/https/mailto and scheme-less (relative/anchor)
 * values; strips everything else. Control chars are removed before scheme
 * detection to defeat "java\tscript:" tricks. Returns null when it must be dropped.
 */
export function safeHref(v) {
  const raw = String(v).trim();
  const probe = raw.replace(/[\x00-\x20]+/g, "").toLowerCase();
  const m = probe.match(/^([a-z][a-z0-9+.-]*):/);
  if (m && !["http", "https", "mailto"].includes(m[1])) return null;
  return raw;
}

/** Sanitize an image src: http/https/data (+ relative) only; blocks javascript: etc. */
export function safeSrc(v) {
  const raw = String(v).trim();
  const probe = raw.replace(/[\x00-\x20]+/g, "").toLowerCase();
  const m = probe.match(/^([a-z][a-z0-9+.-]*):/);
  if (m && !["http", "https", "data"].includes(m[1])) return null;
  return raw;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "onClick") node.addEventListener("click", v);
    else if (k === "href") { const safe = safeHref(v); if (safe != null) node.setAttribute("href", safe); }
    else if (k === "src") { const safe = safeSrc(v); if (safe != null) node.setAttribute("src", safe); }
    else node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

/** Remove all children of a node. */
export function clear(node) {
  while (node.lastChild) node.removeChild(node.lastChild);
}

/** Replace the contents of `parent` with a single `node`. */
export function mount(parent, node) {
  clear(parent);
  parent.appendChild(node);
}
