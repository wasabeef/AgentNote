# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [de] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — KI-Unterhaltungen in Git gespeichert" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Verstehen Sie, <em>warum</em> sich Code geändert hat, nicht nur <em>was</em> sich geändert hat.</strong></p>

<p align="center">
Agent Note speichert die KI-Unterhaltung und die geänderten Dateien zu jedem Commit. Wenn genug Details verfügbar sind, zeigt es auch eine praktische Schätzung, wie viel der Änderung von KI stammt.
</p>

<p align="center">
Stellen Sie es sich als <code>git log</code> plus die KI-Unterhaltung hinter der Änderung vor.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/de/">Dokumentation</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Warum Agent Note

- Sehen Sie die KI-Unterhaltung hinter jedem unterstützten Commit.
- Prüfen Sie direkt im Pull Request, welche Dateien die KI mitbearbeitet hat und wie hoch der geschätzte KI-Anteil ist.
- Öffnen Sie ein gemeinsames Dashboard, das Commit History in eine lesbare Story verwandelt.
- Halten Sie die Daten Git-native in `refs/notes/agentnote` — kein Hosted Service, keine Telemetrie.

## Voraussetzungen

- Git
- Node.js 20 oder neuer
- Ein unterstützter Coding Agent, installiert und authentifiziert

## AI Agent Skill

Wenn Ihr AI Agent GitHub Agent Skills unterstützt, installieren Sie den Agent Note Skill, damit Sie Agent-Note-Aufgaben in natürlicher Sprache anstoßen können.

```bash
gh skill install wasabeef/AgentNote agent-note --agent codex --scope user
```

Für `gh skill install` wählen Sie den passenden Agent-Identifier: `codex`, `claude-code`, `cursor` or `gemini-cli`. Der Skill führt den Agent normalerweise nur zu sechs öffentlichen Befehlen: `init`, `deinit`, `status`, `log`, `show` und `why`.

## Quick Start

1. Aktivieren Sie Agent Note für Ihren Coding Agent.

```bash
npx agent-note init --agent claude
# oder: codex / cursor / gemini
```

Jeder Entwickler sollte dies einmal lokal nach dem Clone ausführen.

Sie können mehrere Agents im selben Repository aktivieren:

```bash
npx agent-note init --agent claude cursor
```

Wenn Sie auch das gemeinsame Dashboard auf GitHub Pages möchten:

```bash
npx agent-note init --agent claude --dashboard
```

2. Committen und pushen Sie die generierten Dateien.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# ersetzen Sie .claude/settings.json durch Ihre Agent-Konfiguration unten
# mit --dashboard auch .github/workflows/agentnote-dashboard.yml hinzufügen
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: Commit `.claude/settings.json`
- Codex CLI: Commit `.codex/config.toml` und `.codex/hooks.json`
- Cursor: Commit `.cursor/hooks.json`
- Gemini CLI: Commit `.gemini/settings.json`

3. Verwenden Sie weiter Ihren normalen `git commit` Workflow.

Mit den generierten Git Hooks zeichnet Agent Note normale `git commit`-Vorgänge automatisch auf.

## Gespeicherte Daten

Agent Note speichert die Commit Story:

- Unterhaltung: die Anfrage und KI-Antwort, die zur Änderung geführt haben
- Kontext: kurze Hinweise, die als `📝 Context` erscheinen, wenn die Anfrage allein zu knapp ist

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- Dateien: geänderte Dateien und ob die KI beim Bearbeiten geholfen hat
- KI-Anteil: ein Gesamtprozentsatz und, wenn schätzbar, die betroffenen Zeilen

Temporäre Session Data liegen unter `.git/agentnote/`. Der permanente Record liegt in `refs/notes/agentnote` und wird per `git push` geteilt.

### Generierte Bundles aus der AI Ratio herausnehmen

Wenn committete Bundles oder generated outputs sichtbar bleiben, aber die AI Ratio nicht beeinflussen sollen, trage sie in die `.agentnoteignore` im Repository-Root ein:

```gitignore
packages/cli/dist/**
packages/pr-report/dist/**
```

Diese Dateien erscheinen weiterhin in Notes, PR Report und Dashboard. Sie werden nur aus dem Nenner der AI Ratio entfernt.

## Agent Support

| Agent | Status | Prompt | Response | Files | AI Ratio | Line Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Full support | Ja | Ja | Ja | Ja | Standardmäßig |
| Codex CLI | Supported | Ja | Ja | Ja | Ja | Wenn die Codex-Patch-Historie zum finalen Commit passt |
| Cursor | Supported | Ja | Ja | Ja | Ja | Wenn Edit-Zähler passen und die finale Datei noch zum letzten AI edit passt |
| Gemini CLI | Preview | Ja | Ja | Ja | Ja | Noch nicht |

`Files` bedeutet, dass Agent Note zeigen kann, welche committierten Dateien vom Agent berührt wurden. `Line Estimate` bedeutet, dass es zusätzlich KI-geschriebene Zeilen schätzen kann, statt nur Dateien zu zählen.

## Setup prüfen

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

`agent:` zeigt aktivierte Agent-Adapter. `capture:` fasst zusammen, was die Hooks des aktiven Agents sammeln. `git:` zeigt, ob die verwalteten Repository-lokalen Git Hooks installiert sind. `commit:` zeigt, ob normales `git commit` der primäre Tracking-Pfad ist.

## Was Sie bekommen

### Jeder Commit erzählt seine Geschichte

```
$ npx agent-note show

commit:  ce941f7 feat: add JWT auth middleware
session: a1b2c3d4-5678-4abc-8def-111122223333

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

### History auf einen Blick scannen

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Report

Die GitHub Action postet standardmäßig einen AI Session Report in die PR Description:

Der `agentnote-reviewer-context` block wird im PR body als hidden comment gespeichert. AI Review tools, die die raw PR description lesen, etwa Copilot, CodeRabbit, Devin und Greptile, können ihn als zusätzliche intent und review focus nutzen.

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

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## Funktionsweise

```
Du sendest deinem Coding Agent einen Prompt
        │
        ▼
Hooks speichern die Unterhaltung und Session Information
        │
        ▼
Der Agent bearbeitet Dateien
        │
        ▼
Hooks oder Local Transcripts erfassen, welche Dateien geändert wurden
        │
        ▼
Du führst `git commit` aus
        │
        ▼
Agent Note schreibt eine Git Note für diesen Commit
        │
        ▼
Du führst `git push` aus
        │
        ▼
`refs/notes/agentnote` wird mit deinem Branch gepusht
```

Den detaillierten Flow, die Schätzung von KI-geschriebener Arbeit und das gespeicherte Schema finden Sie unter [Funktionsweise](https://wasabeef.github.io/AgentNote/de/how-it-works/).

## Commands

| Command | Was es tut |
| --- | --- |
| `agent-note init` | Richtet Hooks, Workflow, Git Hooks und Notes auto-fetch ein |
| `agent-note deinit` | Entfernt Agent-Note-Hooks und Konfiguration |
| `agent-note status` | Zeigt den Tracking state |
| `agent-note log [n]` | Listet aktuelle Commits mit AI Ratio |
| `agent-note show [commit]` | Zeigt die KI-Session hinter `HEAD` oder einem Commit SHA |
| `agent-note why <target>` | Zeigt den Agent Note context hinter einer Datei-Zeile oder einem Bereich |

## GitHub Action

Die root action hat zwei Modi:

- PR Report Mode aktualisiert die Pull Request description oder postet einen comment.
- Dashboard Mode erstellt die gemeinsamen Dashboard-Daten und veröffentlicht `/dashboard/` über GitHub Pages.

PR Report Mode ist der Standard:

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Setze `prompt_detail` auf `compact` oder `full`, wenn du die Prompt-Historie fokussiert oder vollständig anzeigen willst. Standard ist `compact`: Es hält den Bericht lesbar und zeigt die Prompts, die den Commit erklären, während `full` alle gespeicherten Prompts zeigt.

Dashboard Mode nutzt dieselbe action mit `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
    prompt_detail: compact
```

### Dashboard-Daten

Für die meisten Repositorys müssen Sie den Workflow nicht von Hand schreiben. Generieren Sie ihn mit `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Committen Sie anschließend `.github/workflows/agentnote-pr-report.yml` und `.github/workflows/agentnote-dashboard.yml`, aktivieren Sie GitHub Pages mit `GitHub Actions` als Source und öffnen Sie `/dashboard/`.

Wenn Sie bereits eine GitHub Pages Site haben, finden Sie die sichere kombinierte Einrichtung in den [Dashboard Docs](https://wasabeef.github.io/AgentNote/de/dashboard/).

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
<summary>Was gespeichert wird</summary>

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

## Sicherheit & Datenschutz

- Agent Note ist Local-first. Der Core CLI funktioniert ohne Hosted Service.
- Temporäre Session Data werden unter `.git/agentnote/` in Ihrem Repository gespeichert.
- Der permanente Record wird in `refs/notes/agentnote` gespeichert, nicht in getrackten Source files.
- Für Agents mit lokalen Gesprächsprotokollen liest Agent Note diese Dateien aus dem Data Directory des Agents.
- Der CLI sendet keine Telemetrie.
- Commit Tracking ist Best-effort. Wenn Agent Note während eines Hooks fehlschlägt, gelingt Ihr `git commit` trotzdem.

## Design

Zero runtime dependencies · Git notes storage · Never breaks `git commit` · No telemetry · Agent-agnostic architecture

[Architekturdetails →](docs/architecture.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## Lizenz

MIT — [LICENSE](LICENSE)
