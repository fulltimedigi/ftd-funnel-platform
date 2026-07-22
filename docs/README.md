# fulltimedigi-engine-v0

[![CI](https://github.com/fulltimedigi/fulltimedigi-engine-v0/actions/workflows/ci.yml/badge.svg)](https://github.com/fulltimedigi/fulltimedigi-engine-v0/actions/workflows/ci.yml)

A static, config-driven, vanilla-JavaScript engine for building premium
**Arabic-first diagnostic & decision funnels**. One engine, written once; each
funnel is a **config file + a theme**, not a new codebase. No build step, no
framework, no bundler — native ES modules in both Node and the browser.

> **Status: working.** The engine, the decision-table pipeline, and the
> reference funnel (PM Certification Advisor) are built, tested, and
> browser-verified. `npm test` → **142 assertions across 10 suites, green.**

## Two funnel families, one engine
- **Scoring funnels** (`scoring.mode`: `sum-band` | `dominant` | `weighted-multi`) — additive points → archetype band. *(FreelanceX, ASQ.)*
- **Decision funnels** (`scoring.mode: decision-table`) — deterministic signals → ordered rules → defensible explanation. **The reference family.** *(PM Certification Advisor.)*

## Principles
- Static frontend first — **no build step, no framework, no bundler**.
- **Config-driven** — funnels defined in `configs/*.json`; nothing funnel-specific in `engine/`.
- **Arabic RTL is first-class.**
- **Results First, Questions Last** — the non-negotiable design law (see standards below).
- **Every question must feed a signal** (no theater) and **every recommendation must include a `because`** (no unexplained results).
- **No fabrication** — claims render only if the user's signals support them (signal-gated; trust-validated).
- **Lead capture must actually store data** (no silent success) and tag *which* recommendation converted.

## The reference implementation
**PM Certification Advisor** — `configs/pm-certification-advisor.json`, runnable at
`examples/pm-certification-advisor/index.html`. It realizes the full 10-step
standard: signal architecture → questions → decision table → explanation → trust
gate → lead/conversion. Every new funnel copies it and matches its bar.

## Structure
```
engine/         Generic runtime: state, flow, scoring, signals, decide, resolver,
                recommend, resultRenderer, leadCapture, trustValidate, analytics
configs/        One JSON per funnel + _schema.json (the contract).
                ★ pm-certification-advisor.json — the reference funnel
themes/         CSS-variable theme files + _tokens.css (the vocabulary)
styles/         base.css + rtl.css (components styled via tokens only)
templates/      index.html (the thin shell pattern)
examples/       <funnel>/index.html runnable loaders
integrations/   google-apps-script/ (leads + events backend)
analytics/      sheets-sink.js + ga4-sink.js
tests/          node, no deps; per-layer suites + shared engine suites
docs/           CONFIG_GUIDE.md · DEPLOY.md · EVENTS.md
docs/standards/ the design law + engine reference (start here)
```

## Standards (read before building a funnel)
- **`docs/standards/decision-funnel-design-standard-v1.md`** — the non-negotiable design law (*Results First, Questions Last*; the 12 rules; the 10-step process).
- **`docs/standards/funnel-engine-reference-v1.md`** — the engineering companion: folder/config/signal/question/decision/explanation/trust/lead-capture architectures, the browser-verification process, and the build checklist for new funnels.

## Run & verify
```bash
npm test                 # full suite (logic, all layers)
npm run serve            # http://localhost:8000  (ES modules need HTTP)
# then open /examples/pm-certification-advisor/index.html
```
Before shipping a funnel, run the **7 browser checks** in headless Chrome
(questions render · branching · lead capture · result · Arabic RTL · variants ·
analytics payload) — see the browser-verification section of the engine reference.

## Not in scope (v0.1)
No SaaS dashboard · no drag-and-drop builder · no user accounts · no payments ·
no LLM personalization.

## Loose ends
- `analytics.sheetsEndpoint` in the reference config is a placeholder — set the real Apps Script `/exec` URL to capture leads live (the sink safely no-ops on the placeholder).
- `templates/index.html` is the generic shell stub; runnable funnels live under `examples/<funnel>/`.
