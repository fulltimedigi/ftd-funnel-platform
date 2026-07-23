# ADR-0022 — Stage 3B: the platform core (tenant isolation + funnel lifecycle + publish)

- **Status:** Accepted (first slice; the HTTP/UI layer and the DB binding follow)
- **Date:** 2026-07-23
- **Scope:** Stage 3B, as re-framed by the operator's SaaS vision (ADR-0019). Follows
  3A (ADR-0020 webhook, ADR-0021 embed). The account **UI** and the **hosting/DB** are 3C.

## Context

`fulltimedigi.com` **is the product** — a multi-tenant SaaS. A client signs in, pastes
their store URL, the platform generates a funnel **server-side**, they review/refine it,
and **publish it themselves**. ADR-0019 fixed the division of labour: **this repo provides
the clean, tested *engine* of the Studio** — a deterministic authoring/publish core — and
3C hosts it (Node backend + DB + UI).

The key lever (ADR-0017): our authoring is **deterministic code** (`authoring/` — no LLM,
no `Math.random`, fully tested). So the platform runs `generateFunnelFromUrl()` on its own
backend **without a Claude session per client** — the core economic advantage. What 3B
adds around that engine is the **platform layer**: *who owns what* (tenants) and *the
funnel's journey* (draft → review → refine → publish).

Two properties dominate the design:

1. **Tenant isolation is a security cornerstone.** One client's sites, catalogs, funnels,
   leads, and **sink secrets** must be unreachable by another (the same discipline as the
   per-funnel backend isolation, ADR-0012, now at platform scale). A leak here is the
   worst failure the platform can have — so isolation is enforced in code and tested for
   *absence of leakage*, not just presence of access.
2. **The gates never bend for the product flow.** A funnel that fails `trustValidate` or
   `antiBlandCheck` **cannot reach review or publish** — it is honestly **Blocked** (OS-5 /
   rule 3). Refine re-runs both gates and **rejects** any edit that would break them; it
   never weakens a gate to accept a change.

## Options researched

- **Where does 3B live?** (a) A separate new repo now, or (b) **the platform *core* here,
  the UI/host in 3C.** Chosen **(b)**: ADR-0019 already committed to it, it keeps the core
  test-green-gated beside the engine it wraps, and it avoids standing up hosting before the
  logic is proven. The core is **host-agnostic** and **transport-agnostic** (no HTTP, no DB
  yet) so 3C can pick the stack freely.
- **Data layer now or later?** A real DB (Postgres) is a 3C decision (open question in
  ADR-0019). So 3B defines a **store *interface*** with an **in-memory implementation**
  (tests + local), which 3C swaps for Postgres **with row-level tenant scoping**. Coding to
  the interface means the isolation contract is proven now and inherited later.
- **Generation coupling.** The lifecycle **injects** the authoring function (default = the
  real `generateFunnelFromUrl`), so the whole flow runs **offline and deterministically** in
  tests, exactly like the ingest/author layers.

## Decision — the first slice (this ADR)

A new `platform/` module, pure + Node-safe + unit-tested:

### `platform/tenantStore.js` — the isolation spine
An abstract store with an in-memory implementation. **Every** read/write is scoped by
`tenantId`; a cross-tenant access returns nothing / throws — never another tenant's data.
Holds tenants, their funnel **projects**, and **per-tenant secrets** (sink URLs/keys, kept
out of any other tenant's reach). This is the exact contract 3C re-implements over Postgres
row-level security. Tested primarily for **no cross-tenant leakage**.

### `platform/studio.js` — the funnel lifecycle
The state machine + operations over a *project*:
`draft → (generate) → in-review | blocked → (refine)* → (publish) → published`.
- `createDraft({tenantId, url, goal})` — a project in `draft` (URL + optional business goal).
- `generate(project, deps)` — runs authoring server-side (injected). **Blocked** on
  authoring failure **or** a failing gate (honest reason); otherwise `in-review` with the
  config, the ingested catalog, and both gate results attached.
- `refine(project, knobs, deps)` — re-authors from the **stored catalog** with the
  operator's knobs (goal · length · hero products · result style · lead sink), re-runs both
  gates, and **only accepts if both pass** — else the project is left unchanged and the
  refusal is returned. Never weakens a gate.
- `publish(project, {origin, sink})` — **only** from `in-review` with **both gates green**;
  wires the chosen lead sink into the config and emits the artifact; else honest refusal.

### `platform/publish.js` — pure artifact builders
`buildHostedUrl(origin, funnelId)`, `buildEmbedSnippet(origin, funnelId)` (the ADR-0021
one-liner), and `applySink(config, sink)` (writes `leadForm.webhookUrl` /
`analytics.sheetsEndpoint` from the chosen destination — reusing the ADR-0020 usability
guards). The published funnel is referenced by a **tenant-scoped id**; 3C's server resolves
`?funnel=<id>` to that tenant's stored config (not a static file).

## Consequences

- The platform can generate, gate, refine, and publish a funnel **deterministically and
  server-side** — the whole product flow exists as tested code before any UI/host.
- **Isolation is proven now**: the store's contract (and its no-leak tests) is what 3C's
  Postgres layer must satisfy — security designed in, not bolted on.
- **The gates stay hard**: blocked-on-fail and refuse-on-refine mean the product flow can
  never ship a dead/mirror/unjustified funnel (rule 3 / anti-bland standard).
- **Deferred to 3C (unchanged):** the HTTP API + account auth + the Studio UI, and the DB
  binding + hosting stack (ADR-0019 open question). This slice is host-agnostic.
