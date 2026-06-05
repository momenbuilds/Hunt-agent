#!/bin/sh
# Hunt-agent headless smoke test — runs without a TTY, safe for CI.
# All commands use non-interactive flags that exit immediately (no Ink TUI).
# Usage: npm run smoke
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/cli.js"
PASS=0
FAIL=0

pass() { printf '  [ok] %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL + 1)); }

check_contains() {
  label="$1"; output="$2"; needle="$3"
  if printf '%s' "$output" | grep -qi "$needle"; then
    pass "$label"
  else
    fail "$label — expected to find: $needle"
    printf '    got: %s\n' "$(printf '%s' "$output" | head -3)"
  fi
}

check_not_contains() {
  label="$1"; output="$2"; needle="$3"
  if printf '%s' "$output" | grep -qi "$needle"; then
    fail "$label — must NOT contain: $needle"
    printf '    found: %s\n' "$(printf '%s' "$output" | grep -i "$needle" | head -3)"
  else
    pass "$label"
  fi
}

echo ""
echo "============================================================"
echo "  Hunt-agent headless smoke test"
echo "============================================================"

# ---- 1. Build ---------------------------------------------------------------
printf '\n[1/11] Build\n'
cd "$ROOT"
npm run build >/dev/null 2>&1 && pass "npm run build succeeded" || { fail "npm run build failed"; exit 1; }

# ---- 2. CLI exists ----------------------------------------------------------
printf '\n[2/11] Binary exists\n'
[ -f "$CLI" ] && pass "dist/cli.js exists" || { fail "dist/cli.js missing"; exit 1; }

# ---- 3. --version -----------------------------------------------------------
printf '\n[3/11] --version\n'
VERSION_OUT=$(node "$CLI" --version 2>&1 || true)
check_contains "--version prints hunt-agent" "$VERSION_OUT" "hunt-agent"
check_not_contains "--version has no old branding" "$VERSION_OUT" "pentesterflow"

# ---- 4. --help --------------------------------------------------------------
printf '\n[4/11] --help\n'
HELP_OUT=$(node "$CLI" --help 2>&1 || true)
check_contains "--help prints hunt-agent" "$HELP_OUT" "hunt-agent"
check_not_contains "--help has no old branding" "$HELP_OUT" "pentesterflow"
check_contains "--help shows --provider flag" "$HELP_OUT" "\-\-provider"
check_contains "--help shows --model flag" "$HELP_OUT" "\-\-model"
check_contains "--help shows model subcommand" "$HELP_OUT" "model"

# ---- 5. provider commands ---------------------------------------------------
printf '\n[5/11] Provider commands (non-interactive)\n'
LIST_PROV=$(node "$CLI" --list-providers 2>&1 || true)
check_contains "--list-providers lists providers" "$LIST_PROV" "anthropic\|claude-code\|codex-cli\|openai"
check_not_contains "--list-providers has no old branding" "$LIST_PROV" "pentesterflow"

PROV_STATUS=$(node "$CLI" --provider-status 2>&1 || true)
check_contains "--provider-status lists providers" "$PROV_STATUS" "anthropic\|claude-code\|codex-cli"
check_not_contains "--provider-status has no old branding" "$PROV_STATUS" "pentesterflow"

PROV_SUB=$(node "$CLI" provider status 2>&1 || true)
check_contains "'provider status' subcommand works" "$PROV_SUB" "anthropic\|claude-code\|codex-cli"

# ---- 6. model routes --------------------------------------------------------
printf '\n[6/11] Model routes (non-interactive)\n'
ROUTES=$(node "$CLI" model routes 2>&1 || true)
check_contains "'model routes' runs" "$ROUTES" "Model routes\|Fallbacks\|No routes configured"
check_not_contains "'model routes' has no old branding" "$ROUTES" "pentesterflow"

ROUTES_NF=$(node "$CLI" --no-fallback model routes 2>&1 || true)
check_contains "'model routes --no-fallback' runs" "$ROUTES_NF" "Model routes\|Fallbacks\|No routes configured"

# ---- 7. --list-models -------------------------------------------------------
printf '\n[7/11] --list-models\n'
MODELS=$(node "$CLI" --list-models 2>&1 || true)
check_contains "--list-models shows providers" "$MODELS" "anthropic\|claude\|gemini\|openai"
check_not_contains "--list-models has no old branding" "$MODELS" "pentesterflow"

# ---- 8. Codex CLI availability ----------------------------------------------
printf '\n[8/11] Codex CLI availability\n'
if command -v codex >/dev/null 2>&1; then
  CODEX_VER=$(codex --version 2>&1 || true)
  check_contains "codex --version works" "$CODEX_VER" "codex"
  check_contains "provider-status lists codex-cli" "$PROV_STATUS" "codex-cli"
  printf '  codex found: %s\n' "$CODEX_VER"
else
  pass "codex not installed — missing-command detection path (expected in CI)"
  check_contains "provider-status lists codex-cli entry" "$PROV_STATUS" "codex-cli"
fi

# ---- 9. Claude Code availability --------------------------------------------
printf '\n[9/11] Claude Code availability\n'
if command -v claude >/dev/null 2>&1; then
  CLAUDE_VER=$(claude --version 2>&1 || true)
  check_contains "claude --version works" "$CLAUDE_VER" "claude\|Claude"
  check_contains "provider-status lists claude-code" "$PROV_STATUS" "claude-code"
  printf '  claude found: %s\n' "$CLAUDE_VER"
else
  pass "claude not installed — missing-command detection path (expected in CI)"
  check_contains "provider-status lists claude-code entry" "$PROV_STATUS" "claude-code"
fi

# ---- 10. Config path isolation with HUNT_AGENT_CONFIG ----------------------
printf '\n[10/11] Config isolation via HUNT_AGENT_CONFIG\n'
TMP_CFG=$(mktemp -d)
trap 'rm -rf "$TMP_CFG"' EXIT INT TERM
CFG_FILE="$TMP_CFG/hunt-agent-config.json"

ROUTES_CFG=$(HUNT_AGENT_CONFIG="$CFG_FILE" node "$CLI" model routes 2>&1 || true)
check_contains "model routes with isolated config" "$ROUTES_CFG" "Model routes\|Fallbacks\|No routes configured"
check_not_contains "isolated config has no old branding" "$ROUTES_CFG" "pentesterflow"

# ---- 12. scope validate + scope check ----------------------------------------
printf '\n[12/14] Scope commands\n'
TMP_SCOPE=$(mktemp -d)
cat > "$TMP_SCOPE/scope.yaml" <<'SCOPE'
displayName: Smoke Test
scope:
  allowedTargets:
    - http://127.0.0.1:3000
  blockedTargets:
    - https://production.example.com
SCOPE

SCOPE_VALID=$(HUNT_AGENT_CONFIG="$TMP_CFG/cfg.json" node "$CLI" scope validate "$TMP_SCOPE/scope.yaml" 2>&1 || true)
check_contains "scope validate accepts valid file" "$SCOPE_VALID" "OK\|ok\|warning"

cd "$TMP_SCOPE"
SCOPE_ALLOWED=$(HUNT_AGENT_CONFIG="$TMP_CFG/cfg.json" node "$CLI" scope check "http://127.0.0.1:3000" 2>&1 || true)
check_contains "scope check reports allowed URL" "$SCOPE_ALLOWED" "allowed"

SCOPE_BLOCKED=$(HUNT_AGENT_CONFIG="$TMP_CFG/cfg.json" node "$CLI" scope check "https://production.example.com" 2>&1 || true)
check_contains "scope check reports blocked URL" "$SCOPE_BLOCKED" "blocked"
cd "$ROOT"
rm -rf "$TMP_SCOPE"

# ---- 13. report + init help in --help ----------------------------------------
printf '\n[13/14] report and init commands (non-interactive)\n'
HELP_FULL=$(node "$CLI" --help 2>&1 || true)
# init command should be mentioned in help or work as subcommand
INIT_HELP=$(node "$CLI" init --yes --target http://127.0.0.1:3000 --provider claude-code 2>&1 || true)
check_contains "init command runs" "$INIT_HELP" "Created\|already exists\|Next steps"

REPORT_HELP=$(node "$CLI" report json 2>&1 || true)
check_contains "report json runs (no findings = empty report)" "$REPORT_HELP" "report\|written"

# ---- 14. dist/ scan for unexpected old branding ----------------------------
printf '\n[14/14] dist/ scan for unexpected old branding\n'
# Allow only intentional migration strings embedded in dist
BAD=$(grep -r "pentesterflow" "$ROOT/dist/" 2>/dev/null | \
  grep -v "\.pentesterflow\|oldPath\|Legacy config detected\|legacy\|migrate\|migration" | \
  grep -v "pentesterflow.*not.*contain\|contain.*pentesterflow" | \
  head -5 || true)
if [ -n "$BAD" ]; then
  fail "dist/ has unexpected 'pentesterflow' user-facing string"
  printf '%s\n' "$BAD"
else
  pass "dist/ free of unexpected old-branding strings"
fi

# ---- Summary ----------------------------------------------------------------
echo ""
echo "============================================================"
printf "  Results: %d passed, %d failed\n" "$PASS" "$FAIL"

echo "============================================================"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "smoke: FAILED"
  exit 1
fi
echo "smoke: ALL PASSED"
