# Providers

Hunt-agent uses a provider registry so users can bring their own API models,
OpenAI-compatible endpoints, local LLMs, and official local AI CLIs.

## Provider Interface

Providers implement `AgentProvider` from `src/providers/types.ts`:

- `id`, `name`, `kind`, `enabled`, `defaultModel`
- `capabilities`
- `isAvailable()`
- `getStatus()`
- `listModels()`
- `complete(request)`
- optional `stream(request)`

Provider kinds:

- `api`
- `openai-compatible`
- `local-llm`
- `local-cli`

Capabilities must be honest. If a provider cannot emit Hunt-agent tool calls
in the existing tool-call protocol, set `toolCalling: false`. The model router
uses capability mismatches to skip providers and try fallbacks.

## Adding A Provider

1. Add or reuse an adapter under `src/providers/api`, `src/providers/local`, or
   `src/providers/cli`.
2. Register the built-in in `src/providers/registry.ts`.
3. Add setup defaults in the CLI helper if users should be able to run
   `hunt-agent provider add <id>`.
4. Add static model recommendations when live model listing is not reliable.
5. Add focused tests for status, missing credentials, model resolution, and
   request conversion.

OpenAI-compatible providers should use `OpenAICompatibleProvider` unless the
provider requires a different wire format. Native providers should wrap only the
public API surface and redact errors before showing them to users.

## Config Schema

`~/.hunt-agent/config.json` supports:

```json
{
  "providers": {
    "openrouter": {
      "type": "openai-compatible",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKeyEnv": "OPENROUTER_API_KEY",
      "enabled": true
    }
  },
  "models": {
    "default": "openrouter:deepseek/deepseek-r1",
    "planner": "claude-code",
    "verifier": "openrouter:deepseek/deepseek-r1"
  },
  "fallbacks": {
    "planner": ["claude-code", "codex-cli"]
  },
  "local_cli": {
    "timeoutMs": 120000,
    "maxOutputBytes": 200000,
    "allowInteractive": false
  }
}
```

Legacy fields (`backend`, `model`, `base_url`, `api_key`) still load and are
normalized internally by `runtimeFromConfig()`.

## Local CLI Security Rules

Local CLI providers must:

- Spawn command + args arrays; avoid shell interpolation.
- Be non-interactive by default.
- Enforce timeouts and output byte limits.
- Kill child processes on timeout.
- Redact surfaced stdout/stderr before errors reach logs or users.
- Never read browser cookies, keychains, OAuth files, refresh tokens, CLI token
  files, or private account credentials.
- Never ask users to paste ChatGPT or Claude subscription credentials.
- Require users to authenticate directly through the official local CLI.

Codex CLI and Claude Code providers call the official local binary only. If a
stable non-interactive mode is unavailable in the installed CLI, the provider
reports that clearly instead of scraping credentials or driving an interactive
session.

## Testing Requirements

Provider changes should include tests for:

- Registry registration and resolution.
- Missing provider errors.
- Missing API key status.
- Missing CLI command status.
- Timeout and output limit behavior.
- Redaction of API keys and tokens.
- Capability-aware routing and fallbacks.
- Backward-compatible legacy config mapping.

Run:

```sh
npm run typecheck
npm run lint
npm run test
npm run build
npm run smoke
```
