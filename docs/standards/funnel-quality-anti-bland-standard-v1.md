# FullTimeDigi Funnel Quality Standard v1 — The Anti-Bland Gate

## STATUS

**NON-NEGOTIABLE.** Applies to every funnel this platform produces — whether authored
by the AI (Stage 2) or by hand. A funnel that trips any pattern below is **rejected and
regenerated**, never shipped. Never weaken the gate to make a funnel pass — fix the funnel.

This standard extends the 12-rule **Decision Funnel Design Standard v1**
(`decision-funnel-design-standard-v1.md`) with an **automated** quality gate, because
some "bland" patterns pass the current runtime trust gate today (see the Critical Gap).

---

## What "bland" means

A bland funnel gives itself away or asks for nothing that matters. It feels like a form,
not a diagnosis. The user senses there is no real intelligence behind it, and trust —
the whole value of a decision funnel (RULE 10) — collapses. The four bland patterns:

### 1. Mirror / exposed question  — REJECT
A question that **asks for the product or the goal directly**, or whose answer maps
**1:1 to the result**. It reveals the product from the first move instead of *deriving*
it.

- ❌ "Which oud do you want?" · "Which certification are you after?" · "What's your goal?"
- ✅ Ask **facts the user already knows about themselves** — experience, field, level,
  budget, occasion, current situation — and let the engine **compute** the product.

> **Critical gap this closes:** the runtime trust gate (`engine/trustValidate.js`, TV2)
> rejects a **dead** question (one that has *no effect* on the outcome). It does **not**
> catch a **mirror** question — because a mirror question *does* affect the outcome (it
> determines it 1:1). So a mirror question passes today. **This standard adds the mirror
> check.** A question whose single answer determines the result with no derivation is a
> mirror, and is rejected even though it "affects the outcome."

### 2. Single-question dominance  — REJECT
No single question may decide **more than ~40%** of the outcome on its own. If one
question's answer fixes the result regardless of the others, redistribute the signal or
redesign the question. (Ported from ftd-os L2 `.claude/rules/layer-2-architecture.md`.)

### 3. Unjustified question  — REJECT (RULE 4)
For every question: if its answer changes, can the recommendation change, the ranking
change, a result be excluded, or an offer be optimized? If **no** → the question is
theater → delete it.

### 4. Unjustified result  — REJECT (RULE 9 / RULE 11)
Every result must carry a **defensible** explanation: *why this*, *why not the
alternatives*, a **real SKU with a real URL**, and a next action. Any statement not
traceable to a collected signal or a decision rule is removed. No fabricated reasons.

---

## Enforcement (how this is actually guaranteed)

1. **Automated gate.** The authoring layer (`authoring/`) must run an anti-bland gate on
   every generated config, alongside `trustValidate`. A config that trips any pattern is
   **rejected and regenerated** — the AI does not get to ship a bland funnel.
2. **Tests with teeth.** A synthetic **mirror** funnel and a **single-question-dominant**
   funnel must be *rejected* by the gate; a sound funnel must *pass*. "A gate that can't
   fail is theater."
3. **No weakening.** If a generated funnel fails the gate, fix the generation (ask better
   fact-based questions, redistribute signal, ground the result). Never relax the gate.

---

## Relationship to existing law

| Source | Covers |
|--------|--------|
| `decision-funnel-design-standard-v1.md` (RULES 1–12) | Results-first, facts-before-questions, defensible results, no fake intelligence |
| ftd-os `.claude/rules/layer-2-architecture.md` | facts-not-goals, 40% dominance, why-not, real-SKU gates |
| `engine/trustValidate.js` (TV1–TV5) | dead-end sweep, no-fake-intelligence linter, defensibility, next-action |
| **This standard** | the **mirror-question** and **dominance** checks the runtime gate does not yet enforce — made automated for AI-authored funnels |

---

## FINAL PRINCIPLE

A filter asks you what you want and hands it back. A **decision funnel** asks you facts
and tells you something you didn't know, with reasons you can trust. If a generated
funnel could have been a dropdown menu, it is bland — reject it.
