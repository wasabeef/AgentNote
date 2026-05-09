# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [it] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — conversazioni AI salvate in Git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Scopri <em>perché</em> il codice è cambiato, non solo <em>cosa</em> è cambiato.</strong></p>

<p align="center">
Agent Note salva la conversazione con l'AI e i file modificati per ogni Commit. Quando ci sono dettagli sufficienti, mostra anche una stima pratica di quanta parte della modifica proviene dall'AI.
</p>

<p align="center">
Pensalo come <code>git log</code> più la conversazione con l'AI dietro la modifica.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/it/">Documentazione</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Perché Agent Note

- Vedi la conversazione con l'AI dietro ogni Commit assistito.
- Controlla direttamente nella Pull Request i file che l'AI ha aiutato a modificare e la quota stimata di AI.
- Apri un Dashboard condiviso che trasforma la Commit History in una storia leggibile.
- Mantieni i dati Git-native con `refs/notes/agentnote` — niente Hosted Service, niente Telemetry.

## Requisiti

- Git
- Node.js 20 o superiore
- Un Coding Agent supportato, installato e autenticato

## AI Agent Skill

Se il tuo AI Agent supporta GitHub Agent Skills, installa lo Skill Agent Note per chiedere attività Agent Note in linguaggio naturale.

```bash
gh skill install wasabeef/AgentNote agent-note --agent codex --scope user
```

Per `gh skill install`, scegli l'identificatore agent corretto: `codex`, `claude-code`, `cursor` or `gemini-cli`. Lo Skill guida normalmente l'agent verso solo sei comandi pubblici: `init`, `deinit`, `status`, `log`, `show` e `why`.

## Quick Start

1. Abilita Agent Note per il tuo Coding Agent.

```bash
npx agent-note init --agent claude
# oppure: codex / cursor / gemini
```

Ogni sviluppatore dovrebbe eseguirlo una volta in locale dopo il Clone.

Puoi abilitare più Agent nello stesso Repository:

```bash
npx agent-note init --agent claude cursor
```

Se vuoi anche il Dashboard condiviso su GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Fai Commit dei file generati e Push.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# sostituisci .claude/settings.json con la config del tuo agent qui sotto
# con --dashboard, aggiungi anche .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: Commit `.claude/settings.json`
- Codex CLI: Commit `.codex/config.toml` e `.codex/hooks.json`
- Cursor: Commit `.cursor/hooks.json`
- Gemini CLI: Commit `.gemini/settings.json`

3. Continua a usare il normale Workflow `git commit`.

Con i Git Hooks generati installati, Agent Note registra automaticamente i Commit fatti con `git commit`.

## Dati salvati

Agent Note salva la storia del Commit:

- Conversazione: la richiesta e la risposta AI che hanno portato alla modifica
- Contesto: brevi Note mostrate come `📝 Context` quando la richiesta da sola è troppo breve

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- File: file modificati e se l'AI ha aiutato a editarli
- Quota AI: una percentuale complessiva, più il conteggio delle linee quando Agent Note può stimarlo

I dati temporanei di sessione vivono sotto `.git/agentnote/`. Il Record permanente vive in `refs/notes/agentnote` ed è condiviso con `git push`.

### Escludere i bundle generati dall’AI Ratio

Se bundle o generated output committati devono restare visibili ma non influenzare l’AI Ratio, aggiungili alla `.agentnoteignore` nella root del repository:

```gitignore
packages/cli/dist/**
packages/pr-report/dist/**
```

Questi file restano visibili in Notes, PR Report e Dashboard. Vengono rimossi solo dal denominatore dell’AI Ratio.

## Agent Support

| Agent | Stato | Prompt | Response | Files | AI Ratio | Line Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Full support | Sì | Sì | Sì | Sì | Di default |
| Codex CLI | Supported | Sì | Sì | Sì | Sì | Quando la cronologia patch di Codex corrisponde al Commit finale |
| Cursor | Supported | Sì | Sì | Sì | Sì | Quando i conteggi degli edit coincidono e il file finale corrisponde ancora all'ultimo edit IA |
| Gemini CLI | Preview | Sì | Sì | Sì | Sì | Non ancora |

`Files` significa che Agent Note può mostrare quali file committati sono stati toccati dall'Agent. `Line Estimate` significa che può anche stimare le linee scritte dall'AI invece di contare solo i file.

## Verifica il Setup

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

`agent:` mostra gli adapter Agent abilitati. `capture:` riassume cosa raccolgono gli Hook dell'Agent attivo. `git:` mostra se i Git Hooks locali gestiti sono installati. `commit:` indica se `git commit` è il percorso di Tracking principale.

## Cosa ottieni

### Ogni Commit racconta la sua storia

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

### Scansiona la history a colpo d'occhio

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Report

Di default, la GitHub Action pubblica un report di sessione AI nella descrizione della PR:

Il blocco `agentnote-reviewer-context` viene salvato nel body della PR come hidden comment. Gli AI Review tools che leggono la raw PR description, come Copilot, CodeRabbit, Devin e Greptile, possono usarlo come intent e review focus aggiuntivi.

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

## Come funziona

```
Invii un Prompt al tuo Coding Agent
        │
        ▼
Gli Hooks salvano la conversazione e le informazioni di Session
        │
        ▼
L'Agent modifica i file
        │
        ▼
Hooks o Local Transcripts registrano quali file sono cambiati
        │
        ▼
Esegui `git commit`
        │
        ▼
Agent Note scrive una Git Note per quel Commit
        │
        ▼
Esegui `git push`
        │
        ▼
`refs/notes/agentnote` viene pushato insieme al Branch
```

Per il Flow dettagliato, come Agent Note stima il lavoro scritto dall'AI e lo Schema salvato, vedi [Come funziona](https://wasabeef.github.io/AgentNote/it/how-it-works/).

## Commands

| Command | Cosa fa |
| --- | --- |
| `agent-note init` | Configura Hooks, Workflow, Git Hooks e Notes auto-fetch |
| `agent-note deinit` | Rimuove hook e configurazione di Agent Note |
| `agent-note status` | Mostra lo stato del Tracking |
| `agent-note log [n]` | Elenca Commit recenti con AI Ratio |
| `agent-note show [commit]` | Mostra la sessione AI dietro `HEAD` o un Commit SHA |
| `agent-note why <target>` | Mostra il contesto Agent Note dietro una riga o un intervallo di file |

## GitHub Action

La root action ha due mode:

- PR Report Mode aggiorna la Pull Request description o pubblica un comment.
- Dashboard Mode genera i dati del Dashboard condiviso e pubblica `/dashboard/` tramite GitHub Pages.

PR Report Mode è il default:

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Imposta `prompt_detail` su `compact` o `full` quando vuoi una cronologia dei Prompt mirata o completa. Il default è `compact`: mantiene leggibile il report mostrando i Prompt che spiegano il Commit, mentre `full` mostra tutti i Prompt salvati.

Dashboard Mode usa la stessa action con `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
    prompt_detail: compact
```

### Dati del Dashboard

Per la maggior parte dei Repository non serve scrivere il Workflow a mano. Generalo con `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Poi fai Commit di `.github/workflows/agentnote-pr-report.yml` e `.github/workflows/agentnote-dashboard.yml`, abilita GitHub Pages con `GitHub Actions` come Source e apri `/dashboard/`.

Se hai già un sito GitHub Pages, consulta le [Dashboard Docs](https://wasabeef.github.io/AgentNote/it/dashboard/) per il Setup combinato sicuro.

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
<summary>Cosa viene salvato</summary>

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

## Sicurezza e privacy

- Agent Note è Local-first. Il Core CLI funziona senza Hosted Service.
- I dati temporanei di sessione sono salvati sotto `.git/agentnote/` nel tuo Repository.
- Il Record permanente è salvato in `refs/notes/agentnote`, non nei file sorgente tracciati.
- Per gli Agent che mantengono log locali della conversazione, Agent Note legge quei file dalla Data Directory dell'Agent.
- Il CLI non invia Telemetry.
- Il Commit Tracking è Best-effort. Se Agent Note fallisce durante un Hook, il tuo `git commit` riesce comunque.

## Design

Zero runtime dependencies · Git notes storage · Never breaks `git commit` · No telemetry · Agent-agnostic architecture

[Dettagli architetturali →](docs/architecture.md)

## Contribuire

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## Licenza

MIT — [LICENSE](LICENSE)
