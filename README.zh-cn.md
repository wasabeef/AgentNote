# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [zh-CN] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — 将 AI 对话保存到 Git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>不仅知道代码<em>改了什么</em>，也知道<em>为什么改</em>。</strong></p>

<p align="center">
Agent Note 会为每个 Commit 保存与 AI 的对话和变更文件。信息足够时，它还会显示这次变更中 AI 参与程度的实用估算。
</p>

<p align="center">
可以把它看作 <code>git log</code> 加上变更背后的 AI 对话。
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/zh-cn/">文档</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## 为什么选择 Agent Note

- 为每个 AI 辅助 Commit 记录 prompt、response、变更文件和 AI Ratio。
- 继续使用普通 `git commit`；Agent Note 会在后台记录上下文。
- 为人工 reviewer 和 AI Review tool 提供 PR Report，包含可见摘要和隐藏的 Reviewer Context。
- 打开共享 Dashboard，或用 `agent-note why <file:line>` 从某一行回到对应 Commit 的对话。
- 所有数据都以 Git-native 方式保存在 `refs/notes/agentnote`，没有 Hosted Service，也没有 Telemetry。

## 要求

- Git
- Node.js 20 或更高版本
- 已安装并认证的受支持 Coding Agent

## Quick Start

1. 为你的 Coding Agent 启用 Agent Note。

```bash
npx agent-note init --agent claude
# 或: codex / cursor / gemini
```

每位开发者在 Clone 后都应该在本地执行一次。

同一个 Repository 可以启用多个 Agent：

```bash
npx agent-note init --agent claude cursor
```

如果还想使用 GitHub Pages 上的 shared Dashboard：

```bash
npx agent-note init --agent claude --dashboard
```

2. 提交生成的文件并 Push。

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# 请把 .claude/settings.json 替换成下面对应的 agent config
# 使用 --dashboard 时，也添加 .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code：提交 `.claude/settings.json`
- Codex CLI：提交 `.codex/config.toml` 和 `.codex/hooks.json`
- Cursor：提交 `.cursor/hooks.json`
- Gemini CLI：提交 `.gemini/settings.json`

3. 继续使用平常的 `git commit` Workflow。

安装生成的 Git Hooks 后，Agent Note 会自动记录普通 `git commit`。

## AI Agent Skill

如果你的 AI Agent 支持 GitHub Agent Skills，可以安装 Agent Note Skill，用自然语言请求 Agent Note 相关任务。

```bash
gh skill install wasabeef/AgentNote agent-note --agent codex --scope user
```

对于 `gh skill install`，请根据 Agent 选择对应的 identifier: `codex`, `claude-code`, `cursor` or `gemini-cli`。Skill 通常只会引导 agent 使用六个公开命令: `init`、`deinit`、`status`、`log`、`show`、`why`。

## 保存的数据

Agent Note 保存 Commit Story：

- 对话：促成变更的请求和 AI 回复
- Context：请求本身太短时显示为 `📝 Context` 的补充说明

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- 文件：变更的文件，以及 AI 是否参与编辑
- AI Ratio：Commit 整体的估算值，以及可估算时的行数

Temporary Session Data 保存在 `.git/agentnote/`。Permanent Record 保存在 `refs/notes/agentnote`，并通过 `git push` 共享。

### 将生成的 Bundle 排除在 AI Ratio 之外

如果提交的 bundle 或 generated output 需要继续显示，但不应影响 AI Ratio，请把它们写入 repository root 的 `.agentnoteignore`：

```gitignore
packages/cli/dist/**
packages/pr-report/dist/**
```

这些文件仍会出现在 Notes、PR Report 和 Dashboard 中，只会从 AI Ratio 的分母里排除。

## Agent Support

| Agent | Status | Prompt | Response | Files | AI Ratio | Line Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Full support | 是 | 是 | 是 | 是 | 默认显示 |
| Codex CLI | Supported | 是 | 是 | 是 | 是 | 当 Codex patch 记录与最终 Commit 匹配时 |
| Cursor | Supported | 是 | 是 | 是 | 是 | 当 edit 数匹配，且最终 file 仍匹配最后一次 AI edit 时 |
| Gemini CLI | Preview | 是 | 是 | 是 | 是 | 尚未支持 |

`Files` 表示 Agent Note 可以显示 Agent 触碰过哪些已提交文件。`Line Estimate` 表示它还可以估算 AI 编写的行，而不是只统计文件。

## 检查设置

```bash
npx agent-note status
```

```text
agent-note v1.x.x

agent:   active (cursor)
capture: cursor(prompt, response, edits, shell)
git:     active (prepare-commit-msg, post-commit, pre-push)
commit:  tracked via git hooks
session: a1b2c3d4…
agent:   cursor
linked:  3/20 recent commits
```

`agent:` 显示已启用的 Agent Adapters。`capture:` 概述 Active Agent Hooks 会收集什么。`git:` 显示 Managed Repository-Local Git Hooks 是否已安装。`commit:` 显示普通 `git commit` 是否是 Primary Tracking Path。

## 你会得到什么

### 每个 Commit 都讲述自己的 Story

```
$ npx agent-note show

commit:  ce941f7 feat: add JWT auth middleware
session: a1b2c3d4-5678-4abc-8def-111122223333

ai:      60% (45/75 lines) [█████░░░]
model:   claude-sonnet-4-20250514
agent:   claude
files:   3 changed, 2 by AI

  src/middleware/auth.ts  🤖
  src/types/token.ts  🤖
  src/middleware/__tests__/auth.test.ts  🤖
  CHANGELOG.md  👤
  README.md  👤

prompts: 2

  1. Implement JWT auth middleware with refresh token rotation
  2. Add tests for expired token and invalid signature
```

### 一眼扫描 history

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Report

默认情况下，GitHub Action 会把 AI Session Report 发布到 PR Description：

`agentnote-reviewer-context` block 会作为 hidden comment 保存在 PR body 中。Copilot、CodeRabbit、Devin、Greptile 等读取 raw PR description 的 AI Review tool 可以把它作为额外的 intent 和 review focus。

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

<!-- agentnote-reviewer-context

Generated from Agent Note data. Use this as intent and review focus, not as proof that the implementation is correct.

Changed areas:

- Documentation: `README.md`, `docs/usage.md`
- Source: `src/auth.ts`
- Tests: `src/auth.test.ts`

Review focus:

- Check that docs and examples match the implemented behavior.
- Compare the stated intent with the changed source files and prompt evidence.

Author intent signals:

- Commit: feat: add auth
- Prompt: Add JWT authentication and update the PR docs
-->

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/?pr=123" target="_blank" rel="noopener noreferrer">Open Dashboard ↗</a></div>
```

## 工作原理

```
向 Coding Agent 发送 Prompt
        │
        ▼
Hooks 记录对话和 Session 信息
        │
        ▼
Agent 编辑文件
        │
        ▼
Hooks 或 Local Transcripts 记录变更文件
        │
        ▼
执行 `git commit`
        │
        ▼
Agent Note 为该 Commit 写入 Git Note
        │
        ▼
执行 `git push`
        │
        ▼
`refs/notes/agentnote` 随 Branch 一起 push
```

详细 Flow、AI 参与比例的估算方式和保存格式请参阅 [工作原理](https://wasabeef.github.io/AgentNote/zh-cn/how-it-works/)。

## Commands

| Command | 作用 |
| --- | --- |
| `agent-note init` | 设置 Hooks、Workflow、Git Hooks 和 notes auto-fetch |
| `agent-note deinit` | 移除 Agent Note hooks 和 config |
| `agent-note status` | 显示 Tracking state |
| `agent-note log [n]` | 列出 Recent Commits 和 AI Ratio |
| `agent-note show [commit]` | 显示 `HEAD` 或 Commit SHA 背后的 AI Session |
| `agent-note why <target>` | 显示最后修改某一行或范围的 Commit 的 Agent Note context |

## GitHub Action

root action 有两种 mode：

- PR Report Mode 更新 Pull Request description 或发布 comment。
- Dashboard Mode 构建共享 Dashboard 数据，并通过 GitHub Pages 发布到 `/dashboard/`。

PR Report Mode 是默认值：

```yaml
- uses: wasabeef/AgentNote@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

如果想让 Prompt 历史保持重点或完整显示，可以把 `prompt_detail` 设为 `compact` 或 `full`。默认值是 `compact`：它会优先显示解释 Commit 所需的 Prompt，`full` 会显示所有已保存的 Prompt。

Dashboard Mode 使用同一个 action，并传入 `dashboard: true`：

```yaml
- uses: wasabeef/AgentNote@v1
  with:
    dashboard: true
    prompt_detail: compact
```

### Dashboard 数据

大多数仓库不需要手写 Workflow。直接用 `init` 生成：

```bash
npx agent-note init --agent claude --dashboard
```

然后 Commit `.github/workflows/agentnote-pr-report.yml` 和 `.github/workflows/agentnote-dashboard.yml`，在 GitHub Pages 中选择 `GitHub Actions` 作为 Source，并打开 `/dashboard/`。

如果已经有 GitHub Pages Site，请查看 [Dashboard Docs](https://wasabeef.github.io/AgentNote/zh-cn/dashboard/) 了解安全的合并设置。

<details>
<summary>Full example with outputs</summary>

```yaml
- uses: wasabeef/AgentNote@v1
  id: agent-note
  with:
    base: main

# Use structured outputs
- run: echo "Total AI Ratio: ${{ steps.agent-note.outputs.overall_ai_ratio }}%"
```

</details>

<details>
<summary>保存的数据</summary>

```bash
$ git notes --ref=agentnote show ce941f7
```

```json
{
  "v": 1,
  "agent": "claude",
  "session_id": "a1b2c3d4-...",
  "timestamp": "2026-04-02T10:30:00Z",
  "model": "claude-sonnet-4-20250514",
  "interactions": [
    {
      "prompt": "Implement JWT auth middleware",
      "contexts": [
        {
          "kind": "scope",
          "source": "current_response",
          "text": "I will create the JWT auth middleware and wire it into the request pipeline."
        }
      ],
      "selection": {
        "schema": 1,
        "source": "primary",
        "signals": ["primary_edit_turn"]
      },
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

- Agent Note 是 Local-first。Core CLI 不需要 Hosted Service。
- Temporary Session Data 存储在仓库内的 `.git/agentnote/`。
- Permanent Record 存储在 `refs/notes/agentnote`，而不是 Tracked Source Files。
- 对于保存本地对话日志的 Agent，Agent Note 会从 Agent 自己的 Data Directory 读取这些文件。
- CLI 不发送 Telemetry。
- Commit Tracking 是 Best-effort。如果 Agent Note 在 Hook 中失败，你的 `git commit` 仍会成功。

## Design

Zero runtime dependencies · Git notes storage · Never breaks `git commit` · No telemetry · Agent-agnostic architecture

[架构详情 →](docs/architecture.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
