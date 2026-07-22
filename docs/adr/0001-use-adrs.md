# ADR-0001 — Record architecture decisions in ADRs

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

This platform is being built to a high bar: clean, and with every decision
documented and justified *before* it is implemented. Decisions made only in chat or
in commit messages get lost; a new contributor (human or Claude) then re-litigates or,
worse, silently violates them.

## Decision

Use lightweight **Architecture Decision Records** in `docs/adr/`. Each is a numbered,
append-only Markdown file capturing context → options → decision → consequences.
Decisions are made with research (the "best scenario per step" rule), and the research
basis is cited in the ADR.

## Consequences

- Slightly more upfront writing per decision.
- A durable, auditable trail: anyone can read `docs/adr/` and understand *why* the
  system is the way it is, without archaeology.
- Superseding (not editing) keeps history honest.
