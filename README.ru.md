# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [ru] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Понимайте, <em>почему</em> код изменился, а не только <em>что</em> изменилось.</strong></p>

<p align="center">
Agent Note записывает каждый prompt, response и AI-attributed file, а затем прикрепляет этот context к вашим git commits. Когда agent предоставляет достаточно edit history, Agent Note доходит до line-level attribution.
</p>

<p align="center">
Думайте об этом как о <code>git log</code> плюс AI conversation за изменением.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/ru/">Документация</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Почему Agent Note

- Видеть prompt и response за каждым AI-assisted commit.
- Проверять AI-authored files и AI ratio прямо в Pull Request.
- Открывать shared Dashboard, который превращает commit history в читаемую story.
- Хранить данные git-native в `refs/notes/agentnote` — без hosted service и telemetry.

## Требования

- Git
- Node.js 20 или новее
- Поддерживаемый coding agent, установленный и авторизованный

## Quick Start

1. Включите Agent Note для вашего coding agent.

```bash
npx agent-note init --agent claude
# или: codex / cursor / gemini
```

Каждый developer должен выполнить это один раз локально после clone.

Можно включить несколько agents в одном repository:

```bash
npx agent-note init --agent claude cursor
```

Если вам также нужен shared Dashboard на GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Закоммитьте созданные файлы и push.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# замените .claude/settings.json на config вашего agent ниже
# с --dashboard также добавьте .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: commit `.claude/settings.json`
- Codex CLI: commit `.codex/config.toml` и `.codex/hooks.json`
- Cursor: commit `.cursor/hooks.json`
- Gemini CLI: commit `.gemini/settings.json`

3. Продолжайте использовать обычный `git commit` workflow.

С установленными git hooks Agent Note записывает commits автоматически. Используйте `agent-note commit -m "..."` только как fallback, когда git hooks недоступны.

## Сохранённые данные

Agent Note сохраняет commit story:

- `prompt` / `response`: разговор за изменением
- `contexts[]`: display-only подсказки, которые показываются как `📝 Context`, когда prompt слишком короткий

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- `files`: измененные file и факт касания AI
- `attribution`: AI ratio, method и line counts, когда они доступны

Temporary session data находятся в `.git/agentnote/`. Permanent record находится в `refs/notes/agentnote` и распространяется через `git push`.

## Agent Support

| Agent | Status | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | Line-level по умолчанию | Hook-native prompt / response recovery |
| Codex CLI | Preview | File-level по умолчанию | Transcript-driven. Line-level включается только когда `apply_patch` counts из transcript совпадают с final commit diff. Если transcript невозможно прочитать, Agent Note пропускает создание note вместо записи сомнительных данных. |
| Cursor | Supported | File-level по умолчанию | Использует hooks `afterFileEdit` / `afterTabFileEdit`. Line-level включается только когда committed blob все еще совпадает с latest AI edit. |
| Gemini CLI | Preview | File-level | Hook-based capture с поддержкой обычного `git commit` через сгенерированные git hooks |

## Проверка setup

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

`agent:` показывает включенные agent adapters. `capture:` резюмирует, что собирают hooks активного agent. `git:` показывает, установлены ли managed repository-local git hooks. `commit:` показывает primary tracking path: обычный `git commit`, когда git hooks активны, или fallback mode, когда стоит предпочесть `agent-note commit`.

## Что вы получаете

### Каждый commit рассказывает свою story

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

### Быстро просматривать history

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

Это публикует AI session report в PR description:

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## Как это работает

```
Отправляете prompt своему coding agent
        │
        ▼
hooks записывают prompt и session metadata
        │
        ▼
agent редактирует files
        │
        ▼
hooks или local transcripts записывают touched files и attribution signals
        │
        ▼
Запускаете `git commit`
        │
        ▼
Agent Note записывает git note для этого commit
        │
        ▼
Запускаете `git push`
        │
        ▼
`refs/notes/agentnote` отправляется вместе с branch
```

Подробный flow, attribution rules и schema описаны в разделе [Как это работает](https://wasabeef.github.io/AgentNote/ru/how-it-works/).

## Commands

| Command | Что делает |
| --- | --- |
| `agent-note init` | Настраивает hooks, workflow, git hooks и notes auto-fetch |
| `agent-note deinit` | Удаляет hooks и config для agent |
| `agent-note show [commit]` | Показывает AI session за `HEAD` или commit SHA |
| `agent-note log [n]` | Список recent commits с AI ratio |
| `agent-note pr [base]` | Генерирует PR Report (markdown или JSON) |
| `agent-note session <id>` | Показывает все commits, связанные с одной session |
| `agent-note commit [args]` | Fallback wrapper вокруг `git commit`, когда git hooks недоступны |
| `agent-note status` | Показывает tracking state |

## GitHub Action

У root action есть два режима:

- PR Report Mode обновляет Pull Request description или публикует comment.
- Dashboard Mode собирает данные общего Dashboard и публикует `/dashboard/` через GitHub Pages.

PR Report Mode используется по умолчанию:

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Задайте `prompt_detail` как `compact`, `standard` или `full`, если хотите более короткую или полную историю prompts. По умолчанию используется `standard`.

Dashboard Mode использует ту же action с `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
```

### Данные Dashboard

Для большинства репозиториев не нужно писать workflow вручную. Сгенерируйте его через `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Затем закоммитьте `.github/workflows/agentnote-pr-report.yml` и `.github/workflows/agentnote-dashboard.yml`, включите GitHub Pages с source `GitHub Actions` и откройте `/dashboard/`.

Если у вас уже есть GitHub Pages site, безопасная комбинированная настройка описана в [Dashboard docs](https://wasabeef.github.io/AgentNote/ru/dashboard/).

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
<summary>Что сохраняется</summary>

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

- Agent Note local-first. Core CLI работает без hosted service.
- Temporary session data хранится внутри репозитория в `.git/agentnote/`.
- Permanent record хранится в `refs/notes/agentnote`, а не в tracked source files.
- Для transcript-driven agents Agent Note читает local transcript files из data directory самого agent.
- CLI не отправляет telemetry.
- Commit tracking best-effort. Если Agent Note падает во время hook, ваш `git commit` все равно успешен.

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Architecture details →](docs/knowledge/DESIGN.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
