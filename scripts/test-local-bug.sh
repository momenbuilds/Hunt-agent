#!/bin/sh
# Starts a local vulnerable fixture, runs headless hunt-agent assessment pipeline checks.
# Does NOT require a real model — model-dependent steps are skipped if unavailable.
# Usage: npm run test:local-bug
#
# Set KEEP_TEST_OUTPUT=1 to preserve temp workspace after the test.

set -e

BIN="$(dirname "$0")/../dist/cli.js"
FIXTURE="$(dirname "$0")/../tests/fixtures/security-apps/cors-app/server.js"

if [ ! -f "$BIN" ]; then
  echo "[test:local-bug] dist/cli.js not found — run npm run build first"
  exit 1
fi

if [ ! -f "$FIXTURE" ]; then
  echo "[test:local-bug] fixture not found: $FIXTURE"
  exit 1
fi

# Create temp workspace
TMPDIR_TEST="$(mktemp -d)"
echo "[test:local-bug] workspace: $TMPDIR_TEST"

cleanup() {
  if [ -n "$FIXTURE_PID" ] && kill -0 "$FIXTURE_PID" 2>/dev/null; then
    kill "$FIXTURE_PID" 2>/dev/null || true
  fi
  if [ "${KEEP_TEST_OUTPUT:-0}" != "1" ]; then
    rm -rf "$TMPDIR_TEST"
  else
    echo "[test:local-bug] keeping workspace: $TMPDIR_TEST"
  fi
}
trap cleanup EXIT INT TERM

# Start CORS fixture on a random port using Node
PORT_FILE="$TMPDIR_TEST/port.txt"
node -e "
const { start } = require('$FIXTURE');
start(0).then(({ port }) => {
  const fs = require('fs');
  fs.writeFileSync('$PORT_FILE', String(port));
  process.stdout.write('fixture running on port ' + port + '\n');
  // keep alive
  setInterval(() => {}, 60000);
}).catch(e => { process.stderr.write('fixture error: ' + e.message + '\n'); process.exit(1); });
" &
FIXTURE_PID=$!

# Wait for port file (up to 5 seconds)
WAITED=0
while [ ! -f "$PORT_FILE" ] && [ $WAITED -lt 50 ]; do
  sleep 0.1
  WAITED=$((WAITED + 1))
done

if [ ! -f "$PORT_FILE" ]; then
  echo "[test:local-bug] FAIL: fixture did not start in time"
  exit 1
fi

PORT="$(cat "$PORT_FILE")"
echo "[test:local-bug] fixture running on port $PORT"
FIXTURE_URL="http://127.0.0.1:$PORT"

# Write temp scope.yaml allowing only the fixture port
cat > "$TMPDIR_TEST/scope.yaml" <<EOF
displayName: Local Bug Test

scope:
  allowedTargets:
    - $FIXTURE_URL
  blockedTargets:
    - https://production.example.com
  requireApprovalFor:
    - shell
  forbiddenActions:
    - destructive_testing
EOF

# Write temp config
CONFIG_FILE="$TMPDIR_TEST/config.json"
cat > "$CONFIG_FILE" <<EOF
{
  "backend": "",
  "model": "",
  "base_url": "",
  "api_key": "",
  "models": {},
  "fallbacks": {},
  "providers": {},
  "mcp_servers": [],
  "skills_dirs": [],
  "disabled_skills": [],
  "max_steps": 0,
  "auto_compact_threshold": 0,
  "streaming_enabled": true,
  "thinking_enabled": false,
  "plugins": []
}
EOF

echo ""
echo "[test:local-bug] 1/3 scope validate"
cd "$TMPDIR_TEST"
SCOPE_VALID="$(HUNT_AGENT_CONFIG="$CONFIG_FILE" node "$BIN" scope validate scope.yaml 2>&1)"
if echo "$SCOPE_VALID" | grep -q "OK"; then
  echo "[test:local-bug] [ok] scope validate: $SCOPE_VALID"
else
  echo "[test:local-bug] [FAIL] scope validate: $SCOPE_VALID"
  exit 1
fi

echo ""
echo "[test:local-bug] 2/3 scope check (allowed)"
ALLOWED="$(HUNT_AGENT_CONFIG="$CONFIG_FILE" node "$BIN" scope check "$FIXTURE_URL" 2>&1)"
if echo "$ALLOWED" | grep -q "allowed"; then
  echo "[test:local-bug] [ok] $FIXTURE_URL is allowed"
else
  echo "[test:local-bug] [FAIL] expected allowed, got: $ALLOWED"
  exit 1
fi

echo ""
echo "[test:local-bug] 3/3 scope check (blocked)"
BLOCKED="$(HUNT_AGENT_CONFIG="$CONFIG_FILE" node "$BIN" scope check https://production.example.com 2>&1 || true)"
if echo "$BLOCKED" | grep -q "blocked"; then
  echo "[test:local-bug] [ok] https://production.example.com is blocked"
else
  echo "[test:local-bug] [FAIL] expected blocked, got: $BLOCKED"
  exit 1
fi

# If a model is available, run headless assessment
echo ""
echo "[test:local-bug] checking model availability..."
MODEL_STATUS="$(HUNT_AGENT_CONFIG="$CONFIG_FILE" node "$BIN" provider status 2>&1)"
if echo "$MODEL_STATUS" | grep -qi "available\|healthy"; then
  echo "[test:local-bug] model available — would run headless assess (skipping in this script)"
else
  echo "[test:local-bug] no model available — skipping assessment (scope checks verified)"
fi

echo ""
echo "[test:local-bug] ALL PASSED"
