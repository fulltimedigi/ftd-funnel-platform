/**
 * embed/embed.js — Host-side embed loader (ADR-0021).
 * ---------------------------------------------------------------------------
 * The one line a client drops into their own site:
 *
 *   <script type="module" src="https://fulltimedigi.com/embed/embed.js"
 *           data-funnel="<funnel-id>"></script>
 *
 * or, for placement / multiple funnels:
 *
 *   <div data-ftd-funnel="<funnel-id>"></div>
 *   <script type="module" src="https://fulltimedigi.com/embed/embed.js"></script>
 *
 * It drops a SANDBOXED, auto-resizing iframe pointed at our hosted funnel page.
 * Full isolation (the funnel's CSS/JS never touch the host and vice-versa) and
 * no scrollbar (the frame reports its height; we size it — see embed/frame.js).
 *
 * Security-critical logic (frame src, incoming-message validation) is PURE and
 * unit-tested in Node; the browser wiring below is a thin guarded shell over it.
 */

export const RESIZE_TYPE = "ftd:resize";
export const MAX_FRAME_HEIGHT = 20000; // clamp: a message can never blow up the host page
export const FRAME_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin";

/** A usable funnel reference: a non-empty, non-placeholder string. */
export function isUsableFunnelRef(ref) {
  return typeof ref === "string" && ref.trim().length > 0 && !/^PASTE_|YOUR_FUNNEL/i.test(ref.trim());
}

/**
 * Build the hosted funnel-page URL from the loader's own URL. `funnel` is an id
 * (→ ?funnel=<id>, resolved to a tenant config server-side); `config` is an
 * explicit config URL (→ ?config=<url>). Pure. Throws on no usable ref.
 * @param {string} loaderUrl   the embed.js URL (import.meta.url in the browser)
 * @param {{funnel?:string, config?:string, page?:string}} opts
 */
export function buildFrameSrc(loaderUrl, opts = {}) {
  const url = new URL(opts.page || "funnel.html", loaderUrl);
  if (isUsableFunnelRef(opts.config)) {
    url.searchParams.set("config", opts.config.trim());
  } else if (isUsableFunnelRef(opts.funnel)) {
    url.searchParams.set("funnel", opts.funnel.trim());
  } else {
    throw new Error("ftd embed: no usable data-funnel or data-config");
  }
  return url.href;
}

/** The origin an embedded frame's messages must come from. Pure. */
export function frameOrigin(src) {
  return new URL(src).origin;
}

/**
 * Validate an incoming postMessage and return the height to apply, or null.
 * SECURITY GATE (never trust the channel):
 *   - event.origin MUST equal the frame's own origin (no `*`, no substring).
 *   - the payload must be our namespaced resize shape.
 *   - height must be a finite positive number; it is clamped to a sane ceiling.
 * Pure — takes an event-like {origin,data} and the expected origin.
 */
export function parseResizeMessage(event, expectedOrigin) {
  if (!event || typeof expectedOrigin !== "string" || event.origin !== expectedOrigin) return null;
  const d = event.data;
  if (!d || typeof d !== "object" || d.__ftd !== true || d.type !== RESIZE_TYPE) return null;
  const h = Number(d.height);
  if (!Number.isFinite(h) || h <= 0) return null;
  return { height: Math.min(Math.ceil(h), MAX_FRAME_HEIGHT) };
}

/* ------------------------------------------------------------------ browser -- */
/* Everything below no-ops outside a DOM, so importing this module in Node (the
 * test) never touches window/document. */

function _createFrame(doc, src, brand) {
  const iframe = doc.createElement("iframe");
  iframe.src = src;
  iframe.setAttribute("sandbox", FRAME_SANDBOX);
  iframe.setAttribute("loading", "lazy");
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  iframe.setAttribute("title", brand ? "FullTimeDigi — " + brand : "FullTimeDigi funnel");
  iframe.setAttribute("scrolling", "no");
  iframe.style.cssText = "width:100%;border:0;display:block;overflow:hidden;min-height:420px";
  return iframe;
}

function _mount(doc, target, opts, loaderUrl) {
  let src;
  try { src = buildFrameSrc(loaderUrl, opts); }
  catch (e) { console.error("[ftd-embed]", e && e.message || e); return null; }
  const origin = frameOrigin(src);
  const iframe = _createFrame(doc, src, opts.funnel || "");
  target.appendChild(iframe);
  return { iframe, origin };
}

function _init(win) {
  const doc = win.document;
  const loaderUrl = import.meta.url;
  const frames = [];

  // 1) Explicit placeholders — <div data-ftd-funnel="id" [data-config="url"]>.
  doc.querySelectorAll("[data-ftd-funnel]").forEach((elm) => {
    if (elm.getAttribute("data-ftd-mounted")) return;
    elm.setAttribute("data-ftd-mounted", "1");
    const m = _mount(doc, elm, { funnel: elm.getAttribute("data-ftd-funnel"), config: elm.getAttribute("data-config") }, loaderUrl);
    if (m) frames.push(m);
  });

  // 2) The loader's own tag carrying data-funnel — inject a frame right after it.
  doc.querySelectorAll("script[data-funnel],script[data-config]").forEach((s) => {
    const src = s.getAttribute("src") || "";
    if (!/embed(\.js)?(\?|$)/.test(src) || s.getAttribute("data-ftd-mounted")) return;
    s.setAttribute("data-ftd-mounted", "1");
    const holder = doc.createElement("div");
    holder.className = "ftd-embed";
    if (s.parentNode) s.parentNode.insertBefore(holder, s.nextSibling);
    const m = _mount(doc, holder, { funnel: s.getAttribute("data-funnel"), config: s.getAttribute("data-config") }, loaderUrl);
    if (m) frames.push(m);
  });

  // 3) One origin-checked resize listener for every frame we mounted.
  if (frames.length && typeof win.addEventListener === "function") {
    win.addEventListener("message", (event) => {
      for (const f of frames) {
        if (event.source && event.source !== f.iframe.contentWindow) continue;
        const r = parseResizeMessage(event, f.origin);
        if (r) { f.iframe.style.height = r.height + "px"; break; }
      }
    });
  }
  return frames;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const win = window;
  if (win.document.readyState === "loading") win.addEventListener("DOMContentLoaded", () => _init(win));
  else _init(win);
}
