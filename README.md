# Agent Note

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/agentnote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/agentnote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/@wasabeef/agentnote"><img src="https://img.shields.io/npm/v/@wasabeef/agentnote" alt="npm"></a>
</p>

<p align="center"><strong>Know <em>why</em> your code changed, not just <em>what</em> changed.</strong></p>

<p align="center">
Agent Note records every prompt, every AI response, and AI file attribution — then attaches it all to your git commits. Line-level precision where the agent exposes enough edit history.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/agentnote/">Documentation</a>
</p>

## Setup

```bash
npx @wasabeef/agentnote init
```

For Codex CLI:

```bash
npx @wasabeef/agentnote init --agent codex
```

Commit the generated files and push:

```bash
git add .claude/settings.json .github/workflows/agentnote.yml
git commit -m "chore: enable agentnote"
git push
```

Codex repositories commit `.codex/config.toml` and `.codex/hooks.json` instead of `.claude/settings.json`.

Each developer runs `init` after cloning to install local git hooks.

## What You Get

### Every commit tells its story

```
$ agentnote show

commit:  ce941f7 feat: add JWT auth middleware
session: a1b2c3d4-5678-90ab-cdef-111122223333

ai:      60% (45/75 lines) [█████░░░]
model:   claude-sonnet-4-20250514
agent:   claude-code
files:   5 changed, 3 by AI

  src/middleware/auth.ts  🤖
  src/types/token.ts  🤖
  src/middleware/__tests__/auth.test.ts  🤖
  CHANGELOG.md  👤
  README.md  👤

prompts: 2

  1. Implement JWT auth middleware with refresh token rotation
  2. Add tests for expired token and invalid signature
```

### Scan your history at a glance

```
$ agentnote log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR reports

```
$ agentnote pr --output description --update 42
```

Posts an AI session report to the PR description:

```
## 🧑💬🤖 Agent Note

**AI ratio: 73%** ████████
`45/75 lines` · `4/5 commits` · `8 prompts` · `claude-sonnet-4-20250514`

| Commit | AI Ratio | Lines | Prompts | Files |
|---|---|---|---|---|
| ce941f7 feat: add auth | 73% | 45/75 | 2 | auth.ts 🤖, token.ts 🤖 |
```

## How It Works

```
You prompt your coding agent
  → hooks capture the prompt
The agent writes code
  → hooks or transcripts track files + attribution data
You git commit
  → trailer injected, note recorded
You git push
  → notes auto-pushed to remote
```

## Commands

| Command | What it does |
| --- | --- |
| `agentnote init` | Set up hooks, workflow, git hooks, and notes auto-fetch |
| `agentnote show [commit]` | Show the AI session behind a commit |
| `agentnote log [n]` | List recent commits with AI ratio |
| `agentnote pr [base]` | Generate PR report (markdown or JSON) |
| `agentnote status` | Show tracking state |

## Works with

| Agent | Status | Attribution |
| --- | --- | --- |
| Claude Code | Full support | Line-level |
| Codex CLI | Preview | File-level by default, line-level when transcript patch counts match the commit |
| Cursor | Coming soon | — |
| Gemini CLI | Coming soon | — |

## GitHub Action

```yaml
- uses: wasabeef/agentnote@v0
```

<details>
<summary>Full example with outputs</summary>

```yaml
- uses: wasabeef/agentnote@v0
  id: agentnote
  with:
    base: main

# Use structured outputs
- run: echo "AI ratio: ${{ steps.agentnote.outputs.overall_ai_ratio }}%"
```

</details>

<details>
<summary>What gets saved</summary>

```bash
$ git notes --ref=agentnote show ce941f7
```

```json
{
  "v": 1,
  "agent": "claude-code",
  "session_id": "a1b2c3d4-...",
  "model": "claude-sonnet-4-20250514",
  "interactions": [
    {
      "prompt": "Implement JWT auth middleware",
      "response": "I'll create the middleware...",
      "files_touched": ["src/auth.ts"],
      "tools": ["Edit"]
    }
  ],
  "files": [
    { "path": "src/auth.ts", "by_ai": true },
    { "path": "CHANGELOG.md", "by_ai": false }
  ],
  "attribution": {
    "ai_ratio": 60,
    "method": "line",
    "lines": { "ai_added": 45, "total_added": 75, "deleted": 3 }
  }
}
```

</details>

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Architecture details →](docs/knowledge/DESIGN.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
