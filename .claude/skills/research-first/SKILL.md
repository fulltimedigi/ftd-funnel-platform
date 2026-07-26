---
name: research-first
description: >
  Use the moment you hit uncertainty, ambiguity, or a knowledge gap in a task —
  BEFORE choosing an approach, guessing an API / library version / config key /
  price / name / URL / endpoint, or writing hedges like "probably", "I think",
  "should be", "likely", "usually", or "I'll assume". Instead of inventing a
  solution from memory, STOP and do deep research first (codebase → primary docs →
  authoritative web sources, cross-checked), then decide from evidence and cite it.
  Triggers whenever: you're unsure how something actually works; there are several
  plausible approaches with no clear basis to choose; you're relying on memory for
  something that changes (pricing, model IDs, API params, library versions, product
  facts); or you feel any pull to fabricate a value just to keep moving.
---

# Research First — never invent when you're unsure

**The one law:** When you are uncertain, you research. You do **not** make up an
answer, a value, or an approach from your own head to keep moving. A confident guess
that turns out wrong costs far more than the minutes of research it replaces — and in
this project, fabrication violates the trust laws directly (F3, "research the best
scenario first"; the no-fabrication rule; "never report success you can't confirm").

This is not "research everything." It's: **the instant a step becomes uncertain,
switch from generating to investigating — first.**

## Recognize the moment (uncertainty signals)

Any one of these means STOP and research before you write the solution:

- You're about to type a hedge: *probably, I think, should be, likely, usually,
  I'll assume, from memory, if I recall.*
- You're guessing a concrete fact that has a real answer: an API signature or
  parameter, a library/model version, a config key, a price, a rate limit, a file
  path, a function name, a URL, an endpoint, a schema field.
- There are 2+ plausible approaches and you don't have a real basis to pick one
  (you'd be choosing by vibe, familiarity, or what "feels" standard).
- The requirement itself is ambiguous — you're filling the gap with an assumption
  about what the user/spec meant.
- You're relying on memory for something that **changes over time** (pricing, model
  IDs, SDK APIs, framework behavior, competitor facts, market data).
- You notice the pull to invent a plausible-looking value just so the code/plan runs.

## The research protocol (in order)

1. **Name the unknown, out loud.** Write one sentence: "I'm unsure about X, and I
   was about to assume Y." Naming it stops the auto-fill.
2. **Look inside first.** Read the actual source of truth before the outside world:
   the codebase (Grep/Glob/Read), the repo's `docs/`, ADRs, standards, existing
   configs and tests. Most "unknowns" are already decided somewhere in the repo.
3. **Then go to primary sources.** Official docs, the library's own README/source,
   the spec. Prefer primary over blog/summary. For anything about Claude / Anthropic
   / an LLM (pricing, model IDs, params, caching), load the `claude-api` skill and
   use it — do not answer from memory.
4. **Cross-check external facts.** For anything from the web, confirm with **≥2
   independent, authoritative sources** before you rely on it. One source is a lead,
   not a fact.
5. **Verify, don't assume, when you can.** If it's checkable — run it, read the type,
   hit the endpoint read-only, grep the definition — do that instead of trusting a
   description.

## Decide, then record

- Choose from the **evidence**, not the first idea. State *why* the evidence points
  this way, and **cite the source** (file:line for code, URL for web).
- If the choice is material (architecture, dependency, an approach that's hard to
  reverse), write an **ADR** — that's the project rule, and it captures the research
  so it isn't repeated.

## If it's still unknown after honest research

Say so, plainly. Do **not** close the gap with invention. State what you found, what
remains unresolved, and the options — and ask, or mark it Blocked (OS-5: an honest
Blocked is a valid outcome). "I don't know yet, here's what I checked" beats a
confident wrong answer every time.

## Anti-patterns (never do these)

- Shipping a guessed value/name/version because "it's probably right."
- Picking an approach because it's familiar, without checking it fits *this* codebase.
- Answering a changeable fact (pricing, model IDs, API shape) from memory.
- Presenting an assumption as if it were confirmed.
- Researching *after* you've already written the solution, to justify it.

> Uncertainty is a signal, not an obstacle. When it fires, research first — then act.
