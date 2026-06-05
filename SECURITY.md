# Security Policy

## Supported Versions

hunt-agent is in early development. Only the latest release is actively maintained.

| Version | Supported |
|---|---|
| latest | yes |
| older | no |

## Reporting a Vulnerability

If you discover a security vulnerability in hunt-agent, please report it
responsibly by opening a GitHub Security Advisory rather than a public issue.

**Do not** disclose security vulnerabilities publicly until a fix has been released.

To report:
1. Go to the repository's Security tab on GitHub.
2. Click "Report a vulnerability".
3. Provide a clear description, reproduction steps, and impact assessment.

We aim to respond within 72 hours and to release a fix within 14 days for
critical issues.

## Scope

hunt-agent is an **authorized** penetration testing and security research tool.
Vulnerabilities in the CLI itself — for example, shell injection via malformed
config, path traversal in session file handling, or credential leakage in logs —
are in scope.

Issues arising from user misconfiguration, use against unauthorized targets, or
misuse of the tool are out of scope.
