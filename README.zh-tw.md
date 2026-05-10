# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [zh-TW] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — 將 AI 對話保存到 Git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>不只知道程式碼<em>改了什麼</em>，也知道<em>為什麼改</em>。</strong></p>

<p align="center">
Agent Note 會為每個 Commit 保存與 AI 的對話和變更檔案。資訊足夠時，也會顯示這次變更中 AI 參與程度的實用估算。
</p>

<p align="center">
可以把它看作 <code>git log</code> 加上變更背後的 AI 對話。
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/zh-tw/">文件</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## 為什麼選擇 Agent Note

- 查看每個 AI 輔助 Commit 背後的對話。
- 在 Pull Request 中查看 AI 參與修改的檔案和 AI Ratio 估算。
- 在 PR body 的 hidden comment 中提供 Reviewer Context，讓 Copilot、CodeRabbit、Devin、Greptile 等 AI Review tool 能帶著作者意圖和檢查重點進行 review。
- 打開共享 Dashboard，把 Commit History 變成可讀的故事線。
- 資料以 Git-native 方式保存在 `refs/notes/agentnote`，沒有 Hosted Service，也沒有 Telemetry。

## 需求

- Git
- Node.js 20 或更新版本
- 已安裝並認證的支援 Coding Agent

## Quick Start

1. 為你的 Coding Agent 啟用 Agent Note。

```bash
npx agent-note init --agent claude
# 或: codex / cursor / gemini
```

每位開發者在 Clone 後都應該在本機執行一次。

同一個 Repository 可以啟用多個 Agent：

```bash
npx agent-note init --agent claude cursor
```

如果也想使用 GitHub Pages 上的 shared Dashboard：

```bash
npx agent-note init --agent claude --dashboard
```

2. 提交產生的檔案並 Push。

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# 請把 .claude/settings.json 換成下面對應的 agent config
# 使用 --dashboard 時，也加入 .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code：提交 `.claude/settings.json`
- Codex CLI：提交 `.codex/config.toml` 和 `.codex/hooks.json`
- Cursor：提交 `.cursor/hooks.json`
- Gemini CLI：提交 `.gemini/settings.json`

3. 繼續使用平常的 `git commit` Workflow。

安裝產生的 Git Hooks 後，Agent Note 會自動記錄一般 `git commit`。

## AI Agent Skill

如果你的 AI Agent 支援 GitHub Agent Skills，可以安裝 Agent Note Skill，用自然語言請求 Agent Note 相關任務。

```bash
gh skill install wasabeef/AgentNote agent-note --agent codex --scope user
```

對於 `gh skill install`，請依照 Agent 選擇對應的 identifier: `codex`, `claude-code`, `cursor` or `gemini-cli`。Skill 通常只會引導 agent 使用六個公開命令: `init`、`deinit`、`status`、`log`、`show`、`why`。

## 保存的資料

Agent Note 保存 Commit Story：

- 對話：促成變更的請求和 AI 回覆
- Context：請求本身太短時顯示為 `📝 Context` 的補充說明

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- 檔案：變更的檔案，以及 AI 是否參與編輯
- AI Ratio：Commit 整體的估算值，以及可估算時的行數

Temporary Session Data 保存在 `.git/agentnote/`。Permanent Record 保存在 `refs/notes/agentnote`，並透過 `git push` 分享。

### 將生成的 Bundle 排除在 AI Ratio 之外

如果提交的 bundle 或 generated output 需要繼續顯示，但不應影響 AI Ratio，請把它們寫入 repository root 的 `.agentnoteignore`：

```gitignore
packages/cli/dist/**
packages/pr-report/dist/**
```

這些檔案仍會出現在 Notes、PR Report 和 Dashboard 中，只會從 AI Ratio 的分母中排除。

## Agent Support

| Agent | Status | Prompt | Response | Files | AI Ratio | Line Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Full support | 是 | 是 | 是 | 是 | 預設顯示 |
| Codex CLI | Supported | 是 | 是 | 是 | 是 | 當 Codex patch 記錄與最終 Commit 相符時 |
| Cursor | Supported | 是 | 是 | 是 | 是 | 當 edit 數相符，且最終 file 仍符合最後一次 AI edit 時 |
| Gemini CLI | Preview | 是 | 是 | 是 | 是 | 尚未支援 |

`Files` 表示 Agent Note 可以顯示 Agent 觸碰過哪些已提交檔案。`Line Estimate` 表示它還可以估算 AI 編寫的行，而不是只統計檔案。

## 檢查設定

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

`agent:` 顯示已啟用的 Agent Adapters。`capture:` 概述 Active Agent Hooks 會收集什麼。`git:` 顯示 Managed Repository-Local Git Hooks 是否已安裝。`commit:` 顯示一般 `git commit` 是否是 Primary Tracking Path。

## 你會得到什麼

### 每個 Commit 都講述自己的 Story

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

### 一眼掃描 history

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Report

預設情況下，GitHub Action 會把 AI Session Report 發佈到 PR Description：

`agentnote-reviewer-context` block 會作為 hidden comment 保存在 PR body 中。Copilot、CodeRabbit、Devin、Greptile 等讀取 raw PR description 的 AI Review tool 可以把它作為額外的 intent 和 review focus。

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

## 運作原理

```
向 Coding Agent 送出 Prompt
        │
        ▼
Hooks 記錄對話和 Session 資訊
        │
        ▼
Agent 編輯檔案
        │
        ▼
Hooks 或 Local Transcripts 記錄變更檔案
        │
        ▼
執行 `git commit`
        │
        ▼
Agent Note 為該 Commit 寫入 Git Note
        │
        ▼
執行 `git push`
        │
        ▼
`refs/notes/agentnote` 隨 Branch 一起 push
```

詳細 Flow、AI 參與比例的估算方式和保存格式請參閱 [運作原理](https://wasabeef.github.io/AgentNote/zh-tw/how-it-works/)。

## Commands

| Command | 作用 |
| --- | --- |
| `agent-note init` | 設定 Hooks、Workflow、Git Hooks 和 notes auto-fetch |
| `agent-note deinit` | 移除 Agent Note hooks 和 config |
| `agent-note status` | 顯示 Tracking state |
| `agent-note log [n]` | 列出 Recent Commits 和 AI Ratio |
| `agent-note show [commit]` | 顯示 `HEAD` 或 Commit SHA 背後的 AI Session |
| `agent-note why <target>` | 顯示最後修改某一行或範圍的 Commit 的 Agent Note context |

## GitHub Action

root action 有兩種 mode：

- PR Report Mode 更新 Pull Request description 或發佈 comment。
- Dashboard Mode 建構共享 Dashboard 資料，並透過 GitHub Pages 發佈到 `/dashboard/`。

PR Report Mode 是預設值：

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

如果想讓 Prompt 歷史保持重點或完整顯示，可以把 `prompt_detail` 設為 `compact` 或 `full`。預設值是 `compact`：它會優先顯示解釋 Commit 所需的 Prompt，`full` 會顯示所有已保存的 Prompt。

Dashboard Mode 使用同一個 action，並傳入 `dashboard: true`：

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
    prompt_detail: compact
```

### Dashboard 資料

大多數儲存庫不需要手寫 Workflow。直接用 `init` 產生：

```bash
npx agent-note init --agent claude --dashboard
```

然後 Commit `.github/workflows/agentnote-pr-report.yml` 和 `.github/workflows/agentnote-dashboard.yml`，在 GitHub Pages 中選擇 `GitHub Actions` 作為 Source，並開啟 `/dashboard/`。

如果已經有 GitHub Pages Site，請查看 [Dashboard Docs](https://wasabeef.github.io/AgentNote/zh-tw/dashboard/) 了解安全的合併設定。

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
<summary>保存的資料</summary>

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
- Temporary Session Data 儲存在儲存庫內的 `.git/agentnote/`。
- Permanent Record 儲存在 `refs/notes/agentnote`，而不是 Tracked Source Files。
- 對於保存本機對話記錄的 Agent，Agent Note 會從 Agent 自己的 Data Directory 讀取這些檔案。
- CLI 不傳送 Telemetry。
- Commit Tracking 是 Best-effort。如果 Agent Note 在 Hook 中失敗，你的 `git commit` 仍會成功。

## Design

Zero runtime dependencies · Git notes storage · Never breaks `git commit` · No telemetry · Agent-agnostic architecture

[架構詳情 →](docs/architecture.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
