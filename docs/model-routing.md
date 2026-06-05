# Model Routing

The model router chooses a provider/model for each internal task role. This
lets users mix local models, API models, official local AI CLIs, and cheap
fallbacks without changing the agent loop.

## Roles

Supported roles:

- `default`
- `planner`
- `executor`
- `verifier`
- `reporter`
- `summarizer`
- `skill-writer`
- `memory`
- `cheap`
- `large-context`

Typical mapping:

- Planning uses `planner`.
- Tool-using turns use `executor`.
- Finding review uses `verifier`.
- Report drafting uses `reporter`.
- Compaction and memory use `summarizer` or `memory`.
- Small smoke tests use `cheap`.
- Very large captured contexts use `large-context`.

## Resolution Order

For a requested role, the router tries:

1. Explicit `models.<role>`.
2. `fallbacks.<role>` in order.
3. `models.default`.
4. `fallbacks.default` in order.
5. Other enabled configured providers.

The router skips unhealthy providers and providers whose capabilities do not
fit the request. For example, a local CLI provider with `toolCalling: false` is
skipped for a turn that includes Hunt-agent tool calls.

`--no-fallback` disables fallback attempts for the current launch.

## Examples

```sh
hunt-agent model use openrouter:deepseek/deepseek-r1
hunt-agent model route planner claude-code
hunt-agent model route executor ollama:qwen2.5-coder:32b
hunt-agent model route verifier openrouter:deepseek/deepseek-r1
hunt-agent model fallback planner claude-code codex-cli openrouter:anthropic/claude-sonnet
hunt-agent model routes
```

Config:

```json
{
  "models": {
    "default": "openrouter:deepseek/deepseek-r1",
    "planner": "claude-code",
    "executor": "ollama:qwen2.5-coder:32b",
    "verifier": "openrouter:deepseek/deepseek-r1",
    "reporter": "openai:gpt-4.1-mini",
    "summarizer": "ollama:qwen2.5-coder:14b"
  },
  "fallbacks": {
    "planner": [
      "claude-code",
      "codex-cli",
      "openrouter:anthropic/claude-sonnet"
    ],
    "executor": [
      "ollama:qwen2.5-coder:32b",
      "groq:openai/gpt-oss-20b"
    ]
  }
}
```

## Verification

`/verify [finding-id]` sends a tools-disabled verifier turn. The verifier tries
to disprove the candidate finding from captured evidence before agreeing. If it
rejects or cannot decide, the expected outcome is `needs-human-review` and a
short list of safe checks that still require normal approval gates.

## Backward Compatibility

Legacy `--backend` flag still works:

```sh
hunt-agent --backend ollama --model qwen2.5-coder:32b
hunt-agent --backend groq --model openai/gpt-oss-20b
hunt-agent --backend openai-compat --base-url http://localhost:8000/v1 --api-key sk-...
```

Internally these are normalized into provider/model refs such as
`ollama:qwen2.5-coder:32b`.
