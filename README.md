# Agent Note

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agentnote"><img src="https://img.shields.io/npm/v/agentnote" alt="npm"></a>
</p>

<p align="center"><strong>Know <em>why</em> your code changed, not just <em>what</em> changed.</strong></p>

<p align="center">
Agent Note records each prompt, response, and AI-attributed file, then attaches that context to your git commits. It reaches line-level attribution when the agent exposes enough edit history.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/">Documentation</a>
</p>

## Setup

```bash
npx agentnote init --agent claude
```

For Codex CLI:

```bash
npx agentnote init --agent codex
```

For Cursor:

```bash
npx agentnote init --agent cursor
```

Commit the generated files and push:

```bash
git add .claude/settings.json .github/workflows/agentnote.yml
git commit -m "chore: enable agentnote"
git push
```

Codex repositories commit `.codex/config.toml` and `.codex/hooks.json` instead of `.claude/settings.json`.
Cursor repositories commit `.cursor/hooks.json` instead of `.claude/settings.json`.

Each developer runs `init` after cloning to install local git hooks.

Cursor support is currently preview-only: attribution comes from `afterFileEdit` / `afterTabFileEdit` hooks, prompt / response pairs are restored from Cursor response hooks or local transcripts when available, and the default git hooks track plain `git commit` normally. When Cursor edit counts match and the final committed blob still matches the last AI edit, Agent Note safely upgrades those files to line-level attribution. `agentnote commit -m "..."` remains a useful fallback wrapper when git hooks are unavailable.

## Check Your Setup

```bash
npx agentnote status
```

```text
agentnote v0.x.x

agent:   active (cursor)
capture: cursor(prompt, response, edits, shell)
git:     active (prepare-commit-msg, post-commit, pre-push)
commit:  tracked via git hooks
session: a1b2c3d4…
agent:   cursor
linked:  3/20 recent commits
```

`agent:` shows which agent adapters are enabled. `capture:` summarizes what the active agent hooks collect. `git:` shows whether the managed repo-local git hooks are installed. `commit:` tells you the primary tracking path: normal `git commit` when git hooks are active, or fallback mode when you should prefer `agentnote commit`.

## What You Get

### Every commit tells its story

```
$ npx agentnote show

commit:  ce941f7 feat: add JWT auth middleware
session: a1b2c3d4-5678-90ab-cdef-111122223333

ai:      60% (45/75 lines) [█████░░░]
model:   claude-sonnet-4-20250514
agent:   claude
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
$ npx agentnote log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR reports

```
$ npx agentnote pr --output description --update 42
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
| `agentnote deinit` | Remove hooks and config for an agent |
| `agentnote show [commit]` | Show the AI session behind `HEAD` or a commit SHA |
| `agentnote log [n]` | List recent commits with AI ratio |
| `agentnote pr [base]` | Generate PR report (markdown or JSON) |
| `agentnote status` | Show tracking state |

## Works with

| Agent | Status | Attribution |
| --- | --- | --- |
| Claude Code | Full support | Line-level |
| Codex CLI | Preview | File-level by default, line-level when transcript patch counts match the commit |
| Cursor | Preview | `afterFileEdit` / `afterTabFileEdit`-driven attribution, with safe line-level upgrade when the committed blob still matches the AI edit |
| Gemini CLI | Preview | File-level via `BeforeTool`/`AfterTool` hooks; pending-commit pattern for trailer injection |

## Capability Matrix

| Capability | Claude Code | Codex CLI | Cursor | Gemini CLI |
| --- | --- | --- | --- | --- |
| Plain `git commit` with generated git hooks | Yes | Yes | Yes | Yes |
| `agentnote commit` fallback | Yes | Yes | Yes | Yes |
| Prompt / response recovery | Hook-native | Local transcript | Response hooks or local transcripts | `BeforeAgent`/`AfterAgent` hooks |
| Default attribution | Line-level | File-level | File-level | File-level |
| Safe line-level upgrade | Default path | When transcript patch counts match the commit | When `afterFileEdit` / `afterTabFileEdit` counts match and the committed blob still matches the last AI edit | Not yet available |

## GitHub Action

```yaml
- uses: wasabeef/AgentNote@v0
```

<details>
<summary>Full example with outputs</summary>

```yaml
- uses: wasabeef/AgentNote@v0
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
  "agent": "claude",
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
