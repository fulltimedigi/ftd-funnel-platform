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
 *     - null/undefined values are skipped
 *   children: a node | string | (node|string|null)[] — strings become text nodes,
 *     null/false are skipped.
 */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "onClick") node.addEventListener("click", v);
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
