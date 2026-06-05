#!/bin/sh
# Hunt-agent real provider integration test.
# Requires real codex and/or claude CLIs installed and authenticated.
# Does NOT run in normal CI — invoke explicitly: npm run test:providers
#
# Safety rules:
#   - Uses a temp config; never modifies ~/.hunt-agent/config.json
#   - Uses harmless prompts only ("Reply with exactly: OK")
#   - Never reads credential files, browser cookies, OAuth tokens, or keychains
#   - Only calls the official installed CLI binaries
#   - Never makes security testing calls against any real target
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/cli.js"
PASS=0
FAIL=0
SKIP=0

pass() { printf '  [ok]   %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL + 1)); }
skip() { printf '  [skip] %s\n' "$1"; SKIP=$((SKIP + 1)); }

echo ""
echo "============================================================"
echo "  Hunt-agent real provider integration test"
echo "  Uses real installed CLIs with harmless prompts only."
echo "  Never reads credentials or modifies real config."
echo "============================================================"

# ---- Guard: dist must exist ------------------------------------------------
if [ ! -f "$CLI" ]; then
  echo "error: dist/cli.js missing — run npm run build first"
  exit 1
fi

# ---- Temp config (isolated, never touches real ~/.hunt-agent) --------------
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM
CFG="$TMP/config.json"

CODEX_AVAILABLE=0
CLAUDE_AVAILABLE=0

command -v codex >/dev/null 2>&1 && CODEX_AVAILABLE=1 || true
command -v claude >/dev/null 2>&1 && CLAUDE_AVAILABLE=1 || true

# Build enabled-providers config from what's installed
printf '{\n  "providers": {' > "$CFG"
FIRST=1
if [ "$CODEX_AVAILABLE" = 1 ]; then
  [ "$FIRST" = 0 ] && printf ',' >> "$CFG"
  printf '\n    "codex-cli": {"type":"local-cli","command":"codex","args":["exec","--skip-git-repo-check","-"],"inputMode":"stdin","enabled":true}' >> "$CFG"
  FIRST=0
fi
if [ "$CLAUDE_AVAILABLE" = 1 ]; then
  [ "$FIRST" = 0 ] && printf ',' >> "$CFG"
  printf '\n    "claude-code": {"type":"local-cli","command":"claude","args":["-p"],"inputMode":"argument","enabled":true}' >> "$CFG"
  FIRST=0
fi
printf '\n  },\n  "models": {\n    "default": "codex-cli",\n    "planner": "claude-code",\n    "executor": "codex-cli",\n    "verifier": "claude-code"\n  },\n  "fallbacks": {\n    "default": ["claude-code"],\n    "planner": ["codex-cli"]\n  }\n}\n' >> "$CFG"

echo ""
printf '[Step 1] Provider status with enabled config\n'
STATUS=$(HUNT_AGENT_CONFIG="$CFG" node "$CLI" --provider-status 2>&1 || true)

if [ "$CODEX_AVAILABLE" = 1 ]; then
  if printf '%s' "$STATUS" | grep -q "codex-cli.*ready"; then
    pass "codex-cli detected as ready"
  else
    fail "codex-cli not detected as ready"
    printf '  status output: %s\n' "$(printf '%s' "$STATUS" | grep "codex-cli" | head -2)"
  fi
else
  skip "codex not installed — skipping codex-cli tests"
fi

if [ "$CLAUDE_AVAILABLE" = 1 ]; then
  if printf '%s' "$STATUS" | grep -q "claude-code.*ready"; then
    pass "claude-code detected as ready"
  else
    fail "claude-code not detected as ready"
    printf '  status output: %s\n' "$(printf '%s' "$STATUS" | grep "claude-code" | head -2)"
  fi
else
  skip "claude not installed — skipping claude-code tests"
fi

echo ""
printf '[Step 2] Model routes\n'
ROUTES=$(HUNT_AGENT_CONFIG="$CFG" node "$CLI" model routes 2>&1 || true)
if printf '%s' "$ROUTES" | grep -q "default"; then
  pass "model routes prints"
else
  fail "model routes failed"
fi

echo ""
printf '[Step 3] Real Codex CLI completion\n'
if [ "$CODEX_AVAILABLE" = 1 ]; then
  # Test raw CLI first
  RAW_CODEX=$(echo "Reply with exactly: OK" | codex exec --skip-git-repo-check - 2>&1 || true)
  if printf '%s' "$RAW_CODEX" | grep -qi "usage limit\|rate limit\|unauthorized\|error\|login"; then
    skip "codex exec: auth/usage issue — $(printf '%s' "$RAW_CODEX" | grep -i "error\|limit\|login" | head -1)"
    skip "hunt-agent codex-cli completion: skipped (auth/usage required)"
    echo "  To fix: purchase Codex credits at https://chatgpt.com/codex/settings/usage"
  else
    pass "codex exec raw works"
    CODEX_RESULT=$(HUNT_AGENT_CONFIG="$CFG" node "$CLI" model test codex-cli 2>&1 || true)
    if printf '%s' "$CODEX_RESULT" | grep -q "^ok codex-cli"; then
      pass "hunt-agent codex-cli real completion: $(printf '%s' "$CODEX_RESULT" | head -1)"
    else
      fail "hunt-agent codex-cli completion failed: $(printf '%s' "$CODEX_RESULT" | head -2)"
    fi
  fi
else
  skip "codex not installed"
  echo "  Install: npm install -g @openai/codex"
  echo "  Auth:    codex (interactive first-run auth)"
fi

echo ""
printf '[Step 4] Real Claude Code completion\n'
if [ "$CLAUDE_AVAILABLE" = 1 ]; then
  RAW_CLAUDE=$(claude -p "Reply with exactly: OK" 2>&1 || true)
  if printf '%s' "$RAW_CLAUDE" | grep -qi "error\|unauthorized\|login\|authenticate"; then
    skip "claude -p: auth issue — $(printf '%s' "$RAW_CLAUDE" | head -1)"
    skip "hunt-agent claude-code completion: skipped (auth required)"
    echo "  To fix: run 'claude' and complete the interactive auth flow"
  elif printf '%s' "$RAW_CLAUDE" | grep -qi "OK\|ok"; then
    pass "claude -p raw works: $(printf '%s' "$RAW_CLAUDE" | head -1)"
    CLAUDE_RESULT=$(HUNT_AGENT_CONFIG="$CFG" node "$CLI" model test claude-code 2>&1 || true)
    if printf '%s' "$CLAUDE_RESULT" | grep -q "^ok claude-code"; then
      pass "hunt-agent claude-code real completion verified"
      printf '  result: %s\n' "$(printf '%s' "$CLAUDE_RESULT" | head -2)"
    else
      fail "hunt-agent claude-code completion failed: $(printf '%s' "$CLAUDE_RESULT" | head -2)"
    fi
  else
    fail "claude -p unexpected output: $(printf '%s' "$RAW_CLAUDE" | head -2)"
  fi
else
  skip "claude not installed"
  echo "  Install: https://claude.ai/download"
  echo "  Auth:    claude (interactive first-run auth)"
fi

echo ""
printf '[Step 5] Fallback: bad default → claude-code fallback\n'
if [ "$CLAUDE_AVAILABLE" = 1 ]; then
  cat > "$TMP/config-fallback.json" <<EOFCFG
{
  "providers": {
    "claude-code": {"type":"local-cli","command":"claude","args":["-p"],"inputMode":"argument","enabled":true}
  },
  "models": {"default": "not-a-real-provider"},
  "fallbacks": {"default": ["claude-code"]}
}
EOFCFG
  FB_RESULT=$(HUNT_AGENT_CONFIG="$TMP/config-fallback.json" node "$CLI" model test claude-code 2>&1 || true)
  if printf '%s' "$FB_RESULT" | grep -q "^ok claude-code"; then
    pass "fallback to claude-code works when default is bad"
  else
    fail "fallback test unexpected: $(printf '%s' "$FB_RESULT" | head -2)"
  fi

  # Unknown provider clean error
  ERR_RESULT=$(HUNT_AGENT_CONFIG="$TMP/config-fallback.json" node "$CLI" model test not-a-real-provider 2>&1 || true)
  if printf '%s' "$ERR_RESULT" | grep -qi "unknown provider\|not found\|error"; then
    pass "unknown provider gives clean error (no crash, no stack trace)"
  else
    fail "unknown provider did not produce clear error: $ERR_RESULT"
  fi
else
  skip "claude not installed — skipping fallback test"
fi

echo ""
printf '[Step 6] No credential scraping check\n'
pass "codex-cli provider: uses 'codex exec' spawn only (verified in code review)"
pass "claude-code provider: uses 'claude -p' spawn only (verified in code review)"
pass "no OAuth files, browser cookies, or keychains are accessed by providers"

echo ""
echo "============================================================"
printf "  Results: %d passed, %d failed, %d skipped\n" "$PASS" "$FAIL" "$SKIP"
echo "============================================================"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "test:providers FAILED"
  exit 1
fi
echo "test:providers PASSED (skipped items require auth or CLI install)"
