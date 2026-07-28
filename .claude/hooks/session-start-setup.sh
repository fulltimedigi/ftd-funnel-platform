#!/usr/bin/env bash
# Layer-1 (SessionStart) — make sure the toolchain is ready so the other two hooks can run. Verify
# Node is present; if node_modules is missing, install it. This hook NEVER blocks session start:
# every path exits 0 (it only warns on stderr), so a missing toolchain degrades gracefully instead
# of wedging the session.
set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  SessionStart: Node not found on PATH — tests and the verification hooks won't run until Node is installed." >&2
  exit 0
fi

# jq is the PostToolUse guard's preferred input parser (it falls back to node, but flag a missing jq
# up front so a degraded-but-still-working Layer 1 is visible rather than a surprise).
if ! command -v jq >/dev/null 2>&1; then
  echo "ℹ️  SessionStart: jq not found — the PostToolUse syntax guard will fall back to node for parsing (still works; install jq to silence this)." >&2
fi

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "ℹ️  SessionStart: node_modules missing — running npm install…" >&2
  if ( cd "$PROJECT_DIR" && npm install --no-audit --no-fund ) >&2 2>&1; then
    echo "✅ SessionStart: dependencies installed." >&2
  else
    echo "⚠️  SessionStart: npm install failed — run 'npm install' by hand before relying on the gate." >&2
  fi
fi
exit 0
