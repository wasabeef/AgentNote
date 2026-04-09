# Agent Note (agentnote)

<p align="center">
  <img src="docs/assets/hero.jpeg" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/agentnote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/agentnote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/@wasabeef/agentnote"><img src="https://img.shields.io/npm/v/@wasabeef/agentnote" alt="npm"></a>
</p>

<p align="center"><strong>Know <em>why</em> your code changed, not just <em>what</em> changed.</strong></p>

<p align="center">
Agent Note records every prompt, every AI response, and which files were AI-written — then attaches it all to your git commits. Zero config. One command.
</p>

## Setup

```bash
npx @wasabeef/agentnote init
```

Or install as a dev dependency:

```bash
npm install --save-dev @wasabeef/agentnote
```

Hooks, GitHub Action workflow, and notes auto-fetch — all configured in one command. Commit the generated files to share with your team.

## What You Get

### Every commit tells its story

```
$ agentnote show

commit:  ce941f7 feat: add JWT auth middleware
session: a1b2c3d4-5678-90ab-cdef-111122223333

ai:      60% (45/75 lines) [████████████░░░░░░░░]
model:   claude-sonnet-4-20250514
files:   5 changed, 3 by AI

  CHANGELOG.md  👤
  src/middleware/auth.ts  🤖
  src/types/token.ts  🤖
  src/middleware/__tests__/auth.test.ts  🤖
  README.md  👤

prompts: 2

  1. Implement JWT auth middleware with refresh token rotation
     → I'll create the middleware with token verification and rotation...

  2. Add tests for expired token and invalid signature
     → Here are the test cases covering the edge cases...
```

### Scan your history at a glance

```
$ agentnote log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR reports for code review

```
$ agentnote pr --format chat --update 42
```

Inserts a collapsible session transcript into the PR description:

<details>
<summary><code>dd4f971</code> feat: add Button component — AI 100% █████ · 1 files (1 🤖 0 👤)</summary>

> **🧑 Prompt**
> Create a shared Button component with variant support

**🤖 Response**

I'll create a Button component that accepts primary, secondary, and danger variants...

</details>

## How It Works

```
You prompt Claude Code
  → hooks capture the prompt
Claude writes code
  → hooks track which files were touched
You (or Claude) run git commit
  → session trailer injected automatically
  → prompt + response + file attribution saved as git note
```

No extra commands. Just use `git commit` normally.

## Commands

| Command | What it does |
| --- | --- |
| `agentnote init` | Set up hooks, workflow, and notes auto-fetch |
| `agentnote show [commit]` | Show the AI conversation behind a commit |
| `agentnote log [n]` | List recent commits with AI ratio |
| `agentnote status` | Show tracking state |

## Works with

Claude Code — more agents coming (Cursor, Gemini CLI)

## Team Sharing

Session data is stored as [git notes](https://git-scm.com/docs/git-notes) — invisible to `git branch`, GitHub UI, and CI.

```bash
git push origin refs/notes/agentnote          # share
git fetch origin refs/notes/agentnote:refs/notes/agentnote  # fetch
```

<details>
<summary>What gets saved</summary>

```bash
$ git notes --ref=agentnote show ce941f7
```

```json
{
  "v": 1,
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

## GitHub Action

Auto-post AI session reports on every PR:

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

# Use structured outputs in subsequent steps
- run: echo "AI ratio: ${{ steps.agentnote.outputs.overall_ai_ratio }}%"
```

</details>

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Architecture details →](docs/knowledge/DESIGN.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
