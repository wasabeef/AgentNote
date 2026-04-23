# Agent Note

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Know <em>why</em> your code changed, not just <em>what</em> changed.</strong></p>

<p align="center">
Agent Note records each prompt, response, and AI-attributed file, then attaches that context to your git commits. It reaches line-level attribution when the agent exposes enough edit history.
</p>

<p align="center">
Think of it as <code>git log</code> plus the AI conversation behind the change.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/">Documentation</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Requirements

- Git
- Node.js 20 or later
- A supported coding agent installed and authenticated

## Setup

1. Enable Agent Note for your coding agent.

```bash
npx agent-note init --agent claude
# or: codex / cursor / gemini
```

Each developer should run this once locally after cloning.

You can enable more than one agent in the same repository:

```bash
npx agent-note init --agent claude cursor
```

If you also want the shared Dashboard on GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Commit the generated files and push.

```bash
git add .claude/settings.json .github/workflows/agentnote-pr-report.yml
# with --dashboard, also add .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: commit `.claude/settings.json`
- Codex CLI: commit `.codex/config.toml` and `.codex/hooks.json`
- Cursor: commit `.cursor/hooks.json`
- Gemini CLI: commit `.gemini/settings.json`

3. Keep using your normal `git commit` workflow.

With the generated git hooks installed, Agent Note records commits automatically. Use `agent-note commit -m "..."` only as a fallback when git hooks are unavailable.

## What Agent Note Saves

- The prompts and responses behind a commit
- The files touched by the agent
- An AI ratio for the commit

Prompt lists are chosen from the causal conversation around the final diff, not from the entire session window. When Agent Note falls back to file-level attribution, it anchors that prompt window to the latest touch turn for each committed file and keeps only the prompt-only context that leads into those final edits, instead of older same-file history or trailing follow-up chatter. Agent Note also excludes common generated artifacts from the AI ratio denominator on a best-effort basis, including Web build outputs, Flutter registrants, Dart codegen, Go protobufs, Rust bindings, and Swift / Kotlin generated sources.

Temporary session data lives under `.git/agentnote/`. The permanent record lives in `refs/notes/agentnote` and is shared on `git push`.

## Agent Support

| Agent | Status | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | Line-level by default | Hook-native prompt / response recovery |
| Codex CLI | Preview | File-level by default | Transcript-driven. Line-level is upgraded only when transcript `apply_patch` counts match the final commit diff. If the transcript cannot be read, Agent Note skips note creation instead of writing uncertain data. |
| Cursor | Supported | File-level by default | Uses `afterFileEdit` / `afterTabFileEdit` hooks. Line-level is upgraded only when the committed blob still matches the latest AI edit. |
| Gemini CLI | Preview | File-level | Hook-based capture with normal `git commit` support through the generated git hooks |

## Check Your Setup

```bash
npx agent-note status
```

```text
agent-note v0.x.x

agent:   active (cursor)
capture: cursor(prompt, response, edits, shell)
git:     active (prepare-commit-msg, post-commit, pre-push)
commit:  tracked via git hooks
session: a1b2c3d4…
agent:   cursor
linked:  3/20 recent commits
```

`agent:` shows which agent adapters are enabled. `capture:` summarizes what the active agent hooks collect. `git:` shows whether the managed repo-local git hooks are installed. `commit:` tells you the primary tracking path: normal `git commit` when git hooks are active, or fallback mode when you should prefer `agent-note commit`.

## What You Get

### Every commit tells its story

```
$ npx agent-note show

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
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR reports

```
$ npx agent-note pr --output description --update 42
```

This posts an AI session report to the PR description:

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://wasabeef.github.io/AgentNote/dashboard/">Open Dashboard ↗</a></div>
```

## How It Works

```
You prompt your coding agent
        │
        ▼
Hooks capture the prompt and session metadata
        │
        ▼
The agent edits files
        │
        ▼
Hooks or local transcripts record files touched and attribution signals
        │
        ▼
You run `git commit`
        │
        ▼
Agent Note writes a git note for that commit
        │
        ▼
You run `git push`
        │
        ▼
`refs/notes/agentnote` is pushed alongside your branch
```

## Commands

| Command | What it does |
| --- | --- |
| `agent-note init` | Set up hooks, workflow, git hooks, and notes auto-fetch |
| `agent-note deinit` | Remove hooks and config for an agent |
| `agent-note show [commit]` | Show the AI session behind `HEAD` or a commit SHA |
| `agent-note log [n]` | List recent commits with AI ratio |
| `agent-note pr [base]` | Generate PR report (markdown or JSON) |
| `agent-note session <id>` | Show all commits linked to one session |
| `agent-note commit [args]` | Fallback wrapper around `git commit` when git hooks are unavailable |
| `agent-note status` | Show tracking state |

## GitHub Action

Examples in this section assume `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` is set.

```yaml
- uses: wasabeef/AgentNote@v0
```

### Dashboard data

If you want the shared Dashboard on GitHub Pages:

1. Run `agent-note init --agent <name...> --dashboard`.
2. Commit `.github/workflows/agentnote-pr-report.yml` and `.github/workflows/agentnote-dashboard.yml`.
3. Enable GitHub Pages and choose `GitHub Actions` as the source.

```bash
npx agent-note init --agent claude --dashboard
```

The generated Dashboard workflow restores and persists `gh-pages/dashboard/notes/*.json`, then publishes the shared `/dashboard/` view.

This keeps generated JSON off the `default branch` while still letting Dashboard data accumulate before the first public publish. Pull requests update the shared Dashboard with open history, and `default branch` pushes replace it with the merged state.

<details>
<summary>Full example with outputs</summary>

```yaml
- uses: wasabeef/AgentNote@v0
  id: agent-note
  with:
    base: main

# Use structured outputs
- run: echo "AI ratio: ${{ steps.agent-note.outputs.overall_ai_ratio }}%"
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

## Security & Privacy

- Agent Note is local-first. The core CLI works without a hosted service.
- Temporary session data is stored under `.git/agentnote/` inside your repository.
- The permanent record is stored in `refs/notes/agentnote`, not in tracked source files.
- For transcript-driven agents, Agent Note reads local transcript files from the agent's own data directory.
- The CLI does not send telemetry.
- Commit tracking is best-effort. If Agent Note fails during a hook, your `git commit` still succeeds.

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Architecture details →](docs/knowledge/DESIGN.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
