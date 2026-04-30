# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [zh-TW] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>不只知道程式碼<em>改了什麼</em>，也知道<em>為什麼改</em>。</strong></p>

<p align="center">
Agent Note 會記錄每個 prompt、response 和 AI-attributed file，並把這些 context 連結到你的 git commits。當 agent 提供足夠的 edit history 時，它可以做到 line-level attribution。
</p>

<p align="center">
可以把它看作 <code>git log</code> 加上變更背後的 AI conversation。
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/zh-tw/">文件</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## 為什麼選擇 Agent Note

- 查看每個 AI-assisted commit 背後的 prompt 和 response。
- 在 Pull Request 中直接 review AI-authored files 和 AI ratio。
- 打開 shared Dashboard，把 commit history 變成可讀的 story。
- 資料以 git-native 方式保存在 `refs/notes/agentnote`，沒有 hosted service，也沒有 telemetry。

## 需求

- Git
- Node.js 20 或更新版本
- 已安裝並認證的支援 coding agent

## Quick Start

1. 為你的 coding agent 啟用 Agent Note。

```bash
npx agent-note init --agent claude
# 或: codex / cursor / gemini
```

每位 developer 在 clone 後都應該在本機執行一次。

同一個 repository 可以啟用多個 agent：

```bash
npx agent-note init --agent claude cursor
```

如果也想使用 GitHub Pages 上的 shared Dashboard：

```bash
npx agent-note init --agent claude --dashboard
```

2. 提交產生的檔案並 push。

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

3. 繼續使用平常的 `git commit` workflow。

安裝產生的 git hooks 後，Agent Note 會自動記錄 commits。只有當 git hooks 不可用時，才把 `agent-note commit -m "..."` 作為 fallback 使用。

## 保存的資料

Agent Note 保存 commit story：

- `prompt` / `response`：變更背後的對話
- `contexts[]`：prompt 太短時的 display-only 提示
- `files`：變更的 file，以及 AI 是否觸碰過
- `attribution`：AI ratio、method，以及可用時的 line counts

Temporary session data 保存在 `.git/agentnote/`。Permanent record 保存在 `refs/notes/agentnote`，並透過 `git push` 分享。

## Agent Support

| Agent | Status | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | 預設 Line-level | Hook-native prompt / response recovery |
| Codex CLI | Preview | 預設 File-level | Transcript-driven。只有當 transcript 的 `apply_patch` count 與 final commit diff 相符時才升級為 line-level。如果無法讀取 transcript，Agent Note 會略過 note 建立，而不是寫入不確定的資料。 |
| Cursor | Supported | 預設 File-level | 使用 `afterFileEdit` / `afterTabFileEdit` hooks。只有 committed blob 仍符合 latest AI edit 時才升級為 line-level。 |
| Gemini CLI | Preview | File-level | 透過產生的 git hooks 支援 hook-based capture 和一般 `git commit` |

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

`agent:` 顯示已啟用的 agent adapters。`capture:` 概述 active agent hooks 會收集什麼。`git:` 顯示 managed repository-local git hooks 是否已安裝。`commit:` 顯示 primary tracking path：git hooks active 時是一般 `git commit`，fallback mode 時應優先使用 `agent-note commit`。

## 你會得到什麼

### 每個 commit 都講述自己的 story

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

### 一眼掃描 history

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Reports

```
$ npx agent-note pr --output description --update 42
```

這會把 AI session report 發佈到 PR description：

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## 運作原理

```
向 coding agent 送出 prompt
        │
        ▼
hooks 記錄 prompt 和 session metadata
        │
        ▼
agent 編輯 files
        │
        ▼
hooks 或 local transcripts 記錄 touched files 和 attribution signals
        │
        ▼
執行 `git commit`
        │
        ▼
Agent Note 為該 commit 寫入 git note
        │
        ▼
執行 `git push`
        │
        ▼
`refs/notes/agentnote` 隨 branch 一起 push
```

詳細 flow、attribution rules 和 schema 請參閱 [運作原理](https://wasabeef.github.io/AgentNote/zh-tw/how-it-works/)。

## Commands

| Command | 作用 |
| --- | --- |
| `agent-note init` | 設定 hooks、workflow、git hooks 和 notes auto-fetch |
| `agent-note deinit` | 移除某個 agent 的 hooks 和 config |
| `agent-note show [commit]` | 顯示 `HEAD` 或 commit SHA 背後的 AI session |
| `agent-note log [n]` | 列出 recent commits 和 AI ratio |
| `agent-note pr [base]` | 產生 PR Report (markdown 或 JSON) |
| `agent-note session <id>` | 顯示關聯到某個 session 的所有 commits |
| `agent-note commit [args]` | git hooks 不可用時的 `git commit` fallback wrapper |
| `agent-note status` | 顯示 tracking state |

## GitHub Action

root action 有兩種 mode：

- PR Report mode 更新 Pull Request description 或發佈 comment。
- Dashboard mode 建構 shared Dashboard data，並透過 GitHub Pages 發佈到 `/dashboard/`。

PR Report mode 是 default：

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Dashboard mode 使用同一個 action，並傳入 `dashboard: true`：

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
```

### Dashboard data

大多數 repository 不需要手寫 workflow。直接產生：

```bash
npx agent-note init --agent claude --dashboard
```

然後 commit `.github/workflows/agentnote-pr-report.yml` 和 `.github/workflows/agentnote-dashboard.yml`，在 GitHub Pages 中選擇 `GitHub Actions` 作為 source，並開啟 `/dashboard/`。

如果已經有 GitHub Pages site，請查看 [Dashboard docs](https://wasabeef.github.io/AgentNote/zh-tw/dashboard/) 了解安全的合併設定。

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
- Temporary session data 儲存在 repository 內的 `.git/agentnote/`。
- Permanent record 儲存在 `refs/notes/agentnote`，而不是 tracked source files。
- 對於 transcript-driven agents，Agent Note 會從 agent 自己的 data directory 讀取 local transcript files。
- CLI 不傳送 telemetry。
- Commit tracking 是 best-effort。如果 Agent Note 在 hook 中失敗，你的 `git commit` 仍會成功。

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Architecture details →](docs/knowledge/DESIGN.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
