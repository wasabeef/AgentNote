# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [zh-CN] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>不仅知道代码<em>改了什么</em>，也知道<em>为什么改</em>。</strong></p>

<p align="center">
Agent Note 会记录每个 prompt、response 和 AI-attributed file，并把这些 context 关联到你的 git commits。当 agent 暴露足够的 edit history 时，它可以达到 line-level attribution。
</p>

<p align="center">
可以把它看作 <code>git log</code> 加上变更背后的 AI conversation。
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/zh-cn/">文档</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## 为什么选择 Agent Note

- 查看每个 AI-assisted commit 背后的 prompt 和 response。
- 在 Pull Request 中直接 review AI-authored files 和 AI ratio。
- 打开 shared Dashboard，把 commit history 变成可读的 story。
- 数据以 git-native 方式保存在 `refs/notes/agentnote`，没有 hosted service，也没有 telemetry。

## 要求

- Git
- Node.js 20 或更高版本
- 已安装并认证的受支持 coding agent

## Quick Start

1. 为你的 coding agent 启用 Agent Note。

```bash
npx agent-note init --agent claude
# 或: codex / cursor / gemini
```

每位 developer 在 clone 后都应该在本地执行一次。

同一个 repository 可以启用多个 agent：

```bash
npx agent-note init --agent claude cursor
```

如果还想使用 GitHub Pages 上的 shared Dashboard：

```bash
npx agent-note init --agent claude --dashboard
```

2. 提交生成的文件并 push。

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

3. 继续使用平常的 `git commit` workflow。

安装生成的 git hooks 后，Agent Note 会自动记录 commits。只有当 git hooks 不可用时，才把 `agent-note commit -m "..."` 作为 fallback 使用。

## 保存的数据

Agent Note 保存 commit story：

- `prompt` / `response`：变更背后的对话
- `contexts[]`：prompt 太短时会显示为 `📝 Context` 的 display-only 提示

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- `files`：变更的 file，以及 AI 是否触碰过
- `attribution`：AI ratio、method，以及可用时的 line counts

Temporary session data 保存在 `.git/agentnote/`。Permanent record 保存在 `refs/notes/agentnote`，并通过 `git push` 共享。

## Agent Support

| Agent | Status | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | 默认 Line-level | Hook-native prompt / response recovery |
| Codex CLI | Preview | 默认 File-level | Transcript-driven。只有当 transcript 的 `apply_patch` count 与 final commit diff 匹配时才升级为 line-level。如果无法读取 transcript，Agent Note 会跳过 note 创建，而不是写入不确定的数据。 |
| Cursor | Supported | 默认 File-level | 使用 `afterFileEdit` / `afterTabFileEdit` hooks。只有 committed blob 仍匹配 latest AI edit 时才升级为 line-level。 |
| Gemini CLI | Preview | File-level | 通过生成的 git hooks 支持 hook-based capture 和普通 `git commit` |

## 检查设置

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

`agent:` 显示已启用的 agent adapters。`capture:` 概述 active agent hooks 会收集什么。`git:` 显示 managed repository-local git hooks 是否已安装。`commit:` 显示 primary tracking path：git hooks active 时是普通 `git commit`，fallback mode 时应优先使用 `agent-note commit`。

## 你会得到什么

### 每个 commit 都讲述自己的 story

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

### 一眼扫描 history

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Report

```
$ npx agent-note pr --output description --update 42
```

这会把 AI session report 发布到 PR description：

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## 工作原理

```
向 coding agent 发送 prompt
        │
        ▼
hooks 记录 prompt 和 session metadata
        │
        ▼
agent 编辑 files
        │
        ▼
hooks 或 local transcripts 记录 touched files 和 attribution signals
        │
        ▼
执行 `git commit`
        │
        ▼
Agent Note 为该 commit 写入 git note
        │
        ▼
执行 `git push`
        │
        ▼
`refs/notes/agentnote` 随 branch 一起 push
```

详细 flow、attribution rules 和 schema 请参阅 [工作原理](https://wasabeef.github.io/AgentNote/zh-cn/how-it-works/)。

## Commands

| Command | 作用 |
| --- | --- |
| `agent-note init` | 设置 hooks、workflow、git hooks 和 notes auto-fetch |
| `agent-note deinit` | 移除某个 agent 的 hooks 和 config |
| `agent-note show [commit]` | 显示 `HEAD` 或 commit SHA 背后的 AI session |
| `agent-note log [n]` | 列出 recent commits 和 AI ratio |
| `agent-note pr [base]` | 生成 PR Report (markdown 或 JSON) |
| `agent-note session <id>` | 显示关联到某个 session 的所有 commits |
| `agent-note commit [args]` | git hooks 不可用时的 `git commit` fallback wrapper |
| `agent-note status` | 显示 tracking state |

## GitHub Action

root action 有两种 mode：

- PR Report Mode 更新 Pull Request description 或发布 comment。
- Dashboard Mode 构建共享 Dashboard 数据，并通过 GitHub Pages 发布到 `/dashboard/`。

PR Report Mode 是默认值：

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

如果想让 prompt 历史保持重点或完整显示，可以把 `prompt_detail` 设为 `compact` 或 `full`。默认值是 `compact`：它会优先显示解释 commit 所需的 prompt，`full` 会显示所有已保存的 prompt。

Dashboard Mode 使用同一个 action，并传入 `dashboard: true`：

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
    prompt_detail: compact
```

### Dashboard 数据

大多数仓库不需要手写 workflow。直接用 `init` 生成：

```bash
npx agent-note init --agent claude --dashboard
```

然后 commit `.github/workflows/agentnote-pr-report.yml` 和 `.github/workflows/agentnote-dashboard.yml`，在 GitHub Pages 中选择 `GitHub Actions` 作为 source，并打开 `/dashboard/`。

如果已经有 GitHub Pages site，请查看 [Dashboard docs](https://wasabeef.github.io/AgentNote/zh-cn/dashboard/) 了解安全的合并设置。

<details>
<summary>Full example with outputs</summary>

```yaml
- uses: wasabeef/AgentNote@v0
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

- Agent Note 是 local-first。core CLI 不需要 hosted service。
- Temporary session data 存储在仓库内的 `.git/agentnote/`。
- Permanent record 存储在 `refs/notes/agentnote`，而不是 tracked source files。
- 对于 transcript-driven agents，Agent Note 会从 agent 自己的 data directory 读取 local transcript files。
- CLI 不发送 telemetry。
- Commit tracking 是 best-effort。如果 Agent Note 在 hook 中失败，你的 `git commit` 仍会成功。

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Architecture details →](docs/architecture.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
