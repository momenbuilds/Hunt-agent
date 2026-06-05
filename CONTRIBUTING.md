# Contributing to hunt-agent

hunt-agent is an open-source AI pentest agent. Contributions are welcome.

## Prerequisites

- Node.js >= 20
- npm

## Setup

```sh
git clone https://github.com/hunt-agent/hunt-agent.git
cd hunt-agent
npm install
```

## Development

```sh
# Run the CLI in dev mode
npm run dev

# Run tests
npm run test

# Type-check
npm run typecheck

# Lint
npm run lint

# Lint + fix
npm run lint:fix

# Full CI check
npm run ci
```

## Project layout

```
src/
  agent/        — core agent loop and system prompt
  cli/          — CLI entry point and flag parsing
  config/       — config file load/save
  intelligence/ — local intelligence scenarios store
  llm/          — LLM client adapters and probe
  logger/       — file-only structured logger
  migration/    — legacy data migration check
  providers/    — provider registry and routing
  session/      — session persistence
  skills/       — skill loading and registry
  tools/        — tool implementations (http, shell, file, mcp, ...)
  ui/           — Ink TUI components
  update/       — self-update via GitHub releases
  version/      — version constant
```

## Guidelines

- All changes must pass `npm run ci` (typecheck + lint + test + build).
- Write tests for new behaviour. Place them alongside the module (e.g. `foo.test.ts` beside `foo.ts`).
- Do not add shell metacharacters to spawn arguments — use `execFile` / `execa`.
- Do not weaken permission prompts or scope checks.
- Do not add fake provider success paths.
- Follow the existing code style (biome enforces it via `npm run lint`).
- Keep user-facing strings free of the old "pentesterflow" branding.

## Pull requests

- One logical change per PR.
- Describe the "why" in the PR description, not just the "what".
- Reference any related issue numbers.
- PRs must pass all CI checks before merge.
