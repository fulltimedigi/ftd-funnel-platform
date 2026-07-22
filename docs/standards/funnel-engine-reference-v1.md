# FULLTIMEDIGI FUNNEL ENGINE — REFERENCE IMPLEMENTATION v1

**Status: canonical.** This is the engineering companion to
[`decision-funnel-design-standard-v1.md`](./decision-funnel-design-standard-v1.md)
(the non-negotiable design law: *Results First, Questions Last*).

The **PM Certification Advisor** (`configs/pm-certification-advisor.json`) is the
**reference implementation**. Every future FullTimeDigi diagnostic / decision
funnel — recommendation engine, lead-qualification funnel, assessment, interactive
lead magnet — is built by copying its structure and following the
[build checklist](#10-build-checklist-for-future-funnels) at the end.

Two funnel families share one engine:
- **Scoring funnels** (`scoring.mode`: `sum-band` | `dominant` | `weighted-multi`) — additive points → archetype band. (e.g. FreelanceX, ASQ.)
- **Decision funnels** (`scoring.mode: decision-table`) — deterministic signals → ordered rules → defensible explanation. **This is the reference family** and what this document specifies.

---

## Data flow (decision funnel)

```
answers {questionId: optionId}
   │  engine/signals.js  collectRawSignals(answers, config)
   ▼
raw signals {credential, qualification, hours, environment, goal}
   │  engine/signals.js  deriveSignals(raw)   ← threshold derivation + coherence clamp
   ▼
derived signals {DS1, DS2, DS3, DS5, goal, learning_mode, meta}
   │  engine/decide.js  decide(signals, config.decisionTable)   ← ordered, first-match
   ▼
result id (R1..R7)   ── engine/resolver.js  resolve() → archetype object
   │
   ├─ engine/recommend.js  buildRecommendations()  ← variant + signal-gated why/why-not
   │     └─→ engine/resultRenderer.js  (commerce layout)         → the screen the user sees
   └─ engine/index.js  buildLeadPayload()                        → the lead sent to the sink
```

Everything above the render is **pure and tested** in isolation; identifiers
(option ids, signal values, result ids) are **language-independent**, so copy can
be translated without touching logic.

---

## 1. Folder structure

```
fulltimedigi-engine-v0/
├── engine/                     # the generic, config-driven runtime (no funnel content)
│   ├── index.js                #   boot() + createFunnel() controller; buildLeadPayload()
│   ├── flow.js                 #   step sequencing; branching via option.next
│   ├── state.js                #   answers{} + history[], localStorage-persisted
│   ├── questionRenderer.js     #   renders a question screen
│   ├── signals.js              #   STEP 4 — raw→derived signal derivation (+ clamp)
│   ├── decide.js               #   STEP 7 — decision-table evaluator
│   ├── scoring.js              #   mode dispatch (sum-band|dominant|weighted-multi|decision-table)
│   ├── resolver.js             #   maps result/primary id → archetype object
│   ├── recommend.js            #   STEP 8 — explanation engine (signal-gated why/why-not)
│   ├── resultRenderer.js       #   renders the result (tracks|commerce|personas)
│   ├── leadCapture.js          #   STEP 10 — lead form, validation, no-silent-success
│   ├── trustValidate.js        #   STEP 9 — executable trust gate (TV1–TV5)
│   ├── dom.js / progress.js / analytics.js / i18n-rtl.js
├── configs/
│   ├── _schema.json            # the strategy↔engine contract (one config = one funnel)
│   ├── pm-certification-advisor.json   # ★ REFERENCE FUNNEL (full, runnable, Arabic)
│   └── <other funnels>.json
├── tests/                      # node, no deps; console assertions; `npm test`
│   ├── signals|questions|decision|explanation|trust|conversion.test.mjs   # per-layer
│   └── scoring|funnel.*|leadloop|asq.test.mjs                              # shared engine
├── themes/  styles/            # _tokens.css + per-theme; base.css + rtl.css
├── templates/index.html        # the shell pattern (copied per funnel)
├── examples/<funnel>/index.html # ★ runnable loader per funnel
├── analytics/                  # sheets-sink.js, ga4-sink.js
├── integrations/google-apps-script/   # the Sheets backend
└── docs/standards/             # the design law + THIS reference
```

**Rule:** nothing funnel-specific ever lives in `engine/`. A new funnel is a new
`configs/*.json` + an `examples/<funnel>/index.html` loader. Zero engine edits.

---

## 2. Config structure

One JSON file = one funnel. Validated against `configs/_schema.json`. Top-level keys:

| Key | Required | Purpose |
|---|---|---|
| `id` | ✓ | unique; localStorage namespace + analytics tag |
| `brand` `theme` `lang` | ✓ | chrome + theme file name + `"ar"` (RTL first-class) |
| `hero` | ✓ | landing copy (eyebrow/headline/subtext/chips/startLabel) |
| `scoring` | ✓ | `{ mode }` — `decision-table` for decision funnels |
| **`signals`** | decision-funnel | raw signals + option→value `map` (§3) |
| **`derivedSignals`** | decision-funnel | named derivations DS1/DS2/DS3/DS5 (§3) |
| **`decisionTable`** | decision-funnel | ordered first-match rules → result id (§5) |
| `questions` | ✓ | ordered/branched; **every question feeds a signal** (§4) |
| `archetypes` | ✓ | the results (4–7); recommendation + `resultExtras` (§6) |
| `resultLayout` | ✓ | `commerce` \| `tracks` \| `personas` |
| `leadForm` | ✓ | gated, skippable, fields (§8) |
| `cta` `analytics` `copy` | ✓ | final CTA, sinks, UI strings (incl. `copy.result.*`) |

The `signals` / `derivedSignals` / `decisionTable` blocks are the **decision-table
extension** (added in this engine). Scoring funnels omit them and use option
`score` + archetype `band` instead. `option.score` is **optional** precisely so
decision-table options can bind through `signals[].map` instead.

---

## 3. Signal architecture (`engine/signals.js`)

**Signals are the objective; questions only collect them** (Standard Rule 3).
Three roles, declared per signal:

| Role | Decides the result? | Example |
|---|---|---|
| `decision` | yes — read by the decision table | qualification, hours, environment, credential |
| `presentation` | no — shapes copy / which offer shows | goal |
| `offer` | no — delivery/SKU only | learning mode (resolved on the result screen, **not asked**) |

**Raw → derived.** Raw signals come straight from answers; derived signals are
computed by **generic, data-driven rules declared in `derivedSignals`** — the
LOGIC lives in the config, so a new funnel needs no engine edit. Two rule kinds:

| Rule | Shape | Behaviour |
|---|---|---|
| `identity` | `{ from:[rawId], domain }` | passthrough of `from[0]` |
| `cases` | `{ from, cases:[{when,value}], default, clamp:[{when,ifValue,to}], domain }` | first-match → value, then coherence clamp |

`when` predicates use the decision table's value/array/wildcard semantics.
**`domain` is required** on every derived signal — Trust Validation (§7) uses it
for the predicate-domain check and the totality sweep.

*Reference funnel as data:* `DS1`/`DS3` = `identity`; `DS2` = `cases` —
`meets` iff `(bachelor ∧ ≥4,500h) ∨ (diploma ∧ ≥7,500h)`, with a `clamp`
(`not_yet_working ∧ meets → below`); `DS5` = `cases` (CAPM/PRINCE2-F →
`entry_level`, PMP+ → `pmp_plus`, else `none`). The Houseplant funnel reuses the
same two rule kinds for a completely different niche.

**Three invariants the data expresses, never the decision layer:**
- **Measured gate, never inferred** — a threshold signal is *derived* from two raws (qualification × hours; care × experience), so there's no "are you eligible?" question to answer dishonestly.
- **Coherence clamp** — an independent signal overrides an incoherent combination (`not_yet_working ∧ meets → below`; `low light ∧ demanding → easy`). `meta.clamped` records when it fired.
- **Over-capture guard** — out-of-scope inputs map to the neutral value (non-PM certs → `none`; `struggled` keeper → `new`) so they don't trigger the wrong branch.

**Exports:** `deriveSignals(config, raw)`, `collectRawSignals(answers, config)`,
`applyDerivation(spec, raw)`. (The `QUAL`/`THRESHOLD`/… constants are optional
authoring vocab, not engine logic.)
**Missing values:** decision signals must resolve (an explicit `unsure` value is
how uncertainty is expressed); presentation/offer signals default (`goal→unsure`).

**Tested by** `tests/signals.test.mjs`.

---

## 4. Question architecture

**The floor is one question per raw decision signal that nothing else can imply.**
For the reference funnel: `credential, qualification, hours, environment` (4
mandatory) + `goal` (1 optional, presentation). Proof of minimality: each maps 1:1
to a distinct derived signal; remove any and a derived signal disappears.

**Rules:**
- **No question without a signal** — every `question.id` is the `source` of a `signal`. (Trust-validated.)
- **Every option maps to a canonical value** — `signals[].map: {optionId: canonicalValue}` is a **bijection** with the question's options. (Trust-validated.)
- **Offer signals are not questions** — learning mode (Live/Self) is a choice *on the result screen*, removing a question for everyone.
- **Branching shortens, never bloats** — a `next` on an option short-circuits irrelevant questions. Reference: `opt_pmp` sets `next: q_environment`, skipping the qualification+hours gate (a PMP holder answers 2, not 4). `flow.js` honors `option.next`; absent → next in array.

**Traceability chain (must hold end-to-end):**
`Question → Option → Raw signal → Derived signal → Result`.

**Tested by** `tests/questions.test.mjs` (structure + determinism + minimality).

---

## 5. Decision engine architecture (`engine/decide.js`)

`scoring.mode: decision-table` routes `score()` to `scoreDecisionTable(config,
answers)`, which runs the pipeline and returns the **same stable shape** the
point-based modes do (so `resolver.js` / renderers are mode-agnostic), plus two
extra keys for audit:

```
{ primary, secondary:null, scores:{[id]:1}, flags:[], sorted:[[id,1]],
  signals,   // the derived DS1/DS2/DS3/DS5 + goal/learning_mode (+ clamp meta)
  ruleId }   // which rule fired
```

**The decision table is config DATA, not code** — an ordered list of rules:

```json
{ "id": "r7_none_meets", "when": { "DS5": "none", "DS2": "meets" }, "result": "R3" }
```

`matchRule(signals, when)` semantics: omitted key = wildcard · scalar = equality ·
array = membership (`in`) · `{}` = always. `decide()` walks the list and returns
the **first** match (precedence by order). The reference encodes the frozen v3
precedence in 11 real rules + a final `when:{}` **safety net**.

**Invariants (trust-validated):**
- **Totality** — every cell of the `DS1×DS2×DS3×DS5` space resolves to exactly one non-null result.
- **Partition** — eligibility is mutually exclusive by construction; the safety net never fires for well-formed signals.
- **Robustness** — malformed/empty signals fall to the safety net (Safe-Start), never crash.

**Tested by** `tests/decision.test.mjs` (all personas + full-space sweep + pipeline).

---

## 6. Explanation engine architecture (`engine/recommend.js`)

Delivers the Standard's value layer (Rule 10) and enforces defensibility (Rule 11)
**structurally**. `buildRecommendations(resolved, scoring, config)` returns:

```
{ primary: { ...recommendation, because, why[], whyNot[], nextAction }, contextual[], ruleId }
```

Authored per archetype:

| Field | Where | Role |
|---|---|---|
| `recommendations.primary` | archetype | name/price/url + **`becauseTemplate`** (required) |
| `resultExtras.variants[]` | archetype | `{needs, …}` override (dual-mode: entry-tier, post-PMP context) |
| `resultExtras.why[] / whyNot[]` | archetype | `{needs, claim}` — reasons / rejected alternatives |
| `resultExtras.nextAction` | archetype | the concrete step |
| `recommendations.contextual[]` | archetype | optional offers gated by `{needs}` |

**Defensibility is mechanical:** every `why`/`whyNot` bullet carries a `needs`
predicate and renders **only if the user's signals satisfy it** — reusing the
decision engine's `matchRule`. There is no free-text path around the gate, so the
engine *cannot* show a claim the user's signals don't support.

**HARD RULE §9:** `resolveTemplate` fills `{token}`s from the derived signals; if
any token is unresolved it returns `null` and the recommendation is **suppressed**,
never half-rendered. **Variants:** the first variant whose `needs` match overrides
the base recommendation (an entry-holder is told to progress, not to re-buy a
foundation cert). The **`commerce`** result layout (`resultRenderer.js`) consumes
this for decision funnels: variant-correct recommendation + why / why-not /
next-step + gated contextual grid.

**Tested by** `tests/explanation.test.mjs` (language-agnostic: rendered bullets ==
the config's signal-satisfied bullets).

---

## 7. Trust validation architecture (`engine/trustValidate.js`)

The Standard's TRUST VALIDATION CHECK as an **executable build gate**.
`trustValidate(config) → { ok, findings:[{severity, code, message}] }`; `ok` is
false iff any blocker exists.

| Check | Enforces |
|---|---|
| **TV1** results defined | every rule → an archetype with a complete primary recommendation; reachable & described; **no `contextual` misplaced under `resultExtras`** (it must live under `recommendations.contextual`, else it's silently dropped) |
| **TV2** questions necessary | every question feeds a signal; option↔value bijection; **no orphan decision signal** (each derived signal used by the table) |
| **TV3** recommendations defensible | **sweep all cells** → each renders a non-empty `because` + ≥1 signal-gated `why`; every `needs`/`when` references a defined signal & in-domain value |
| **TV4** result explains | every reachable result has a `nextAction` |
| **TV5** no unmeasured claims | claims are signal-gated; **Rule-8 lint** rejects personality / readiness-score / "X% match" / leadership-style vocabulary |

**Funnel-agnostic.** The validator reads the decision-signal keys and their value
domains from `config.derivedSignals` (the `domain` field) — nothing is hardcoded,
so it audits any funnel. The cell sweep is the Cartesian product of those domains.

**The gate has teeth.** `tests/trust.test.mjs` (and each funnel's `*.trust.test.mjs`)
inject every violation class into a clone and assert it's caught (missing archetype,
theater question, unmapped option, orphan signal, undefined-signal `needs`,
out-of-domain value, no-because, no-why, misplaced contextual, fake-intelligence
copy). A gate that can't fail is theater. Run `trustValidate` before approving any funnel.

---

## 8. Lead capture architecture (`engine/leadCapture.js` + `index.js`)

**Capture** (`leadCapture.js`): renders `config.leadForm` (gated, skippable),
`validateLead(fields, values)` (required + email regex), and submits via an
**injected** `onSubmit(values)` — transport-agnostic and testable.

**No silent success (§10):** on failure the user sees an honest error and may
retry or skip; they are *never* told it saved when it didn't.

**Conversion layer** (`index.js buildLeadPayload`): the lead is tagged with the
result **before** the form shows. For decision funnels it additionally carries
*which recommendation converted*:

```
recommended   // the cert name (e.g. "PMP®")
decisionRule  // the firing rule id (e.g. "r7_none_meets")
signals       // the derived DS1/DS2/DS3/DS5 (+ goal, clamp meta)
```

plus `primaryArchetype`, `answers`, `dedupeKey` (lowercased email), `timestamp`.

**Transport** (`analytics/sheets-sink.js`): POSTs JSON to the Apps Script `/exec`;
returns `{ok:false}` (no network) for an unset/placeholder endpoint; keeps a
localStorage audit queue. Set `analytics.sheetsEndpoint` to go live.

**Tested by** `tests/conversion.test.mjs` (end-to-end through the real controller)
and `tests/leadloop.test.mjs` (transport + failure path).

---

## 9. Browser verification process

Logic is unit-tested headlessly; **before shipping, verify in a real browser.**

1. **Serve over HTTP** (ES modules + `fetch` need it): `npm run serve` → `http://localhost:8000`.
2. **Loader:** `examples/<funnel>/index.html` imports `boot` and points `configUrl` at the funnel config (copy the reference loader).
3. **Drive a real engine** with **headless Google Chrome**:
   ```
   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
   "$CHROME" --headless=new --disable-gpu --virtual-time-budget=12000 \
             --dump-dom    <url> > /tmp/dom.html      # read self-test report
   "$CHROME" --headless=new --disable-gpu --virtual-time-budget=12000 \
             --window-size=440,3000 --screenshot=/tmp/shot.png <url>
   ```
4. **Self-driving harness pattern** (a throwaway `verify.html`, not shipped):
   `createFunnel(cfg, root, { submitLead: capture })`, drive via the returned API
   (`start/select/next/getLeadHandle().fill/submit/skip`), render sample screens,
   and **write a PASS/FAIL report into the DOM** so `--dump-dom` can read it.
   Inject the transport seam to capture the analytics payload.

**The 7 checks (all must pass):** 1 questions render · 2 branching · 3 lead capture
· 4 result renders · 5 Arabic RTL (`getComputedStyle(html).direction === "rtl"`) ·
6 recommendation variants · 7 analytics payload generated. The reference funnel
passed all 7 in Chrome 148. Remove the harness after verifying.

---

## 10. Build checklist for future funnels

Follow the Standard's 10-step process; each step has a code home and an exit test.

- [ ] **1–3 · Result / Eligibility / Disqualification architecture** — define all outcomes, who gets/avoids each, and the hard exclusions, *before any question*. (Design doc; freeze it.)
- [ ] **5 · Decision matrix** — required / positive / negative / exclusion / tie-breaker signals per result; mutually exclusive.
- [ ] **4 · Signal architecture** — declare `signals` (roles + domains + `map`) and `derivedSignals` (`identity`/`cases` rules **with `domain`**, `clamp` for coherence). **No engine edit** — derivation logic is data. Express measured gates and the over-capture guard as cases.
- [ ] **6 · Question architecture** — minimum questions (one per raw decision signal); option↔value bijection; offer signals to the result screen; branch with `option.next`. *(These invariants are enforced by Trust TV2, so a standalone questions test is optional — the PM funnel keeps one for extra coverage.)*
- [ ] **7 · Decision logic** — encode the precedence as an ordered `decisionTable` ending in a `when:{}` safety net; verify totality across the full signal space. → **`tests/<funnel>.decision.test.mjs`** (all personas + sweep + resolver).
- [ ] **8 · Explanation layer** — per archetype: recommendation + `becauseTemplate` (no token left unresolved) + `needs`-gated `why`/`whyNot` + `nextAction` + variants; **`contextual` under `recommendations.contextual`** (not `resultExtras`). → **`tests/<funnel>.explanation.test.mjs`** (gating, language-agnostic).
- [ ] **9 · Trust validation** — `trustValidate(config)` returns `ok:true`, zero blockers/warnings. → **`tests/<funnel>.trust.test.mjs`** (gate + teeth).
- [ ] **10 · Lead capture & conversion** — `leadForm` fields; conversion payload carries `recommended`/`decisionRule`/`signals`; set `analytics.sheetsEndpoint`. → **`tests/<funnel>.conversion.test.mjs`** (end-to-end through the controller).
- [ ] **Assembly** — one schema-valid `configs/<funnel>.json` (single source of truth); Arabic copy; `resultLayout` chosen.
- [ ] **Loader** — `examples/<funnel>/index.html`.
- [ ] **Browser verification** — the 7 checks pass in headless Chrome (throwaway `verify.html` harness; remove after).
- [ ] **Gate** — `npm test` green (wire the funnel's four suites — decision/explanation/trust/conversion — into the `test` script).
- [ ] **Commit** — only after browser verification.

**Canonical per-funnel test set:** `decision` · `explanation` · `trust` · `conversion`
(the four `tests/<funnel>.*.test.mjs`). Both the PM Advisor and Houseplant Advisor
ship exactly these.

**Definition of done:** the funnel deterministically picks the right result,
defends it with only measured claims (Rule 8/11), refuses to fabricate (trust gate),
captures the lead tagged with its recommendation, renders the full Arabic value
layer, and passes all 7 browser checks. The PM Certification Advisor meets this
bar — match it.
