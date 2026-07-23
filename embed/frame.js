/**
 * embed/frame.js — Frame-side auto-resize reporter (ADR-0021).
 * ---------------------------------------------------------------------------
 * Runs INSIDE the hosted funnel iframe. After the engine mounts it measures the
 * content height and posts it to the parent so the host-side loader (embed.js)
 * can size the iframe to its content — no scrollbar, no dead space.
 *
 * The child cannot know every origin that may embed it, so it posts with
 * targetOrigin "*"; the SECURITY CHECK lives on the receiver (embed.js validates
 * event.origin). This is the standard third-party-embed posture. Every message
 * is namespaced (`__ftd:true`, `type:"ftd:resize"`) so the parent can ignore
 * anything else on the channel.
 *
 * Pure/Node-safe: the payload builder and measurement are exported and unit
 * tested; the browser wiring is a guarded shell that no-ops outside a DOM.
 */

export const RESIZE_TYPE = "ftd:resize";

/** The exact message shape the host loader expects. Pure. */
export function buildResizeMessage(height) {
  return { __ftd: true, type: RESIZE_TYPE, height: Math.max(0, Math.ceil(Number(height) || 0)) };
}

/**
 * Content height from a document-like object. Uses the max of the usual box
 * metrics so a funnel that grows (hero → questions → result) never clips. Pure:
 * accepts any object exposing the metrics, so it is testable without a real DOM.
 */
export function measureHeight(doc) {
  if (!doc) return 0;
  const b = doc.body || {};
  const e = doc.documentElement || {};
  return Math.max(
    b.scrollHeight || 0, b.offsetHeight || 0,
    e.scrollHeight || 0, e.offsetHeight || 0, e.clientHeight || 0
  );
}

/**
 * Start reporting height to `parent`. Browser-guarded — a no-op without a DOM
 * so importing this module in Node (tests) is safe. Coalesces bursts and only
 * posts when the height actually changes.
 */
export function startFrameReporter(win) {
  const w = win || (typeof window !== "undefined" ? window : null);
  if (!w || !w.parent || w.parent === w || typeof w.postMessage !== "function") return () => {};
  const doc = w.document;
  if (!doc) return () => {};

  let last = -1;
  const post = () => {
    const h = measureHeight(doc);
    if (h > 0 && h !== last) {
      last = h;
      try { w.parent.postMessage(buildResizeMessage(h), "*"); } catch { /* cross-origin post is best-effort */ }
    }
  };

  // Coalesce rapid layout changes into one post per frame.
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const raf = typeof w.requestAnimationFrame === "function" ? w.requestAnimationFrame : (fn) => w.setTimeout(fn, 16);
    raf(() => { scheduled = false; post(); });
  };

  try {
    if (typeof w.ResizeObserver === "function" && doc.body) {
      const ro = new w.ResizeObserver(schedule);
      ro.observe(doc.body);
      if (doc.documentElement) ro.observe(doc.documentElement);
    }
  } catch { /* ResizeObserver unavailable — fall through to the other triggers */ }

  if (typeof w.addEventListener === "function") {
    w.addEventListener("load", schedule);
    w.addEventListener("resize", schedule);
  }
  // A short settling poll covers async renders (theme/font load, engine mount).
  let ticks = 0;
  const timer = w.setInterval(() => { schedule(); if (++ticks > 20) w.clearInterval(timer); }, 250);

  schedule();
  return () => { try { w.clearInterval(timer); } catch { /* noop */ } };
}

// Auto-start when loaded as a real page script (never in Node).
if (typeof window !== "undefined" && typeof document !== "undefined") {
  startFrameReporter(window);
}
