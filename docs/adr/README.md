# Architecture Decision Records (ADRs)

Every material decision on this platform is recorded here as a short, numbered,
immutable note: the **context**, the **options weighed**, the **decision**, and the
**consequences**. This is how we honor the rule *"every point documented, correctly,
before each step."*

Rules:
- One ADR per decision. Numbered, append-only. Never rewrite a decided ADR — supersede
  it with a new one (and mark the old one `Superseded by ADR-XXXX`).
- Write the ADR **before or with** the change it describes, not after the fact.
- Status ∈ `Proposed | Accepted | Superseded | Deprecated`.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-use-adrs.md) | Record architecture decisions in ADRs | Accepted |
| [0002](0002-dedicated-clean-repo.md) | Build as a new dedicated repository | Accepted |
| [0003](0003-engine-blend-start-from-v0.md) | Blend strategy: start from v0, merge production runtime in | Accepted |
| [0004](0004-zero-build-stack.md) | Keep the zero-build vanilla-ES-module stack | Accepted |
