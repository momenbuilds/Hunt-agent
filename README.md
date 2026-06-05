<div align="center">

# hunt-agent

### Your AI pentest agent. Your models. Your tools.

Open-source AI pentest agent for authorized security testing.

hunt-agent helps security engineers move through recon, enumeration,
validation, evidence collection, and reporting while keeping the analyst in
control at every step.

<br/>

[![build](https://img.shields.io/github/actions/workflow/status/hunt-agent/hunt-agent/ci.yml?branch=main&label=build&logo=github)](https://github.com/hunt-agent/hunt-agent/actions)
[![release](https://img.shields.io/github/v/release/hunt-agent/hunt-agent?include_prereleases&logo=github)](https://github.com/hunt-agent/hunt-agent/releases)
[![node](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![stars](https://img.shields.io/github/stars/hunt-agent/hunt-agent?style=social)](https://github.com/hunt-agent/hunt-agent/stargazers)

**[Install](#install) · [Quickstart](#quickstart) · [Lifecycle](#pentest-lifecycle) · [Memory](#continuous-learning) · [Burp](#burp-integration) · [Security](#security-model)**

</div>

---

> **SAFETY WARNING**  
> hunt-agent is designed **exclusively** for authorized penetration testing,
> bug bounty work (within program scope), and security research on systems
> you have explicit permission to test. Using it against systems without
> authorization is illegal and unethical. Always confirm scope before testing.

---

```console
$ hunt-agent
╭────────────────────────────────────────────────╮
│  Hunt-agent                                    │
│  local agent · tools ready · analyst approved  │
╰────────────────────────────────────────────────╯

› /target https://app.example.com
  target set to https://app.example.com

› test the orders API for broken access control
⏺ Skill webvuln
  ⎿ loaded skill: webvuln
⏺ http GET https://app.example.com/api/v1/orders/1043
  ⎿ 200 OK
⏺ BashTool(curl -s -H "Authorization: Bearer $USER_B" ...)
  ⎿ cross-account response confirmed
⏺ Confirmed Finding (high) IDOR on /api/v1/orders/{id}
  ⎿ written to ./findings/idor-orders.md
```

## Overview

hunt-agent is an open-source terminal assistant designed specifically for
authorized offensive-security work. It connects to local or hosted LLMs, plans
against a scoped target, uses real pentesting tools, asks for approval before
sensitive actions, and learns from each engagement.

Key features:

- Works with any OpenAI-compatible LLM (Ollama, LM Studio, Groq, Gemini, Kimi, etc.)
- Human-in-the-loop: every shell command and HTTP request requires approval
- Built-in tools: http, shell, file ops, web search, MCP, Burp integration
- Skill system: load task-specific playbooks with `/skill-name`
- Continuous learning: compacts sessions into reusable intelligence scenarios
- YOLO mode for lab environments (auto-approves all tool calls)

## Install

### macOS / Linux

```sh
curl -fsSL https://raw.githubusercontent.com/hunt-agent/hunt-agent/main/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/hunt-agent/hunt-agent/main/install.ps1 | iex
```

### npm (global)

```sh
npm install -g @hunt-agent/cli
```

### From source

```sh
git clone https://github.com/hunt-agent/hunt-agent.git
cd hunt-agent
npm install
npm run build
node dist/cli.js --version
```

## Quickstart

```sh
# Start hunt-agent (first run: choose a tooling profile)
hunt-agent

# Or use the alias
hunt
```

On first launch, hunt-agent asks whether to use curl-only mode (recommended)
or enable specialized scanners (ffuf, nuclei, sqlmap, etc.). You can change
this later via config.

### Set a target

```
/target https://app.example.com
```

### Run a test

```
test the login endpoint for credential stuffing protections
```

### Use a skill

```
/sqli
/jwt
/webvuln
```

### Switch providers

```
/provider
```

### View help

```
/help
```

## Pentest lifecycle

hunt-agent covers the full authorized engagement workflow:

1. **Recon** — enumerate endpoints, headers, JS bundles, GraphQL schemas
2. **Mapping** — build coverage state (which endpoints have been tested for what)
3. **Testing** — targeted probes via curl / http tool, two-account BAC/IDOR checks
4. **Evidence** — reproduce and document findings with exact curl one-liners
5. **Reporting** — `confirm_finding` writes markdown reports under `./findings/`
6. **Coverage review** — `/next` suggests what to test next based on coverage state

## Continuous learning

After each session, `/compact` summarizes the conversation into persistent
session memory. hunt-agent also extracts intelligence scenarios — reusable
patterns about what worked, what failed, and what to check in similar contexts.

Intelligence is stored at:
- `.hunt-agent/intelligence/scenarios.jsonl` (project-scoped)
- `~/.hunt-agent/intelligence/scenarios.jsonl` (personal)

## Burp integration

Start a local bridge that accepts traffic from the Burp Suite extension:

```
/burp
/burp 9999
```

The bridge ingests requests, responses, and tasks from the Hunt-agent Burp
extension, letting you combine manual Burp testing with AI-assisted analysis.

## Configuration

Config lives at `~/.hunt-agent/config.json`. Key environment variables:

| Variable | Description |
|---|---|
| `HUNT_AGENT_CONFIG` | Override config file path |
| `HUNT_AGENT_LOG_LEVEL` | Log level (info, debug, warn, error) |
| `HUNT_AGENT_DEBUG_SESSION` | Enable session debug JSONL logging |
| `HUNT_AGENT_DEBUG_SESSION_PATH` | Path for session debug log |

## Security model

- **No auto-approve by default.** Every tool call — shell commands, HTTP
  requests, file writes — shows a permission prompt. The analyst approves each
  one.
- **YOLO mode** (`/yolo on` or `--dangerously-skip-permissions`) auto-approves
  everything. Use only in isolated lab environments.
- **Scope enforcement.** The system prompt hard-limits the agent to authorized
  security work. Out-of-scope requests are refused.
- **Config is 0600.** The config file and all session files are written with
  owner-only permissions.
- **No telemetry.** hunt-agent does not send any data to external services
  beyond the LLM provider you configure.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Migrating from pentesterflow

See [docs/migration.md](docs/migration.md) for the full migration guide.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 — see [LICENSE](LICENSE).
