# ADR-0002 — Build as a new, dedicated repository

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

The product ("brand URL → grounded funnel") could be built inside the existing
`ftd-studio` repo, or in a new repo. `ftd-studio` is the **operator control panel** —
a Node/Express dashboard. The funnel platform is a different thing: a zero-build
front-end engine + an AI authoring layer, destined to be hosted at fulltimedigi.com.

Options considered:
1. **Inside `ftd-studio`.** Fewer repos. But it mixes a stateful Express control panel
   with a static funnel engine + AI pipeline — two different runtimes, deploy targets,
   and lifecycles in one repo. Muddies both.
2. **New dedicated repo** (`ftd-funnel-platform`). Clean separation of concerns:
   Studio *drives* the platform; the platform *is* the product.

## Decision

New dedicated repo: **`ftd-funnel-platform`**. `ftd-studio` remains the operator UI
and calls into this platform; this repo owns the engine, the authoring layer, and the
public site that ships to fulltimedigi.com.

## Consequences

- One more repo to hold, but each has a single clear job and deploy target.
- The platform can go public (fulltimedigi.com) independently of the private Studio.
- Note: repo creation required the account owner (the GitHub integration used here
  lacks repo-creation permission); the repo was created manually and this codebase
  pushed to it.
