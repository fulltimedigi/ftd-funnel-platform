# ADR-0056 — Axis-rule v8: behavioral mirror — options cap + corrected share + authoring-gate relations

- **Status:** Accepted (implemented + proven); **one value surfaced for operator confirmation**; certification
  + wiring still NOT started.
- **Date:** 2026-07-28
- **Related:** ADR-0055 (`max-info-gain@v7`), `tests/btree.axisrule-v8.test.mjs`, `tests/authoringgates.test.mjs`,
  `authoring/brain2/authoringGates.js`, `config/policy.json`, `docs/standards/certified-pipeline-contract.md`
  (round-8 §), consultation round-8.

## Context
Round-8 review showed v7's single decisive bound (reject only an all-singleton axis) has **zero false
positives but huge false negatives**: one size-2 option + 498 singletons passes, and 99% of shoppers get a
mirror. Root cause: mirror was framed as a **semantic** property (are the values product identities?), but the
constitutional harm is **behavioral** (one question that isolates candidates by itself) — and a size-1 leaf is
*legitimate* when it results from question INTERSECTION, a mirror only when one question produces it alone.
Two things were missing: a **published-options cap** (a 498-option question is unusable regardless), and the
mirror share was masked by a big "don't care" bucket. And the true semantic judgment belongs where the VALUES
are visible — the authoring gates — expressed as **relations, not ratios**.

## Decision — `max-info-gain@v8`, three layers each in its right place
1. **Decisive counts bound (kept):** no published option isolates >1 item ⇒ reject. Zero false positives; its
   large false negatives on wide catalogs are **recorded**, not relied upon.
2. **Options cap (the missing bound):** `max_published_options_per_question` — a question with more options
   than one display holds is unusable regardless of classification ⇒ the axis is **not branched** (routed to a
   ق20 display-mode decision) and reported. This is what actually stops the wide-catalog mirror the decisive
   bound misses. Threshold **derived from the display contract**, not a free number.
3. **Authoring gates (phase A, values visible) as RELATIONS** (`authoring/brain2/authoringGates.js`):
   `basis==name_token ∧ support==1` ⇒ the value is a product NAME (dropped; all-dropped ⇒ axis drops);
   `|distinct values|==|grounded products|` ⇒ a one-to-one NAMING (axis rejected); value≈product title ⇒
   ق19 merchant review (never auto-rejected).
- **Corrected mirror share:** `mirror_singleton_share` counts singletons over **value-confirming options
  only** (excludes u₀ AND any "don't care" option — both confirm no value), so a big don't-care bucket cannot
  mask a mirror. The RANKING keeps every bucket (don't-care and u₀ are real residuals). Justification: excluded
  because they **confirm no value**, not because they are unknown.
- **Permanent rule (recorded in the contract):** every gate is a relation or an evidence-basis; a gate needing
  a ratio/free-number is deferred until its denominator is derived from an existing contract.

## Surfaced for confirmation
`max_published_options_per_question = 8` is a **PROVISIONAL** value derived from the ق20 one-step-selector
display capacity (a mobile single-select stays scannable). It needs confirmation/derivation from the display
contract. On oud it is **inert** (max options per axis = 5). Flagged in `policy._v8_note`.

## Consequences
- **Red-first** (`tests/btree.axisrule-v8.test.mjs`): decisive bound kept; the decisive bound's large false
  negative demonstrated (499-option question passes without the cap) and shown caught by the options cap; the
  cap inert on a normal question; the corrected share (a big don't-care bucket does NOT dilute — share 1.0 vs
  the wrong 0.23); ranking keeps don't-care + u₀ (penalized = Σsᵢ²+u₀²). `tests/authoringgates.test.mjs`: the
  three relations (drop / reject / review) + a healthy axis passing untouched.
- **oud v7→v8 identical** (surface@cap 61, depth 2, reach ledger clean, 3 decisive all-singleton rejections);
  v8 adds the reported `published_options` per chosen axis (type 5 · origin 3/2 · budget 2 — all < cap).
  Generalize green on all three catalogs; eight stop conditions; full suite green; gold pins unchanged.
- The eligible-drop ledger (ADR-0054) and the two-denominator separation (ADR-0055) are unchanged.

## Follow-up (phase A, not this step)
A real "don't care / any" published option (so `confirms` is not trivially all-true) and wiring the authoring
gates into the phase-A axis derivation that feeds the oracle are phase-A work; here the gate logic is
implemented and unit-proven, and the brain defaults `confirms` to all-true (no such option exists yet).

## Files
`authoring/brain2/axisRule.js` (`diagnoseAxesV8`/`chooseAxisByInfoGainV8`) · `authoring/brain2/tree.js`
(`RULE_V8`, default; options-cap + signal sinks) · `authoring/brain2/authoringGates.js` (new) ·
`config/policy.json` (`axis_rule_id`, `max_published_options_per_question`, `_v8_note`) ·
`docs/standards/certified-pipeline-contract.md` (round-8 §) · `tests/btree.axisrule-v8.test.mjs`,
`tests/authoringgates.test.mjs` (new) · `tests/btree.{generalize,fulltree}.test.mjs` (SC1 → v8). **Not
touched:** compiler/Certifier, render, ingestion, wiring; gold.
