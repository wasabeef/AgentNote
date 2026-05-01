# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [ko] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>코드가 <em>무엇으로</em> 바뀌었는지뿐 아니라, <em>왜</em> 바뀌었는지도 남깁니다.</strong></p>

<p align="center">
Agent Note 는 각 prompt, response, AI-attributed file 을 기록하고 그 context 를 git commit 에 연결합니다. agent 가 충분한 edit history 를 제공하면 line-level attribution 까지 수행합니다.
</p>

<p align="center">
<code>git log</code> 에 변경 뒤의 AI conversation 을 더한 것이라고 생각하면 됩니다.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/ko/">문서</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## 왜 Agent Note 인가

- AI-assisted commit 뒤의 prompt 와 response 를 확인할 수 있습니다.
- Pull Request 안에서 AI-authored files 와 AI ratio 를 바로 review 할 수 있습니다.
- shared Dashboard 로 commit history 를 읽기 쉬운 story 로 볼 수 있습니다.
- 데이터는 `refs/notes/agentnote` 에 git-native 로 남습니다. hosted service 도 telemetry 도 없습니다.

## 요구 사항

- Git
- Node.js 20 이상
- 지원되는 coding agent 설치 및 인증

## Quick Start

1. coding agent 에 Agent Note 를 활성화합니다.

```bash
npx agent-note init --agent claude
# 또는: codex / cursor / gemini
```

각 developer 는 clone 후 local 에서 한 번 실행해야 합니다.

같은 repository 에 여러 agent 를 활성화할 수 있습니다.

```bash
npx agent-note init --agent claude cursor
```

GitHub Pages 의 shared Dashboard 도 원한다면:

```bash
npx agent-note init --agent claude --dashboard
```

2. 생성된 file 을 commit 하고 push 합니다.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# .claude/settings.json 은 아래 agent config 에 맞게 바꾸세요
# --dashboard 를 사용하면 .github/workflows/agentnote-dashboard.yml 도 추가
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: `.claude/settings.json` commit
- Codex CLI: `.codex/config.toml` 과 `.codex/hooks.json` commit
- Cursor: `.cursor/hooks.json` commit
- Gemini CLI: `.gemini/settings.json` commit

3. 평소처럼 `git commit` workflow 를 계속 사용합니다.

생성된 git hooks 가 설치되어 있으면 Agent Note 가 commit 을 자동 기록합니다. git hooks 를 사용할 수 없을 때만 fallback 으로 `agent-note commit -m "..."` 를 사용하세요.

## 저장되는 데이터

Agent Note 는 commit story 를 저장합니다.

- `prompt` / `response`: 변경으로 이어진 대화
- `contexts[]`: prompt 가 너무 짧을 때 `📝 Context` 로 표시되는 display-only 보조 설명

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- `files`: 변경된 file 과 AI 가 수정했는지 여부
- `attribution`: AI ratio, method, 가능한 경우 line counts

Temporary session data 는 `.git/agentnote/` 아래에 저장됩니다. permanent record 는 `refs/notes/agentnote` 에 저장되고 `git push` 로 공유됩니다.

## Agent Support

| Agent | Status | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | 기본 Line-level | Hook-native prompt / response recovery |
| Codex CLI | Preview | 기본 File-level | Transcript-driven. transcript 의 `apply_patch` count 가 final commit diff 와 일치할 때만 line-level 로 승격합니다. transcript 를 읽을 수 없으면 불확실한 data 를 쓰지 않고 note 생성을 skip 합니다. |
| Cursor | Supported | 기본 File-level | `afterFileEdit` / `afterTabFileEdit` hooks 를 사용합니다. committed blob 이 latest AI edit 와 여전히 일치할 때만 line-level 로 승격합니다. |
| Gemini CLI | Preview | File-level | generated git hooks 를 통해 hook-based capture 와 일반 `git commit` 을 지원합니다 |

## Setup 확인

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

`agent:` 는 활성화된 agent adapters 를 보여줍니다. `capture:` 는 active agent hooks 가 무엇을 수집하는지 요약합니다. `git:` 는 managed repository-local git hooks 설치 여부를 보여줍니다. `commit:` 은 primary tracking path 를 알려줍니다. git hooks 가 active 이면 일반 `git commit`, fallback mode 이면 `agent-note commit` 을 우선 사용합니다.

## 얻을 수 있는 것

### 모든 commit 이 story 를 가집니다

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

### history 를 한눈에 scan

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

PR description 에 AI session report 를 게시합니다.

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## 작동 방식

```
coding agent 에게 prompt 를 보냅니다
        │
        ▼
hooks 가 prompt 와 session metadata 를 기록합니다
        │
        ▼
agent 가 files 를 수정합니다
        │
        ▼
hooks 또는 local transcripts 가 touched files 와 attribution signals 를 기록합니다
        │
        ▼
`git commit` 을 실행합니다
        │
        ▼
Agent Note 가 해당 commit 에 git note 를 씁니다
        │
        ▼
`git push` 를 실행합니다
        │
        ▼
`refs/notes/agentnote` 가 branch 와 함께 push 됩니다
```

자세한 flow, attribution rules, schema 는 [작동 방식](https://wasabeef.github.io/AgentNote/ko/how-it-works/) 을 참고하세요.

## Commands

| Command | What it does |
| --- | --- |
| `agent-note init` | hooks, workflow, git hooks, notes auto-fetch 를 설정합니다 |
| `agent-note deinit` | agent hooks 와 config 를 제거합니다 |
| `agent-note show [commit]` | `HEAD` 또는 commit SHA 뒤의 AI session 을 보여줍니다 |
| `agent-note log [n]` | 최근 commit 과 AI ratio 를 나열합니다 |
| `agent-note pr [base]` | PR Report 를 생성합니다 (markdown 또는 JSON) |
| `agent-note session <id>` | 하나의 session 에 연결된 모든 commit 을 보여줍니다 |
| `agent-note commit [args]` | git hooks 가 없을 때 쓰는 `git commit` fallback wrapper |
| `agent-note status` | tracking state 를 보여줍니다 |

## GitHub Action

root action 에는 두 가지 mode 가 있습니다.

- PR Report Mode 는 Pull Request description 을 업데이트하거나 comment 를 게시합니다.
- Dashboard Mode 는 공유 Dashboard 데이터를 빌드하고 GitHub Pages 의 `/dashboard/` 로 게시합니다.

PR Report Mode 가 기본값입니다.

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Dashboard Mode 는 같은 action 에 `dashboard: true` 를 전달합니다.

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
```

### Dashboard 데이터

대부분의 리포지토리에서는 workflow 를 직접 작성할 필요가 없습니다. `init` 으로 생성하세요.

```bash
npx agent-note init --agent claude --dashboard
```

`.github/workflows/agentnote-pr-report.yml` 와 `.github/workflows/agentnote-dashboard.yml` 를 commit 하고, GitHub Pages source 로 `GitHub Actions` 를 선택한 뒤 `/dashboard/` 를 여세요.

이미 GitHub Pages site 가 있다면 안전한 결합 setup 은 [Dashboard docs](https://wasabeef.github.io/AgentNote/ko/dashboard/) 를 확인하세요.

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
<summary>저장되는 내용</summary>

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

- Agent Note 는 local-first 입니다. core CLI 는 hosted service 없이 동작합니다.
- Temporary session data 는 리포지토리 내부 `.git/agentnote/` 에 저장됩니다.
- Permanent record 는 tracked source files 가 아니라 `refs/notes/agentnote` 에 저장됩니다.
- Transcript-driven agents 의 경우 Agent Note 는 agent 의 data directory 에 있는 local transcript files 를 읽습니다.
- CLI 는 telemetry 를 보내지 않습니다.
- Commit tracking 은 best-effort 입니다. hook 중 Agent Note 가 실패해도 `git commit` 은 성공합니다.

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Architecture details →](docs/knowledge/DESIGN.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
