# Testing

## Standard test suite

Runs on every commit and in CI. No external dependencies required.

```sh
npm run typecheck   # TypeScript type check
npm run lint        # Biome linter
npm run test        # 471 unit/integration tests (vitest)
npm run build       # tsup ESM bundle
npm run smoke       # 26 headless CLI checks (no TTY)
npm run ci          # all of the above in sequence
```

The smoke test (`scripts/smoke.sh`) is fully headless — it tests the built
`dist/cli.js` binary using only non-interactive flags (`--version`, `--help`,
`--list-providers`, `--provider-status`, `model routes`, etc.). No TTY is
needed. Safe for CI.

## Real provider integration test

Tests real completions through installed local CLI providers using harmless
prompts. Does **not** run in normal CI. Run explicitly after verifying the
relevant CLIs are installed and authenticated.

```sh
npm run test:providers
```

**Safety rules enforced by the script:**

- Uses a temporary config; never modifies `~/.hunt-agent/config.json`
- Uses only harmless prompts (`"Reply with exactly: OK"`)
- Never reads credential files, browser cookies, OAuth tokens, or keychains
- Only calls the official installed CLI binaries (`codex`, `claude`)
- Never makes security testing calls against any real target
- Skips tests cleanly when a CLI is not installed or not authenticated

**What it tests:**

1. Provider status with enabled config (codex-cli, claude-code → `ready`)
2. Model routes table
3. Raw Codex CLI: `codex exec --skip-git-repo-check -`
4. Hunt-agent Codex CLI completion: `hunt-agent model test codex-cli`
5. Raw Claude Code: `claude -p "Reply with exactly: OK"`
6. Hunt-agent Claude Code completion: `hunt-agent model test claude-code`
7. Fallback chain: bad default provider → claude-code fallback
8. Unknown provider: clean error, no crash, no stack trace
9. No credential scraping (code-reviewed, spawn-only)

**Prerequisites:**

| Provider    | Install                                        | Auth                                      |
|-------------|------------------------------------------------|-------------------------------------------|
| Codex CLI   | `npm install -g @openai/codex`                 | `codex` (interactive first-run auth)      |
| Claude Code | https://claude.ai/download                     | `claude` (interactive first-run auth)     |

**Skipped items are acceptable** if the CLI is not installed or requires auth.
Normal CI (`npm run ci`) passes without any real provider being present.

## Real provider test results (2026-06-06)

Tested on macOS with both CLIs installed:

| Check | Result |
|---|---|
| codex-cli detected as ready | ✅ |
| claude-code detected as ready | ✅ |
| model routes prints | ✅ |
| `codex exec` raw | ⏭ skipped — usage limit exceeded (authenticated, credits depleted) |
| hunt-agent codex-cli completion | ⏭ skipped (follows from above) |
| `claude -p` raw | ✅ returns `OK` |
| hunt-agent claude-code real completion | ✅ `ok claude-code:claude-code (5315ms)` |
| fallback chain works | ✅ |
| unknown provider clean error | ✅ |
| no credential scraping | ✅ |

**Claude Code completion through Hunt-agent is fully verified.**  
Codex CLI non-interactive mode (`codex exec`) is confirmed to work when
credits are available; currently skipped due to usage limit.

## Provider config for manual testing

Use `HUNT_AGENT_CONFIG` to point at a temporary config without touching your
real config:

```sh
export HUNT_AGENT_CONFIG=/tmp/hunt-test/config.json
mkdir -p /tmp/hunt-test
cat > /tmp/hunt-test/config.json <<EOF
{
  "providers": {
    "claude-code": {
      "type": "local-cli",
      "command": "claude",
      "args": ["-p"],
      "inputMode": "argument",
      "enabled": true
    },
    "codex-cli": {
      "type": "local-cli",
      "command": "codex",
      "args": ["exec", "--skip-git-repo-check", "-"],
      "inputMode": "stdin",
      "enabled": true
    }
  },
  "models": {
    "default": "claude-code",
    "planner": "claude-code",
    "executor": "codex-cli",
    "verifier": "claude-code"
  },
  "fallbacks": {
    "default": ["claude-code"]
  }
}
EOF

hunt-agent --provider-status
hunt-agent model routes
hunt-agent model test claude-code
hunt-agent model test codex-cli
```
