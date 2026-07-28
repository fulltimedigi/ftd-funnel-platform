#!/usr/bin/env bash
# Layer-1 (PostToolUse) — fast per-file syntax guard. <1s, no extra dependencies: it uses
# `node --check` (Node is already required by this repo's tests), never eslint. It reads the edited
# file path from the hook's stdin JSON, skips anything that isn't a JS source (and its own hooks dir,
# to avoid a loop), and syntax-checks it. On a syntax error it FLAGS the file and feeds the error
# back to Claude via stderr + exit 2 (the edit is already on disk — this surfaces the problem for an
# immediate fix, it does not un-write the file). Exit 0 = pass. Never runs npm test here.
set -u

INPUT=$(cat 2>/dev/null || true)

# Parse the file path WITHOUT a silent dependency: prefer jq, fall back to node (guaranteed present
# whenever node --check can run), and if NEITHER exists say so loudly instead of passing silently.
extract_path() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(((j.tool_input||{}).file_path)||"")}catch(e){}})' 2>/dev/null
  else
    printf '%s' "__NO_PARSER__"
  fi
}
FILE_PATH=$(extract_path)

# neither jq nor node available → the guard is DEGRADED; make that visible, never a silent pass
if [ "$FILE_PATH" = "__NO_PARSER__" ]; then
  echo "⚠️  PostToolUse guard DEGRADED: neither jq nor node is available to read the hook input — cannot syntax-check this edit." >&2
  exit 0
fi

# 1) no file path in the payload → nothing to check
[ -z "$FILE_PATH" ] && exit 0

# 2) never check our own hook scripts (prevents a self-triggering loop)
case "$FILE_PATH" in
  */.claude/hooks/*) exit 0 ;;
esac

# 3) only JavaScript sources — `node --check` understands nothing else
case "$FILE_PATH" in
  *.js|*.mjs|*.cjs) : ;;
  *) exit 0 ;;
esac

# 4) file may have been deleted or renamed away — nothing to check
[ -f "$FILE_PATH" ] || exit 0

# node must exist to run the check itself; if it somehow doesn't, say so rather than pass silently
if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  PostToolUse guard DEGRADED: node not found — cannot syntax-check $FILE_PATH." >&2
  exit 0
fi

if ERR=$(node --check "$FILE_PATH" 2>&1); then
  exit 0
fi
echo "🔴 PostToolUse syntax guard: node --check FAILED on $FILE_PATH" >&2
printf '%s\n' "$ERR" >&2
exit 2
