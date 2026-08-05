#!/usr/bin/env bash
# check-freeze.sh — PreToolUse hook for /freeze skill
#
# Reads the PreToolUse JSON payload on stdin (tool_input.file_path per the
# freeze/SKILL.md hook contract) and denies the edit if the target resolves
# outside the active freeze boundary (state file: $STATE_DIR/freeze-dir.txt).
#
# Output contract: the harness's PreToolUse dispatcher ONLY honours a
# response shaped as
#   {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<text>"}}
# to block a tool call — it takes the blocking text from
# hookSpecificOutput.permissionDecisionReason. A bare, unwrapped
# {"permissionDecision":"deny","message":"..."} (the old shape this script
# used to emit) is not recognised at all: the dispatcher never sees a deny
# and the tool call proceeds as if nothing fired. The allow paths emit `{}`
# and exit 0, which means "no decision, fall through to normal permission
# flow" — this IS honoured as allow (verified live), so it is left as-is
# rather than switched to an explicit hookSpecificOutput allow shape, which
# would instead mean "auto-approve, bypass the permission system" for every
# Edit/Write in every session (this hook's near-universal early-exit path).
set -euo pipefail

# Read stdin
INPUT=$(cat)

# Locate the freeze directory state file
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.gstack}"
FREEZE_FILE="$STATE_DIR/freeze-dir.txt"

# If no freeze file exists, allow everything (not yet configured)
if [ ! -f "$FREEZE_FILE" ]; then
  echo '{}'
  exit 0
fi

FREEZE_DIR=$(tr -d '[:space:]' < "$FREEZE_FILE")

# If freeze dir is empty, allow
if [ -z "$FREEZE_DIR" ]; then
  echo '{}'
  exit 0
fi

# Extract file_path from tool_input JSON.
# Prefer python3: it correctly parses JSON string escapes (e.g. a Windows
# path like "C:\\Users\\..." unescapes to C:\Users\...). The grep/sed
# heuristic below does NOT unescape — it only strips the surrounding quotes
# — so on backslash-heavy paths it leaves literal doubled backslashes in
# FILE_PATH. It is kept only as a fallback for environments without python3;
# harmless even then, since this Git Bash's dirname/basename/cd accept
# backslash path separators directly (including doubled ones) further down.
FILE_PATH=""
if command -v python3 >/dev/null 2>&1; then
  FILE_PATH=$(printf '%s' "$INPUT" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)
fi

if [ -z "$FILE_PATH" ]; then
  FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//;s/"$//' || true)
fi

# If we couldn't extract a file path, allow (don't block on parse failure)
if [ -z "$FILE_PATH" ]; then
  echo '{}'
  exit 0
fi

# Resolve file_path to absolute if it isn't already. A native Windows path
# (e.g. "C:\Users\..." from tool_input) doesn't start with "/" but IS
# already absolute — treat a drive-letter prefix as absolute too, or this
# branch prepends $(pwd)/ and corrupts it into garbage. (Do NOT rewrite
# backslashes to forward slashes here: this Git Bash's dirname/basename/cd
# already accept backslash separators, and `cd` on a native "C:\..." path
# resolves through the MSYS mount table the same way `cd`+`pwd` did when
# /freeze's setup step wrote freeze-dir.txt — forcing an alternate /c/...
# spelling ourselves bypasses that mount remap and makes the two forms
# diverge instead of match.)
case "$FILE_PATH" in
  /*) ;; # already absolute (POSIX)
  [A-Za-z]:[/\\]*) ;; # already absolute (Windows drive-letter)
  *)
    FILE_PATH="$(pwd)/$FILE_PATH"
    ;;
esac

# Normalize: remove double (forward-)slashes and trailing slash
FILE_PATH=$(printf '%s' "$FILE_PATH" | sed 's|/\+|/|g;s|/$||')
FREEZE_DIR=$(printf '%s' "$FREEZE_DIR" | sed 's|/\+|/|g;s|/$||')

# Resolve symlinks, "..", and (on Windows) the drive-letter/mount form, via
# cd + pwd -P — POSIX-portable, works on macOS/Linux, and on this platform
# is also what canonicalises "C:\Users\...\AppData\Local\Temp\..." and
# "/tmp/..." to the same physical path when they name the same directory.
_resolve_path() {
  local _dir _base
  _dir="$(dirname "$1")"
  _base="$(basename "$1")"
  _dir="$(cd "$_dir" 2>/dev/null && pwd -P || printf '%s' "$_dir")"
  printf '%s/%s' "$_dir" "$_base"
}
FILE_PATH=$(_resolve_path "$FILE_PATH")
FREEZE_DIR=$(_resolve_path "$FREEZE_DIR")

# JSON-escape a string for safe interpolation into a double-quoted JSON
# value (backslash and double-quote are the two characters that matter for
# the paths/messages this script emits; this is what the old code skipped,
# which meant a deny for a Windows path emitted syntactically invalid JSON).
_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/}"
  printf '%s' "$s"
}

# Check: does the file path start with the freeze directory?
case "$FILE_PATH" in
  "${FREEZE_DIR}/"*|"${FREEZE_DIR}")
    # Inside freeze boundary — allow
    echo '{}'
    ;;
  *)
    # Outside freeze boundary — deny
    # Log hook fire event
    mkdir -p ~/.gstack/analytics 2>/dev/null || true
    echo '{"event":"hook_fire","skill":"freeze","pattern":"boundary_deny","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}' >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true

    ESC_FILE=$(_json_escape "$FILE_PATH")
    ESC_DIR=$(_json_escape "$FREEZE_DIR")
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"[freeze] Blocked: %s is outside the freeze boundary (%s). Only edits within the frozen directory are allowed."}}\n' "$ESC_FILE" "$ESC_DIR"
    ;;
esac
