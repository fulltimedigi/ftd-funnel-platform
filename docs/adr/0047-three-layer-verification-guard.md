# ADR-0047 — Three-layer verification guard (hooks + judgment review + CI)

- **Status:** Accepted (Layer 1 built & proven; Layer 2 checklist authored; Layer 3 relies on branch CI)
- **Date:** 2026-07-28
- **Related:** ADR-0041..0046 (the gates the guard runs), `docs/standards/review-checklist-vs-vision.md`,
  `docs/standards/funnel-constitution.md`, `docs/standards/certified-pipeline-contract.md`.

## Context

The platform's correctness rests on a large green suite (97 suites) and several binding gates (trust,
anti-bland, publish gate, mandatory certificate, oracle invariants). Nothing enforced these *during*
building — a broken edit or a red suite could sit unnoticed until someone remembered to run `npm test`.
We want problems caught the moment they happen, and surfaced immediately, without lowering the bar or
adding dependencies (the repo is dependency-free by design).

## Decision

A guard on three layers, all in `ftd-funnel-platform`:

### Layer 1 — automatic hooks (`.claude/settings.json` + `.claude/hooks/*.sh`)

- **`PostToolUse` (matcher `Edit|Write|MultiEdit`) → `quick-syntax-check.sh`** — a <1s guard that adds no
  extra dependency: it uses `node --check` (Node is already required by the suite), never eslint. It
  reads `.tool_input.file_path` (via `jq`, falling back to `node` if `jq` is absent — a total absence is
  a loud stderr warning, never a silent pass), skips non-JS files and its own hooks dir (loop guard), and
  syntax-checks. On a syntax error → stderr + **exit 2**, which FLAGS the file and feeds the error back to
  Claude (the edit is already written to disk; exit 2 surfaces it for an immediate fix — it does not
  un-write the file). Never runs the suite here.
- **`Stop` (empty matcher) → `full-gate.sh`** — runs the complete `npm test` (which itself chains trust,
  anti-bland, config/schema validation, kernel + oracle safety, reachability, frozen-gold pins) under an
  internal `timeout`. A genuine suite **failure** → last ~20 lines to stderr + **exit 2**, so Claude keeps
  fixing before the turn can close. Green → exit 0. Two deliberate distinctions: **infra** Claude can't fix
  by editing code (npm/`node_modules` missing, a dependency that won't load) is a **non-blocking warning**
  (exit 0), consistent with SessionStart — so a broken toolchain never wedges the session; and a **hang**
  is treated as a **block** (the `timeout` fires → exit 2), never a silent kill that closes the turn unverified.
- **`SessionStart` (empty matcher) → `session-start-setup.sh`** — verifies Node; `npm install` if
  `node_modules` is missing. **Never blocks** session start (always exit 0; warns on stderr only).

Convention: **exit 2 = block with a stderr message; exit 0 = pass** (exit 1 is NOT used to block).
Progress/logging goes to stderr, never stdout. Hook commands use `$CLAUDE_PROJECT_DIR` for portability.

### Layer 2 — judgment review

After each part, run the read-only **`ftd-critic`** agent against
`docs/standards/review-checklist-vs-vision.md` (the 8 vision-constitution checks: no runtime LLM;
evidence→claim→mapping; no product/CTA without a kernel SelectionResult; two-matrix separation; versions
stamped; no hard violation / silent compromise / unaccounted SKU / silently-ignored answer;
HONEST_NO_MATCH → internal CTA; bundle-reachability + SKU-path-witness tests exist). A red item ⇒ fix or
a declared gap in `docs/KNOWN-GAPS.md` — silence is never a pass.

### Layer 3 — on push

Branch CI runs the same suite; PR monitoring/notification is handled from the review session.

## How it was proven (not asserted)

- **PostToolUse:** fed the exact stdin JSON for a valid `.mjs` (exit 0), a `.md` (exit 0, skipped), a
  hooks-dir file (exit 0, loop guard), an empty path (exit 0), and a **syntactically broken `.mjs`**
  (exit 2 + stderr). The settings command string, expanded with `$CLAUDE_PROJECT_DIR`, also returned
  exit 2 on the broken file.
- **Stop gate:** ran green (exit 0); then a **deliberate failing assertion** was injected into the first
  suite → gate returned **exit 2** with the failure in the tail; reverted → exit 0 again.
- **SessionStart:** detected a missing `node_modules`, installed it, exit 0.
- **JSON/schema:** `jq -e` confirms each of the three hook commands is wired at the right event+matcher.

**Live-firing caveat (honest):** because no `.claude/settings.json` existed when this session started,
the config watcher is not watching `.claude/` this session — a live Write of a broken `.js` was NOT
blocked in-session. The scripts and wiring are correct and proven; the hooks go live after the operator
opens `/hooks` once (reloads config) or starts a new session. This is a Claude Code watcher limitation,
not a defect in the guard.

## Round-1 review fixes (ftd-critic, applied before commit)

The read-only critic found no blocker but three real `should-fix` items; all were applied and re-proven:

- **Silent-`jq` no-op removed** — the PostToolUse guard now parses stdin with `jq` **or** a `node`
  fallback, and warns loudly if neither exists. A missing `jq` no longer silently passes every edit.
  (Proven: with `jq` hidden from PATH, a broken `.mjs` still returns exit 2 via the node fallback.)
- **Stop gate no longer hard-blocks on infra** — npm/`node_modules` missing or a dependency-load error is
  a non-blocking warning (exit 0), matching SessionStart; only a real suite failure blocks. (Proven: npm
  hidden → exit 0; a broken test → exit 2.)
- **Timeout ≠ silent pass** — the suite runs under an internal `timeout`; a hang returns exit 2 (block)
  with a clear message rather than being silently killed.

Two wording corrections the critic flagged were also made: the guard is "no **extra** dependency" (the
repo does declare `@netlify/blobs`), and PostToolUse "flags + feeds the error back" rather than "blocks"
(the edit is already on disk when the hook runs).

## Consequences

- **Positive:** syntax errors and red suites are caught at the moment of the edit / turn-close, with the
  real error handed back for immediate fixing; zero new dependencies; the vision checklist gives the
  human/critic layer a concrete, code-anchored rubric.
- **Cost:** the Stop gate runs the full suite each turn (seconds today; if it grows, split a fast subset
  for Stop and keep the full suite for push).
- **Loop safety:** the Stop gate blocks on failure by design (block-until-green); Claude Code's built-in
  stop-hook continuation limit bounds pathological loops. If ever needed, `stop_hook_active` from stdin
  can gate a second consecutive block.
- **Not covered by Layer 1:** semantic/vision violations that are still green (e.g. a silent compromise
  that passes tests) — that is exactly what Layer 2's checklist exists to catch.
