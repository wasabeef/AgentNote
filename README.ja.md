# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [ja] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>コードが<em>何に</em>変わったかだけでなく、<em>なぜ</em>変わったかを残します。</strong></p>

<p align="center">
Agent Note は prompt、response、AI が触った file を記録し、その context を git commit に紐づけます。agent が十分な edit history を出せる場合は line-level attribution まで行います。
</p>

<p align="center">
<code>git log</code> に、その変更の裏側にある AI conversation を足すものだと考えてください。
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/ja/">ドキュメント</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## なぜ Agent Note か

- AI-assisted commit の prompt と response を後から確認できます。
- AI-authored files と AI ratio を Pull Request 上で確認できます。
- shared Dashboard で commit history を読みやすい story として開けます。
- データは `refs/notes/agentnote` に残る git-native 方式です。hosted service も telemetry もありません。

## 要件

- Git
- Node.js 20 以上
- 対応している coding agent のインストールと認証

## Quick Start

1. coding agent に Agent Note を有効化します。

```bash
npx agent-note init --agent claude
# または: codex / cursor / gemini
```

clone 後に各 developer が一度だけ実行してください。

同じ repository で複数 agent を有効化できます。

```bash
npx agent-note init --agent claude cursor
```

GitHub Pages の shared Dashboard も使う場合:

```bash
npx agent-note init --agent claude --dashboard
```

2. 生成された file を commit して push します。

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# .claude/settings.json は下記の agent config に置き換えてください
# --dashboard を使う場合は .github/workflows/agentnote-dashboard.yml も追加
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: `.claude/settings.json` を commit
- Codex CLI: `.codex/config.toml` と `.codex/hooks.json` を commit
- Cursor: `.cursor/hooks.json` を commit
- Gemini CLI: `.gemini/settings.json` を commit

3. いつもの `git commit` workflow をそのまま使います。

生成された git hooks が入っていれば、Agent Note は commit を自動記録します。git hooks が使えない場合だけ fallback として `agent-note commit -m "..."` を使ってください。

## 保存するもの

Agent Note は commit story を保存します。

- `prompt` / `response`: 変更に至った会話
- `contexts[]`: prompt が短すぎるときの display-only な補足
- `files`: 変更された file と AI が触ったかどうか
- `attribution`: AI ratio、method、取得できる場合は line counts

Temporary session data は `.git/agentnote/` に置かれます。permanent record は `refs/notes/agentnote` に保存され、`git push` で共有されます。

## Agent Support

| Agent | Status | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | Line-level by default | Hook-native prompt / response recovery |
| Codex CLI | Preview | File-level by default | Transcript-driven。transcript の `apply_patch` count が final commit diff と一致した場合だけ line-level に昇格します。transcript を読めない場合は、不確かな data を書く代わりに note 作成を skip します。 |
| Cursor | Supported | File-level by default | `afterFileEdit` / `afterTabFileEdit` hooks を使います。committed blob が latest AI edit と一致している場合だけ line-level に昇格します。 |
| Gemini CLI | Preview | File-level | generated git hooks により、hook-based capture と通常の `git commit` をサポートします。 |

## Setup を確認する

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

`agent:` は有効な agent adapters を示します。`capture:` は active agent hooks が何を収集するかを要約します。`git:` は managed repository-local git hooks が入っているかを示します。`commit:` は primary tracking path を示します。git hooks が active なら通常の `git commit`、fallback mode なら `agent-note commit` を優先します。

## 得られるもの

### すべての commit が story を持つ

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

### history をひと目で scan

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

これは AI session report を PR description に投稿します。

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## 仕組み

```
coding agent に prompt を送る
        │
        ▼
hooks が prompt と session metadata を記録する
        │
        ▼
agent が files を編集する
        │
        ▼
hooks または local transcripts が touched files と attribution signals を記録する
        │
        ▼
`git commit` を実行する
        │
        ▼
Agent Note がその commit に git note を書く
        │
        ▼
`git push` を実行する
        │
        ▼
`refs/notes/agentnote` が branch と一緒に push される
```

詳しい flow、attribution rules、schema は [仕組み](https://wasabeef.github.io/AgentNote/ja/how-it-works/) を参照してください。

## Commands

| Command | What it does |
| --- | --- |
| `agent-note init` | hooks、workflow、git hooks、notes auto-fetch を設定します |
| `agent-note deinit` | agent の hooks と config を削除します |
| `agent-note show [commit]` | `HEAD` または commit SHA の AI session を表示します |
| `agent-note log [n]` | recent commits と AI ratio を一覧します |
| `agent-note pr [base]` | PR Report を生成します (markdown または JSON) |
| `agent-note session <id>` | 1 つの session に紐づく全 commit を表示します |
| `agent-note commit [args]` | git hooks が使えない場合の `git commit` fallback wrapper |
| `agent-note status` | tracking state を表示します |

## GitHub Action

root action には 2 つの mode があります。

- PR Report mode は Pull Request description を更新するか comment を投稿します。
- Dashboard mode は shared Dashboard data を build し、GitHub Pages の `/dashboard/` に publish します。

PR Report mode が default です。

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Dashboard mode は同じ action に `dashboard: true` を渡します。

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
```

### Dashboard data

ほとんどの repository では workflow を手書きする必要はありません。生成します。

```bash
npx agent-note init --agent claude --dashboard
```

`.github/workflows/agentnote-pr-report.yml` と `.github/workflows/agentnote-dashboard.yml` を commit し、GitHub Pages の source に `GitHub Actions` を選び、`/dashboard/` を開きます。

既存の GitHub Pages site がある場合は、安全に同居させる方法を [Dashboard docs](https://wasabeef.github.io/AgentNote/ja/dashboard/) で確認してください。

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
<summary>保存される内容</summary>

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

- Agent Note は local-first です。core CLI は hosted service なしで動作します。
- Temporary session data は repository 内の `.git/agentnote/` に保存されます。
- Permanent record は tracked source files ではなく `refs/notes/agentnote` に保存されます。
- Transcript-driven agents の場合、Agent Note は agent 自身の data directory にある local transcript files を読みます。
- CLI は telemetry を送信しません。
- Commit tracking は best-effort です。hook 中に Agent Note が失敗しても `git commit` は成功します。

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Architecture details →](docs/knowledge/DESIGN.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
