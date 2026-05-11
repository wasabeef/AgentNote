# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [ru] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — разговоры с AI сохраняются в Git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Понимайте, <em>почему</em> код изменился, а не только <em>что</em> изменилось.</strong></p>

<p align="center">
Agent Note сохраняет разговор с AI и изменённые файлы для каждого Commit. Когда данных достаточно, он также показывает практическую оценку того, какая часть изменения была сделана AI.
</p>

<p align="center">
Думайте об этом как о <code>git log</code> плюс разговор с AI за изменением.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/ru/">Документация</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Почему Agent Note

- Сохранять промпты, ответы, изменённые файлы и AI Ratio для каждого Commit, сделанного с помощью AI.
- Продолжать пользоваться обычным `git commit`; Agent Note записывает контекст в фоне.
- Давать людям-ревьюерам и инструментам AI-ревью PR Report с видимой сводкой и скрытым Reviewer Context.
- Открывать общий Dashboard или запускать `agent-note why <file:line>`, чтобы перейти от строки к разговору Commit.
- Хранить всё Git-native в `refs/notes/agentnote` — без Hosted Service и Telemetry.

## Требования

- Git
- Node.js 20 или новее
- Поддерживаемый Coding Agent, установленный и авторизованный

## Quick Start

1. Включите Agent Note для вашего Coding Agent.

```bash
npx agent-note init --agent claude
# или: codex / cursor / gemini
```

Каждый разработчик должен выполнить это один раз локально после Clone.

Можно включить несколько Agents в одном Repository:

```bash
npx agent-note init --agent claude cursor
```

Если вам также нужен shared Dashboard на GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Закоммитьте созданные файлы и Push.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# замените .claude/settings.json на config вашего agent ниже
# с --dashboard также добавьте .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: Commit `.claude/settings.json`
- Codex CLI: Commit `.codex/config.toml` и `.codex/hooks.json`
- Cursor: Commit `.cursor/hooks.json`
- Gemini CLI: Commit `.gemini/settings.json`

3. Продолжайте использовать обычный `git commit` Workflow.

С установленными Git Hooks Agent Note автоматически записывает обычные `git commit` Commits.

## AI Agent Skill

Если ваш AI Agent поддерживает GitHub Agent Skills, установите Agent Note Skill, чтобы просить задачи Agent Note на естественном языке.

```bash
gh skill install wasabeef/AgentNote agent-note --agent codex --scope user
```

Для `gh skill install` выберите подходящий идентификатор agent: `codex`, `claude-code`, `cursor` or `gemini-cli`. Skill обычно направляет agent только к шести публичным командам: `init`, `deinit`, `status`, `log`, `show` и `why`.

## Сохранённые данные

Agent Note сохраняет Commit Story:

- Разговор: запрос и ответ AI, которые привели к изменению
- Контекст: короткие заметки, которые показываются как `📝 Context`, когда одного запроса недостаточно

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- Файлы: изменённые файлы и факт участия AI в редактировании
- AI Ratio: общая оценка в процентах, а также строки, когда Agent Note может их оценить

Temporary Session Data находятся в `.git/agentnote/`. Permanent Record находится в `refs/notes/agentnote` и распространяется через `git push`.

### Исключить generated bundles из AI Ratio

Если закоммиченные bundles или generated outputs должны оставаться видимыми, но не влиять на AI Ratio, добавьте их в файл `.agentnoteignore` в корне репозитория:

```gitignore
packages/cli/dist/**
packages/pr-report/dist/**
```

Эти файлы всё равно отображаются в Notes, PR Report и Dashboard. Они исключаются только из знаменателя AI Ratio.

## Agent Support

| Agent | Status | Prompt | Response | Files | AI Ratio | Line Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Full support | Да | Да | Да | Да | По умолчанию |
| Codex CLI | Supported | Да | Да | Да | Да | Когда история patch в Codex совпадает с итоговым Commit |
| Cursor | Supported | Да | Да | Да | Да | Когда счётчики edit совпадают и итоговый файл всё ещё соответствует последнему AI edit |
| Gemini CLI | Preview | Да | Да | Да | Да | Пока нет |

`Files` означает, что Agent Note может показать, какие commit-файлы были затронуты Agent. `Line Estimate` означает, что он также может оценить строки, написанные AI, а не только считать файлы.

## Проверка Setup

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

`agent:` показывает включенные Agent Adapters. `capture:` резюмирует, что собирают Hooks активного Agent. `git:` показывает, установлены ли Managed Repository-Local Git Hooks. `commit:` показывает, является ли обычный `git commit` основным Tracking Path.

## Что вы получаете

### Каждый Commit рассказывает свою Story

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

### Быстро просматривать history

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Report

По умолчанию GitHub Action публикует AI Session Report в PR Description:

Блок `agentnote-reviewer-context` сохраняется в PR body как hidden comment. AI Review tools, которые читают raw PR description, например Copilot, CodeRabbit, Devin и Greptile, могут использовать его как дополнительный intent и review focus.

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

## Как это работает

```
Отправляете Prompt своему Coding Agent
        │
        ▼
Hooks записывают разговор и Session information
        │
        ▼
Agent редактирует файлы
        │
        ▼
Hooks или Local Transcripts записывают, какие файлы изменились
        │
        ▼
Запускаете `git commit`
        │
        ▼
Agent Note записывает Git Note для этого Commit
        │
        ▼
Запускаете `git push`
        │
        ▼
`refs/notes/agentnote` отправляется вместе с Branch
```

Подробный Flow, способ оценки работы AI и сохранённая Schema описаны в разделе [Как это работает](https://wasabeef.github.io/AgentNote/ru/how-it-works/).

## Commands

| Command | Что делает |
| --- | --- |
| `agent-note init` | Настраивает Hooks, Workflow, Git Hooks и notes auto-fetch |
| `agent-note deinit` | Удаляет hooks и config Agent Note |
| `agent-note status` | Показывает Tracking state |
| `agent-note log [n]` | Список Recent Commits с AI Ratio |
| `agent-note show [commit]` | Показывает AI Session за `HEAD` или Commit SHA |
| `agent-note why <target>` | Показывает контекст Agent Note для строки или диапазона файла |

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

Задайте `prompt_detail` как `compact` или `full`, если хотите сфокусированную или полную историю Prompts. По умолчанию используется `compact`: он оставляет отчёт читаемым и показывает Prompts, которые объясняют Commit, а `full` показывает все сохранённые Prompts.

Dashboard Mode использует ту же action с `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
    prompt_detail: compact
```

### Данные Dashboard

Для большинства репозиториев не нужно писать Workflow вручную. Сгенерируйте его через `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Затем закоммитьте `.github/workflows/agentnote-pr-report.yml` и `.github/workflows/agentnote-dashboard.yml`, включите GitHub Pages с Source `GitHub Actions` и откройте `/dashboard/`.

Если у вас уже есть GitHub Pages Site, безопасная комбинированная настройка описана в [Dashboard Docs](https://wasabeef.github.io/AgentNote/ru/dashboard/).

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

- Agent Note Local-first. Core CLI работает без Hosted Service.
- Temporary Session Data хранится внутри репозитория в `.git/agentnote/`.
- Permanent Record хранится в `refs/notes/agentnote`, а не в Tracked Source Files.
- Для Agents с локальными журналами разговоров Agent Note читает эти файлы из Data Directory самого Agent.
- CLI не отправляет Telemetry.
- Commit Tracking Best-effort. Если Agent Note падает во время Hook, ваш `git commit` все равно успешен.

## Design

Zero runtime dependencies · Git notes storage · Never breaks `git commit` · No telemetry · Agent-agnostic architecture

[Детали архитектуры →](docs/architecture.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
