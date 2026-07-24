# ADR-0036 — The Promise Principle: an ordered constraint ladder, grounded strictness, rule-level honesty, and a universal invariant

Status: Accepted · 2026-07-24 · unifies and generalises ADR-0034 (format hard) and ADR-0035 (budget hard)

## Context

ADR-0034 made **format** a hard filter and ADR-0035 made **budget** a hard ordinal band.
Each solved its own leak, but they were two special cases bolted on. Three gaps remained:

1. **No stated order between the hard axes.** When a (format × budget) cell is genuinely
   empty, *which* constraint should bend? The old code relaxed budget by nearest tier, but
   there was no principle saying format outranks budget, or what a third hard axis would do.
   Worse, the fallback path could drop to the `overall` pool and quietly cross the format
   line — the very thing ADR-0034 forbids.
2. **Strictness wasn't gated on truth.** A hard axis is a *promise*. If the value the shopper
   picked was **AI-guessed** rather than **extracted from the real catalog**, enforcing it
   strictly would filter real products against a made-up label — fabrication by omission.
   Nothing distinguished a grounded axis (format from the title, price from the real price)
   from a soft, AI-authored one (a "character" the model imagined).
3. **Disclosure was silent for soft misses.** ADR-0035 disclosed a *relaxed hard tier*, but
   when a **soft** axis (character/intensity) couldn't be honoured — because the anti-bland
   gate caps how hard we can partition — the rule said nothing. The shopper's answer differed
   from the product on a dimension they were asked about, with no note. Honest, but not
   transparent.

The operator framed the fix as a single law: **"The Promise Principle — if we ask it, we
either honour it or we say we didn't."** This ADR makes that law structural and permanent.

## Decision

### 1. An ordered constraint ladder (`_assignCovering`)

The hard axes form a **ranked ladder**, top-to-bottom, in the order they enter the axis set:
**rank-1 = format, rank-2 = budget, rank-3+ = any further grounded categorical.** For each
decision cell (`poolFor`):

- Filter products by **all** active hard axes.
- If the cell is empty, **drop the lowest-rank hard axis** and refilter. Repeat.
- **Rank-1 (index 0) never drops** — format is absolute; the loop stops before touching it.
- Every dropped rank is recorded in `relaxedByCombo` for that cell.

The fallback **never falls to the `overall` pool** ignoring rank-1 (the old line-97 bug).
The worst case is "same format, nearest of everything else" — never a cross-format pick.
Within a relaxed cell, `selScore` prefers the **nearest** product on a relaxed *ordinal*
axis (so a relaxed price is honestly the closest band), then the best soft match. Soft
mismatches carry a real cost (`SOFT_MISS = -0.5`), so a full soft match always wins its cell.

### 2. Grounded strictness — an axis is hard only if it is real

A value can be enforced strictly **only if every value on that axis is extracted from real
product data**, never AI-imagined:

- `format` derives from the product title / `attributes.type` / tags (`formatAxis.js`).
- `budget` derives from the real cleaned prices, tertile tiers (`budgetAxis.js`).
- Any further categorical is promoted to hard only when it resolves from
  `attributes.type` / `differentiators` / name tokens on the real catalog.
- **AI-guessed axes stay soft.** In the AI path, `designToAxes` (`enrichAuthor.js`) already
  drops any product-value it can't confirm against the real catalog — a URL that isn't real
  or a value outside the axis domain never enters the profile — and `authorFromAxes` then
  makes only `[format, budget]` hard, keeping every model-proposed axis soft. So the model
  can never manufacture a hard filter out of an imagined attribute. A soft axis that a
  shopper answered but the winner doesn't match is **disclosed** (rule 3), not hidden.

This is the truth gate on strictness: **we only hold a product to a promise the catalog can
keep.** It also keeps us inside the anti-bland gate — categoricals with few products per
value stay soft (so no single question dominates >50%), yet no answer goes unaccounted for.

### 3. Rule-level honesty — disclose every unhonoured answer, never the archetype

`buildConfig` computes `relaxedFor(combo)` for every rule and, when non-empty, attaches
`rule.relaxed = [{ axis, label, dir?, soft? }]`:

- **Relaxed hard axis** (the ladder dropped it because the cell was empty): disclosed with
  its human label; for an ordinal axis the direction (`dir: "above" | "below"`) says whether
  the nearest available band is pricier or cheaper.
- **Soft miss** (the shopper's soft answer ≠ the winner's value): disclosed with `soft: true`.
  This is the new coverage over ADR-0035 — every asked dimension the result doesn't satisfy
  is on the record.

The runtime threads this through: `decide` → `ruleId`, `resolve` → `scoring.ruleId`, and
`resultRenderer.relaxNote(config, resolved)` renders a plain-Arabic note on the result card:
**"أقرب اختيار متاح — "** followed by each difference — **"يختلف في: [الفرق]"** for a
categorical, and for price **"أعلى قليلاً من الميزانية المختارة"** / **"أقل من الميزانية
المختارة"** by direction. The note only renders for a rule that actually carries `relaxed`
— the archetype/default safety-net rule (no `when`) never does. Silence is never the
default; a relaxation always speaks.

### 4. Coverage floor preserved

The ladder still assigns every product a home cell first (Pass 1, `relaxed:[]`), then fills
remaining cells via the ladder (Pass 2). Coverage stays at/above the richness floor (~100%
reachable); no product is orphaned by the added strictness.

### 5. A permanent, store-agnostic invariant test

`tests/invariant.universal.test.mjs` (derived from the operator's
`audits/promise-invariant.mjs`) runs the **real** authoring pipeline on a battery of four
diverse synthetic stores — oud perfume, laptops, supplements, coffee — and, for every rule
of every funnel, asserts the Promise Principle directly:

- **rank-1 is honoured exactly, always** (`config.constraintLadder[0]` is never overridden);
- **every lower unhonoured axis is disclosed** on `rule.relaxed` — a single silent override
  on any store fails the build;
- **coverage ≥ 90%** per store.

`buildConfig` now emits `config.constraintLadder = [hard axis ids, in rank order]` so the
test (and any future audit) can read the promise ladder straight off the config.

## Consequences

- **Zero silent overrides, on any vertical.** The battery run: **4 stores, 102 rules, 64 of
  them carrying an honest relaxation disclosure, and zero silent overrides.** Rank-1 (format)
  was never relaxed in any store. The invariant now fails the build if that ever regresses —
  the promise is enforced by CI, not by vigilance.
- **Strictness never fabricates.** Because a hard axis must be fully grounded, the engine
  never filters real products against an AI-imagined label; unconfirmable values stay soft
  and, if they affect the pick, are disclosed. This reconciles hard constraints with the
  no-fabrication law and with the anti-bland gate (which caps hard partition depth).
- **The shopper is never quietly under-served.** When the ideal cell is empty, the result
  says exactly how the pick differs (form is absolute; price/other differs, with direction).
- **Gates untouched.** `trustValidate`, the anti-bland gate, and the richness floor are
  unchanged and still green; deterministic runtime; both authoring paths (facts and AI).
  Preview only; live untouched. No PR.
