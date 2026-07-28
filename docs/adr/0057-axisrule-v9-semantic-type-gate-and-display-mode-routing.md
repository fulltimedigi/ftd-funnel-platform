# ADR-0057 — Axis-rule v9: semantic-type homogeneity gate + display-mode routing (per node)

- **Status:** Accepted (implemented + proven); certification + wiring still NOT started.
- **Date:** 2026-07-28
- **Related:** ADR-0056 (`max-info-gain@v8`), `tests/btree.axisrule-v9.test.mjs`, `tests/authoringgates.test.mjs`,
  `authoring/brain2/authoringGates.js`, `config/policy.json` (`display_contract`),
  `docs/standards/certified-pipeline-contract.md` (round-8 §), consultation round-9.

## Context
Round-9 review found all three v8 layers key on `support==1` or exact equality, so a **product-line disguised
as a value** — e.g. `katana` among origins, **2 SKUs per line** — escapes all of them (support=2, and
`|values|≠|products|`). This is a historical bug (a product line entered as an origin value). The fix is not a
fourth guard but wiring an **existing constitutional guard: semantic-type homogeneity** — the evidence-trace
law (`Option → Normalized semantic value → …`): all values must be ONE normalized semantic type; mixing origin
with product-line ⇒ reject regardless of counts. Two more corrections: the options cap is **owned by the
display layer** (the brain reads it, never derives it), and **exceeding it — or an all-singleton axis — routes
the node to a ق20 display mode, it does not reject the axis** (rejecting loses legitimate information; ق20 is a
per-node decision). And `|values|==|products|` must be replaced by an **evidence-basis** gate.

## Decision — `max-info-gain@v9`
1. **Semantic-type homogeneity (authoring gate, phase A):** values must share one normalized `semantic_type`;
   a mix ⇒ reject the axis regardless of counts/sizes. THIS is the only guard that catches katana.
2. **Options cap owned by the display contract:** moved to `policy.display_contract.max_published_options_per_question`
   (owner = the render/ق20 layer; PROVISIONAL with a declared owner until GAP-7 is built). The brain READS it.
3. **Display-mode routing (per node), not rejection:** in the counts-only brain, an axis that cannot be
   BRANCHED for a DISPLAY reason — options count > cap, or all-singleton — ROUTES that node to a ق20 display
   mode (grid/selector) and is reported (`tree.displayModeNodes`), instead of being rejected. Genuine
   non-viability (no-split / mostly-compromise) stays a rejection. Rationale: a legit unique-per-product axis
   is a grid, and a product-naming was already rejected upstream at the authoring gates.
4. **Evidence-basis gate replaces `|values|==|products|`:** reject only when every value is product-identity-
   derived (`name_token`) with no independent vocabulary; a catalog-INDEPENDENT vocabulary (structured field ·
   variant option · taxonomy) is a real axis EVEN IF each value is unique to one product. Count-equality is now
   a reported signal, not a rejection.
- **Permanent rule (recorded):** gates are relations or evidence-basis; a numeric threshold is accepted only
  when derived from an existing policy key OR a contract **owned by non-brain** — a number without a declared
  owner is a rejected free number.

## Consequences
- **Red-first** (`tests/btree.axisrule-v9.test.mjs`): the cap is read from `display_contract` (absent from
  `authoring_tree`); all-singleton ⇒ display mode (not rejected); over-cap ⇒ display mode; genuine
  non-viability stays a rejection; a branchable axis still wins with a co-present display-mode axis.
  (`tests/authoringgates.test.mjs`): **the katana case** — a product-line among origins (2 SKU/line) — is
  rejected by the semantic-type guard, not by counts; an all-name_token axis is rejected (evidence-basis); a
  **unique-per-product axis on an independent vocabulary (variant option) is ACCEPTED** (count-equality only a
  signal); title-resemblance → review; a healthy axis passes.
- **oud v8→v9 identical structure** (surface@cap 61, depth 2, reach ledger clean, 80/80): the 3 v8 mirror
  REJECTIONS on `origin` (all-singleton nodes) become 3 v9 DISPLAY-MODE routings — information kept, not
  rejected; zero rejections. Options cap inert on oud (max 5 options/axis < 8). Generalize green on all three
  catalogs; eight stop conditions; full suite green; gold pins unchanged.
- The eligible-drop ledger (ADR-0054), the two-denominator separation (ADR-0055), and the confirming-only
  share (ADR-0056) are unchanged.

## Follow-up (phase A, not this step)
Normalizing each value's `semantic_type` (design-time LLM authoring) and wiring `authoringGates` +
`display_contract` into the phase-A axis derivation that feeds the oracle are phase-A work; here the gate logic
and the routing are implemented and unit-proven.

## Files
`authoring/brain2/axisRule.js` (`diagnoseAxesV9`/`chooseAxisByInfoGainV9`) · `authoring/brain2/tree.js`
(`RULE_V9`, default; displayMode sink) · `authoring/brain2/authoringGates.js` (semantic-type + evidence-basis) ·
`config/policy.json` (`display_contract`, `axis_rule_id`, `_v9_note`) · `tests/lib/oudUnits.mjs` (cap from
display_contract) · `tests/btree.axisrule-v9.test.mjs`, `tests/authoringgates.test.mjs` · `tests/btree.{generalize,fulltree}.test.mjs`
(SC1 → v9). **Not touched:** compiler/Certifier, render, ingestion, wiring; gold.
