# ADR-0004 — Keep the zero-build, vanilla-ES-module stack

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

Both source engines are **vanilla ES modules with no build step, no dependencies, no
framework** — the funnel is static files (`engine/*.js` + a JSON config + CSS) served
directly. The temptation, for a "world-class" product, is to reach for React/Next/Vite.

## Decision

**Keep zero-build vanilla ES modules for the funnel runtime.** Reasons:
- The rendered funnel must be **tiny and instant** on mobile/4G (competitors like
  Heyflow/Perspective win on load speed; a framework bundle works against us).
- Static output = trivial, cheap, resilient hosting (any CDN / Netlify / the client's
  own site) with no server.
- The existing test discipline drives the *real* controller with a tiny DOM shim — no
  framework test harness needed.
- Determinism and auditability are easier without a build pipeline in the way.

This applies to the **funnel runtime** (the artifact shipped to end users). The
**authoring layer** (Stage 1–2: URL ingestion, AI catalog/decision generation) and any
**operator-facing UI** may use heavier tooling where it earns its keep — they are
build-time/authoring tools, not the shipped funnel. Such a choice will get its own ADR.

## Consequences

- No JSX/TSX; DOM built through the engine's `el()/escape()` helpers (XSS-safe).
- Third-party capability (e.g. a crawler for ingestion) lives in the authoring layer,
  not the runtime.
- If a future requirement genuinely needs a runtime framework, supersede this ADR with
  the evidence.
