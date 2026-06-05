# Migrating from pentesterflow to hunt-agent

hunt-agent is the rebranded successor to pentesterflow. The two are functionally
identical — only paths, environment variable names, and the binary name have changed.

## What changed

| Old (pentesterflow) | New (hunt-agent) |
|---|---|
| Binary: `pentesterflow` | Binary: `hunt-agent` (alias: `hunt`) |
| Config: `~/.pentesterflow/config.json` | Config: `~/.hunt-agent/config.json` |
| Sessions: `~/.pentesterflow/sessions/` | Sessions: `~/.hunt-agent/sessions/` |
| Logs: `~/.pentesterflow/logs/pentesterflow.log` | Logs: `~/.hunt-agent/logs/hunt-agent.log` |
| Debug: `~/.pentesterflow/debug/` | Debug: `~/.hunt-agent/debug/` |
| Skills (builtin): `~/.pentesterflow/builtin-skills/` | Skills (builtin): `~/.hunt-agent/builtin-skills/` |
| Skills (personal): `~/.pentesterflow/skills/` | Skills (personal): `~/.hunt-agent/skills/` |
| Project workspace: `.pentesterflow/` | Project workspace: `.hunt-agent/` |
| Env: `PENTESTERFLOW_CONFIG` | Env: `HUNT_AGENT_CONFIG` |
| Env: `PENTESTERFLOW_LOG_LEVEL` | Env: `HUNT_AGENT_LOG_LEVEL` |
| Env: `PENTESTERFLOW_DEBUG_SESSION` | Env: `HUNT_AGENT_DEBUG_SESSION` |
| Env: `PENTESTERFLOW_DEBUG_SESSION_PATH` | Env: `HUNT_AGENT_DEBUG_SESSION_PATH` |
| Env: `PENTESTERFLOW_REPO` | Env: `HUNT_AGENT_REPO` |
| Env: `PENTESTERFLOW_VERSION` | Env: `HUNT_AGENT_VERSION` |
| Env: `PENTESTERFLOW_INSTALL_DIR` | Env: `HUNT_AGENT_INSTALL_DIR` |

## Migration steps

### 1. Install hunt-agent

```sh
curl -fsSL https://raw.githubusercontent.com/hunt-agent/hunt-agent/main/install.sh | sh
```

### 2. Copy your existing data (optional)

If you want to keep your config, sessions, and intelligence data:

```sh
cp -r ~/.pentesterflow ~/.hunt-agent
```

Or migrate only what you need:

```sh
# Config only
cp ~/.pentesterflow/config.json ~/.hunt-agent/config.json

# Sessions only
cp -r ~/.pentesterflow/sessions ~/.hunt-agent/sessions

# Intelligence only
cp -r ~/.pentesterflow/intelligence ~/.hunt-agent/intelligence
```

### 3. Update environment variables in your shell profile

If you have any `PENTESTERFLOW_*` variables in `~/.bashrc`, `~/.zshrc`, or similar,
rename them to their `HUNT_AGENT_*` equivalents (see the table above).

### 4. Update project workspaces

If you have `.pentesterflow/` directories in project repos:

```sh
# In each project directory:
mv .pentesterflow .hunt-agent
```

### 5. Verify

```sh
hunt-agent --version
hunt-agent --help
```

## Notes

- The old `~/.pentesterflow/` directory is NOT removed by hunt-agent. You can
  delete it manually once you have verified your migration.
- hunt-agent will warn you at startup if it detects `~/.pentesterflow/config.json`
  without a corresponding `~/.hunt-agent/config.json`.
- All session files and intelligence JSONL data are fully compatible — no format
  changes occurred.
