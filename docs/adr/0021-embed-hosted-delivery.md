# ADR-0021 — Embed + hosted-page delivery (Stage 3A · the hero format)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Scope:** Stage 3A, format #2 (`docs/PRODUCT_DECISIONS.md` §2). Follows ADR-0019
  (build order) and ADR-0020 (webhook sink). The single-file packaging (#3) stays
  deferred to its own ADR.

## Context

One `config` is the funnel; the engine renders it (ADR-0003). `PRODUCT_DECISIONS.md` §2
fixes **one config → three packagings**; the **embed snippet** is the *hero* format —
"a strong lead at the **top of the client's own site**" — and it must also drop into a
**GHL page** as an iframe (§4). Today delivery is only the hand-written
`examples/<name>/index.html` shell: no hosted page a client can point at, and no
one-line embed.

Requirements for the embed:

- **One line for the client.** They are not developers; copy-paste, nothing to configure.
- **Isolation.** The funnel's CSS/JS must never touch the host page and vice-versa — an
  **iframe**, `sandbox`-ed. (A script that injects into the host DOM would collide with
  the client's styles and is far riskier.)
- **No scrollbar, no fixed height.** The funnel grows (hero → questions → result); the
  frame must **auto-resize to its content** or it looks broken.
- **Cross-origin by nature.** The frame is served from our origin (fulltimedigi.com), the
  host page is the client's — so the height sync crosses origins and must be done with
  `postMessage`, **origin-checked on receipt**.
- **Honest + secure:** no secrets inlined (the lead sink URL is client-side by nature of a
  no-server funnel — ADR-0019 — but tokens never are); XSS-safe; the runtime trust +
  anti-bland gates already guarantee the *content*.

## Options researched

1. **Inline `<div>` injection (no iframe).** One script writes the funnel into the host
   DOM. *Rejected:* host CSS bleeds in and ours bleeds out; global-name/localStorage
   collisions; no isolation — the opposite of a safe drop-in.
2. **iframe with a fixed height.** Simple, but a decision funnel changes height at every
   step → scrollbars or dead space. *Rejected* as the default.
3. **Sandboxed iframe + `postMessage` auto-resize (chosen).** The frame reports its
   content height; a tiny loader on the host resizes it. Full isolation, no scrollbar,
   cross-origin-safe, and **no bundler** (plain ES modules + one classic loader script).

## Decision

Ship **format #2** as two tiny, dependency-free pieces plus a hosted page:

### The client's one line
```html
<script src="https://fulltimedigi.com/embed.js" data-funnel="<funnel-id>" async></script>
```
or, for placement control / multiple funnels on a page:
```html
<div data-ftd-funnel="<funnel-id>"></div>
<script src="https://fulltimedigi.com/embed.js" async></script>
```

### `embed/embed.js` (host side — classic script, no modules)
- Discovers targets: every `[data-ftd-funnel]` element, **and** the script tag's own
  `data-funnel` (injects a frame right after itself).
- Builds the frame `src` from the loader's own origin: `…/funnel.html?funnel=<id>` (an id
  maps to a tenant config server-side later; a full `data-config="<url>"` is also honored).
- Creates a **sandboxed** iframe: `sandbox="allow-scripts allow-forms allow-popups
  allow-popups-to-escape-sandbox allow-same-origin"`, `width:100%`, `border:0`,
  `loading="lazy"`, `referrerpolicy="strict-origin-when-cross-origin"`, a `title`.
  - **Why `allow-same-origin` is safe here:** the frame `src` is **cross-origin** to the
    host page, so `allow-same-origin` grants the frame only **its own** (fulltimedigi.com)
    origin — never the host's. The funnel needs it for `localStorage` (offline lead
    outbox + audit, ADR-0006/0020). This is the standard, safe third-party-embed posture;
    it would only be dangerous if the frame were *same-origin* to the host (it isn't).
- Listens for resize messages and **validates `event.origin` === the frame's origin**
  (never `*` on receipt) before applying a **clamped** height. Ignores everything else.

### `embed/frame.js` (frame side — ES module, loaded by the hosted page)
- After the engine mounts, measures content height (`ResizeObserver` + `load`, fallback
  polling) and posts `{ __ftd:true, type:"ftd:resize", height }` to `parent` (targetOrigin
  `*` — the *child* can't know every embedding origin; the **security check lives on the
  receiver**, per the web-embed norm).

### `embed/funnel.html` (the hosted page — format #1 too)
- Reads `?funnel=<id>` → `boot({ configUrl: "../configs/<id>.json", … })`, or
  `?config=<url>` for an explicit config. This *same* page **is** the standalone hosted
  URL (format #1); embedded, it's the frame. One page, two formats.

### Pure, offline-tested core
The security- and correctness-critical logic is pure and unit-tested in Node (no DOM):
`parseResizeMessage(event, expectedOrigin)` (origin + shape + numeric + clamp),
`buildFrameSrc(loaderOrigin, opts)`, `isUsableFunnelRef`, and frame-side
`buildResizeMessage(height)`. The DOM wiring is a thin browser-guarded shell over them.

## Consequences

- The **hero "top of the client's site"** format lands now, no bundler, fully isolated,
  and it doubles as the standalone hosted URL — two of the three packagings from one page.
- **Security is testable:** the origin/shape/clamp gate is a pure function with its own
  suite; a spoofed-origin or malformed message can't resize the frame.
- 3B (the SaaS) will serve `funnel.html?funnel=<tenant-scoped-id>` from per-tenant config
  and hand the client this exact one-liner from the publish step — the embed is the
  publish artifact.
- Single-file packaging (#3) remains deferred (inlining the ES-module graph) — its own ADR.

## Verification (browser-confirmed, 2026-07-23)

A cross-origin smoke test (host page on one origin, `embed.js` + `funnel.html` on
another, headless Chromium) confirmed: the sandboxed iframe mounts, the funnel **boots
and renders** inside it, and the posted height is **applied by the host loader** across
origins. The pure gate (origin/shape/clamp) is covered by `tests/embed.test.mjs` (17
assertions).

**Deploy requirement (found during verification):** because the loader is a
`type="module"` script, browsers fetch it in **CORS mode** — so our origin
(fulltimedigi.com) MUST serve `embed/embed.js` with `Access-Control-Allow-Origin`. We
control that origin, so it's a one-time server-config item (folded into 3C), not a client
burden — the client still pastes a single tag. A classic (non-module) loader would avoid
the CORS need but forbids `export`/`import.meta` and the Node unit tests; keeping the
module + configuring CORS on our own host is the better trade.
