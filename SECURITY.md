# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Agent Note, please report it
responsibly.

**Do not open a public issue for security vulnerabilities.**

Use GitHub Security Advisories:

https://github.com/wasabeef/AgentNote/security/advisories/new

## What to Include

- A clear description of the vulnerability.
- Steps to reproduce.
- Potential impact.
- A suggested fix, if you have one.

## Response Timeline

- **Acknowledgment**: within 48 hours.
- **Initial assessment**: within 1 week.
- **Fix and disclosure**: coordinated with the reporter.

## Security Design

Agent Note is local-first:

- Session data is written under `.git/agentnote/` in your repository.
- Permanent records are stored as git notes under `refs/notes/agentnote`.
- Agent Note does not send telemetry, analytics, prompts, responses, or code to
  a hosted service.
- Agent Note does not require an account or service token.
- Agent transcript files are read only when the selected agent exposes local
  transcript data. Agent Note does not modify or delete those transcript files.
- `agent-note init` installs repository-local git hooks and agent hook
  configuration. Existing git hooks are backed up and chained instead of being
  overwritten.

## In Scope

- Data leakage from `.git/agentnote/` or git notes to unintended locations.
- Unintended modification or deletion of user files.
- Command injection through hook event data, commit messages, or generated
  hooks.
- Unsafe handling of agent transcript paths.
- Exposure of sensitive prompt or response content beyond the configured git
  notes, PR Report, or Dashboard outputs.

## Out of Scope

- Vulnerabilities in third-party coding agents, GitHub, npm, or Git itself.
- Attacks that require full local machine compromise.
- Social engineering attacks.
- Public data intentionally committed, pushed, or published by the repository
  owner.
