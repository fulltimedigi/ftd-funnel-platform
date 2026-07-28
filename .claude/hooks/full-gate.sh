#!/usr/bin/env bash
# Layer-1 (Stop) — the FULL verification gate, once per turn. Runs the complete test suite via the
# real package.json script `npm test`, which itself chains every gate: trust, anti-bland, schema/config
# validation, kernel + oracle safety, reachability, and the frozen-gold pins. On a genuine SUITE
# FAILURE it prints the last ~20 lines and exits 2 so Claude keeps fixing before the turn can close.
#
# Two deliberate distinctions (from the round-1 critic review):
#   • INFRA problems Claude cannot fix by editing code (npm missing, node_modules missing, a dependency
#     that won't load) are NON-BLOCKING warnings — consistent with SessionStart's graceful degradation,
#     so a broken toolchain never wedges the session in a block-loop.
#   • A HANG is not a pass: the suite runs under an internal `timeout`, and a timeout is treated as a
#     BLOCK (exit 2) with a clear message — never a silent harness kill that closes the turn unverified.
set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$PROJECT_DIR" || { echo "⚠️  Stop gate: cannot cd into project dir ($PROJECT_DIR) — not blocking." >&2; exit 0; }

# ── INFRA (non-blocking) ───────────────────────────────────────────────────────────────────────
if ! command -v npm >/dev/null 2>&1; then
  echo "⚠️  Stop gate: npm not on PATH — cannot run the suite (environment issue, not a code defect). NOT blocking." >&2
  exit 0
fi
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "⚠️  Stop gate: node_modules missing — cannot run the suite. Run 'npm install'. NOT blocking (infra)." >&2
  exit 0
fi

# ── run the suite under an internal timeout so a hang BLOCKS instead of silently closing ─────────
INTERNAL_TIMEOUT=540
if command -v timeout >/dev/null 2>&1; then
  LOG=$(timeout "$INTERNAL_TIMEOUT" npm test 2>&1); STATUS=$?
else
  LOG=$(npm test 2>&1); STATUS=$?
fi

if [ "$STATUS" -eq 0 ]; then
  echo "✅ Stop gate: full suite green (npm test)." >&2
  exit 0
fi

if [ "$STATUS" -eq 124 ]; then
  echo "🔴 Stop gate: suite TIMED OUT (>${INTERNAL_TIMEOUT}s) — a hang is not a pass. BLOCKING." >&2
  exit 2
fi

# a dependency that won't load is infra (npm install territory), not a code defect → non-blocking
if printf '%s' "$LOG" | grep -qE "Cannot find (module|package) '@|ERR_MODULE_NOT_FOUND[^\\n]*node_modules"; then
  echo "⚠️  Stop gate: the suite could not load a dependency (environment issue, not a code defect). Run 'npm install'. NOT blocking." >&2
  printf '%s\n' "$LOG" | tail -8 >&2
  exit 0
fi

echo "🔴 Stop gate: FULL SUITE FAILED (npm test). Fix before closing. Last 20 lines:" >&2
printf '%s\n' "$LOG" | tail -20 >&2
exit 2
