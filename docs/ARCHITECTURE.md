# Architecture

Three layers, one direction of dependency: **Authoring → produces a config →
Runtime renders it**, with the **Decision + Trust** core shared between authoring
(to validate what it generates) and runtime (to execute it).

```
                    ┌─────────────────────────────────────────────┐
   brand URL  ─────▶│  AUTHORING LAYER   (Stage 1–2, net-new)      │
                    │  crawl → real catalog → decision model →     │
                    │  generate funnel config                      │
                    └───────────────┬─────────────────────────────┘
                                    │ emits a config.json
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │  DECISION + TRUST CORE  (from v0)            │
                    │  scoring · signals · decide · recommend ·    │
                    │  trustValidate (the gate)                    │
                    └───────────────┬─────────────────────────────┘
                                    │ validated, deterministic verdict
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │  RUNTIME + DELIVERY  (from production)       │
                    │  boot · state · renderers · leadCapture ·    │
                    │  analytics · error-monitor · backend         │
                    └─────────────────────────────────────────────┘
                                    │
                                    ▼   static funnel shipped to the end user
                             (hosted page / embed / client site)
```

The **operator** interacts through the separate `ftd-studio` control panel, which
calls the authoring layer, shows the generated funnel for review, and publishes on
approval (human-in-the-loop; see the Studio repo).

---

## Layer 1 — Decision + Trust core  (the brain)

Pure, DOM-free, deterministic. Same answers ⇒ same verdict (no `Math.random()`).

- **`engine/scoring.js`** — four interchangeable modes behind one output shape
  `{primary, secondary, scores, flags, sorted}`: `sum-band`, `dominant`,
  `weighted-multi`, and `decision-table`.
- **`engine/signals.js` + `engine/decide.js`** — the decision-table pipeline:
  raw signals (option→canonical value) → derived signals (`identity`/`cases`/`clamp`
  rules, all **config data**) → ordered first-match `decisionTable` → archetype.
- **`engine/recommend.js`** — signal-gated explanation. A `becauseTemplate` renders
  only when every `{token}` resolves from the user's signals; `why`/`whyNot` bullets
  each carry a `needs` predicate and render only if satisfied. **The engine cannot
  show a claim the answers don't support.**
- **`engine/trustValidate.js`** — the build gate (TV1–TV5): every rule maps to a real,
  complete result; every question affects the outcome (no "theater"); a **Cartesian
  sweep of the whole signal space** proves no dead ends and every cell is explained; a
  copy linter rejects unmeasured "fake-intelligence" / false-promise language.

## Layer 2 — Runtime + Delivery  (the body)

- **`engine/index.js`** — boot: install error monitor → fetch config → **structure
  gate** → **trust gate** → inject theme → render `hero → questions → lead → result`.
- **`engine/state.js`** — phase machine, answers, history, flags, `localStorage`
  resume.
- **`engine/questionRenderer.js` / `resultRenderer.js`** — accessible option cards;
  result layouts `personas | commerce | tracks`. XSS-safe DOM.
- **`engine/leadCapture.js`** — validate → optimistic local queue → POST → **honest
  failure** (never fakes success); rich payload (answers, scores, recommended SKU).
- **`engine/analytics.js` + `analytics/*`** — fixed event vocabulary; pluggable
  sinks (Sheets, GA4), fire-and-forget.
- **`engine/error-monitor.js`** — ring buffer + PII masking + remote report.
- **`integrations/google-apps-script/Code.gs`** — per-funnel Sheets isolation,
  email-dedupe upsert.

## Layer 3 — Authoring  (the moat, Stage 1–2)

Net-new. Turns a brand URL into a validated funnel config:

1. **Ingest** — crawl the brand site → structured real catalog (name, attributes,
   price, URL, differentiators) with provenance.
2. **Derive** — infer the real decision axes that separate the products → author
   fact-based questions.
3. **Map** — generate the answer→product scoring so every outcome is a **real SKU with
   a real URL**.
4. **Validate** — run the trust gate on the generated config; repair on failure.

Output is a plain config the Decision core validates and the Runtime renders — so the
AI layer can never ship a funnel that fails the same gates a hand-built one must pass.

---

## Config = the contract

One JSON config defines one funnel; the engine never changes per client. The schema
(`configs/_schema.json`) is the contract between authoring/strategy and the engine, and
is validated **at boot** (not just in tooling). See `docs/CONFIG_GUIDE.md`.
