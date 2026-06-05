#!/bin/sh
# Tests Ollama integration if installed. Skips cleanly if not available.
# Usage: npm run test:ollama
#
# SAFETY: never pulls models automatically, never reads credentials.

set -e

BIN="$(dirname "$0")/../dist/cli.js"
if [ ! -f "$BIN" ]; then
  echo "[test:ollama] dist/cli.js not found — run npm run build first"
  exit 1
fi

# Skip if ollama is not installed
if ! command -v ollama >/dev/null 2>&1; then
  echo "[test:ollama] SKIP: ollama not installed"
  exit 0
fi

# Skip if ollama daemon is not running
if ! ollama list >/dev/null 2>&1; then
  echo "[test:ollama] SKIP: ollama daemon not running (start with: ollama serve)"
  exit 0
fi

# Find smallest installed model
MODEL="$(ollama list 2>/dev/null | awk 'NR>1 {print $1}' | head -1)"
if [ -z "$MODEL" ]; then
  echo "[test:ollama] SKIP: no models installed (pull one with: ollama pull qwen2.5-coder:0.5b)"
  exit 0
fi

echo "[test:ollama] found model: $MODEL"

# Temp config pointing to ollama
TMPDIR_TEST="$(mktemp -d)"
CONFIG_FILE="$TMPDIR_TEST/config.json"

cat > "$CONFIG_FILE" <<EOF
{
  "backend": "ollama",
  "model": "$MODEL",
  "base_url": "http://localhost:11434",
  "api_key": "",
  "models": { "default": "ollama:$MODEL" },
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

echo "[test:ollama] 1/2 provider-status lists ollama"
STATUS="$(HUNT_AGENT_CONFIG="$CONFIG_FILE" node "$BIN" provider status 2>&1)"
if echo "$STATUS" | grep -qi "ollama"; then
  echo "[test:ollama] [ok] provider-status shows ollama"
else
  echo "[test:ollama] [FAIL] provider-status output: $STATUS"
  rm -rf "$TMPDIR_TEST"
  exit 1
fi

echo "[test:ollama] 2/2 model test ollama:$MODEL"
RESULT="$(HUNT_AGENT_CONFIG="$CONFIG_FILE" node "$BIN" model test "ollama:$MODEL" 2>&1)" || {
  echo "[test:ollama] [FAIL] model test failed: $RESULT"
  rm -rf "$TMPDIR_TEST"
  exit 1
}
echo "[test:ollama] [ok] model test: $RESULT"

rm -rf "$TMPDIR_TEST"
echo "[test:ollama] ALL PASSED"
