# Scope Policy

`scope.yaml` in your project root tells hunt-agent which targets it is authorized to test. The agent refuses HTTP requests to any URL outside the allowed set.

## Quick start

```bash
hunt-agent init --yes --target http://127.0.0.1:3000
```

This creates a `scope.yaml` in the current directory allowing only `http://127.0.0.1:3000`.

## File format

```yaml
displayName: My Assessment

scope:
  allowedTargets:
    - http://127.0.0.1:3000
    - https://staging.example.com

  blockedTargets:
    - https://production.example.com

  allowedMethods:
    - GET
    - POST

  blockedMethods:
    - DELETE

  blockedPaths:
    - /admin
    - /internal

  requireApprovalFor:
    - shell

  forbiddenActions:
    - destructive_testing

maxRequestsPerMinute: 60

authorizationNotes: |
  Authorized testing window: 2025-01-01 to 2025-01-31.
  Contact: security@example.com
```

## Fields

| Field | Type | Description |
|---|---|---|
| `displayName` | string | Human-readable name for the engagement |
| `allowedTargets` | list of URLs | URLs the agent may test. Prefix-matched. |
| `blockedTargets` | list of URLs | URLs blocked even if they match `allowedTargets` |
| `allowedMethods` | list of strings | HTTP methods allowed (default: all) |
| `blockedMethods` | list of strings | HTTP methods explicitly blocked |
| `blockedPaths` | list of path prefixes | URL paths blocked on any allowed target |
| `requireApprovalFor` | list of strings | Tool categories requiring user approval |
| `forbiddenActions` | list of strings | Actions the agent must never perform |
| `maxRequestsPerMinute` | integer | Optional rate limit |
| `authorizationNotes` | string | Human-readable authorization context |

## URL matching

- `http://127.0.0.1:3000` matches all sub-paths: `/`, `/api/users`, `/api/admin`, etc.
- `https://staging.example.com/v1` only matches paths starting with `/v1/`
- Protocol and port must match exactly

## CLI commands

### Validate a scope file

```bash
hunt-agent scope validate [./scope.yaml]
```

Checks for:
- File existence
- Valid URL format in `allowedTargets` and `blockedTargets`
- At least one target defined

### Check a URL against scope

```bash
hunt-agent scope check http://127.0.0.1:3000/api/orders
# allowed: http://127.0.0.1:3000/api/orders

hunt-agent scope check https://production.example.com
# blocked: https://production.example.com
#   reason: https://production.example.com matches blocked target ...
```

Exit code 0 = allowed, 1 = blocked.

## Using scope in CI

See `examples/github-actions/local-security-check.yml` for a complete example.

```bash
# In your CI pipeline:
hunt-agent scope validate scope.yaml       # fail fast on invalid scope
hunt-agent scope check "$TARGET_URL"       # verify target before testing
hunt-agent assess --headless --scope scope.yaml --objective "test CORS"
```

## Programmatic API

```typescript
import { loadScopePolicy, checkURLInScope, checkMethodInScope, checkPathInScope, validateScopeFile } from '@hunt-agent/cli/scope/policy';

const policy = loadScopePolicy('./');
const decision = checkURLInScope('http://127.0.0.1:3000/api/data', policy);
if (!decision.ok) console.error(decision.reason);

const methodOk = checkMethodInScope('DELETE', policy);
const pathOk = checkPathInScope('/admin', policy);

const validation = validateScopeFile('./scope.yaml');
if (!validation.ok) console.error(validation.errors);
```

## Security notes

- The scope file is not a security boundary on its own — it is a policy advisory. A misconfigured scope (or no scope file) means the agent will test any URL.
- Always start with a minimal `allowedTargets` list and expand as needed.
- Never put production URLs in `allowedTargets` unless you intend to test them.
- Use `blockedPaths` to protect destructive endpoints like `/api/delete-all`.
