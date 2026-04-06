# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Agentnote, please report it responsibly.

**Do not open a public issue for security vulnerabilities.**

Instead, please send a report via [GitHub Security Advisories](https://github.com/wasabeef/agentnote/security/advisories/new) or email the maintainer directly.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix and disclosure**: Coordinated with reporter

## Security Design

Agentnote is designed with a security-first approach:

- **Local-first**: All session data stays in `.git/agentnote/` on your machine. Nothing is sent to external services.
- **No telemetry**: Zero analytics, tracking, or usage data collection.
- **No auth/accounts**: No login, no tokens, no external service dependencies.
- **Read-only transcript access**: Agentnote reads Claude Code's transcript files but never writes to or deletes them.
- **Git hooks only via Claude Code**: Agentnote never installs or modifies native git hooks (`.git/hooks/`). It only registers hooks in `.claude/settings.json`.

## Scope

Security issues that are in scope:

- Data leakage from `.git/agentnote/` to unintended locations
- Unintended modification or deletion of user files
- Command injection via hook event data
- Exposure of sensitive content from transcripts

Issues that are out of scope:

- Vulnerabilities in Claude Code itself
- Issues requiring local machine access (agentnote's data is local by design)
- Social engineering attacks
