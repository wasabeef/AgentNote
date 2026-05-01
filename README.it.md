# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [it] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Scopri <em>perché</em> il codice è cambiato, non solo <em>cosa</em> è cambiato.</strong></p>

<p align="center">
Agent Note registra ogni prompt, response e file attribuito all'AI, poi collega quel contesto ai tuoi commit git. Quando l'agent espone abbastanza edit history, arriva alla line-level attribution.
</p>

<p align="center">
Pensalo come <code>git log</code> più la conversazione AI dietro la modifica.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/it/">Documentazione</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Perché Agent Note

- Vedi prompt e response dietro ogni commit assistito dall'AI.
- Controlla file scritti dall'AI e AI ratio direttamente nella Pull Request.
- Apri un Dashboard condiviso che trasforma la commit history in una storia leggibile.
- Mantieni i dati git-native con `refs/notes/agentnote` — niente hosted service, niente telemetry.

## Requisiti

- Git
- Node.js 20 o superiore
- Un coding agent supportato, installato e autenticato

## Quick Start

1. Abilita Agent Note per il tuo coding agent.

```bash
npx agent-note init --agent claude
# oppure: codex / cursor / gemini
```

Ogni developer dovrebbe eseguirlo una volta in locale dopo il clone.

Puoi abilitare più agent nello stesso repository:

```bash
npx agent-note init --agent claude cursor
```

Se vuoi anche il Dashboard condiviso su GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Fai commit dei file generati e push.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# sostituisci .claude/settings.json con la config del tuo agent qui sotto
# con --dashboard, aggiungi anche .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: commit `.claude/settings.json`
- Codex CLI: commit `.codex/config.toml` e `.codex/hooks.json`
- Cursor: commit `.cursor/hooks.json`
- Gemini CLI: commit `.gemini/settings.json`

3. Continua a usare il normale workflow `git commit`.

Con i git hooks generati installati, Agent Note registra i commit automaticamente. Usa `agent-note commit -m "..."` solo come fallback quando i git hooks non sono disponibili.

## Dati salvati

Agent Note salva la storia del commit:

- `prompt` / `response`: la conversazione dietro la modifica
- `contexts[]`: suggerimenti display-only mostrati come `📝 Context` quando un prompt è troppo breve

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- `files`: file modificati e se l'AI li ha toccati
- `attribution`: AI ratio, metodo e line counts quando disponibili

I dati temporanei di sessione vivono sotto `.git/agentnote/`. Il record permanente vive in `refs/notes/agentnote` ed è condiviso con `git push`.

## Agent Support

| Agent | Stato | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | Line-level di default | Recupero prompt / response via hook nativi |
| Codex CLI | Preview | File-level di default | Transcript-driven. Il line-level viene attivato solo quando i conteggi `apply_patch` del transcript corrispondono al diff finale del commit. Se il transcript non può essere letto, Agent Note salta la creazione della note invece di scrivere dati incerti. |
| Cursor | Supported | File-level di default | Usa hook `afterFileEdit` / `afterTabFileEdit`. Il line-level viene attivato solo quando il blob committato corrisponde ancora all'ultimo edit AI. |
| Gemini CLI | Preview | File-level | Capture basata su hook con supporto al normale `git commit` tramite i git hooks generati |

## Verifica il setup

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

`agent:` mostra gli adapter agent abilitati. `capture:` riassume cosa raccolgono gli hook dell'agent attivo. `git:` mostra se i git hooks locali gestiti sono installati. `commit:` indica il percorso di tracking principale: normale `git commit` quando i git hooks sono attivi, oppure fallback mode quando conviene usare `agent-note commit`.

## Cosa ottieni

### Ogni commit racconta la sua storia

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

### Scansiona la history a colpo d'occhio

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

Questo pubblica un report di sessione AI nella PR description:

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## Come funziona

```
Invii un prompt al tuo coding agent
        │
        ▼
Gli hooks catturano prompt e session metadata
        │
        ▼
L'agent modifica i files
        │
        ▼
Hooks o local transcripts registrano touched files e attribution signals
        │
        ▼
Esegui `git commit`
        │
        ▼
Agent Note scrive una git note per quel commit
        │
        ▼
Esegui `git push`
        │
        ▼
`refs/notes/agentnote` viene pushato insieme al branch
```

Per il flow dettagliato, le attribution rules e lo schema, vedi [Come funziona](https://wasabeef.github.io/AgentNote/it/how-it-works/).

## Commands

| Command | Cosa fa |
| --- | --- |
| `agent-note init` | Configura hooks, workflow, git hooks e notes auto-fetch |
| `agent-note deinit` | Rimuove hooks e config per un agent |
| `agent-note show [commit]` | Mostra la sessione AI dietro `HEAD` o un commit SHA |
| `agent-note log [n]` | Elenca commit recenti con AI ratio |
| `agent-note pr [base]` | Genera PR Report (markdown o JSON) |
| `agent-note session <id>` | Mostra tutti i commit collegati a una sessione |
| `agent-note commit [args]` | Fallback wrapper attorno a `git commit` quando i git hooks non sono disponibili |
| `agent-note status` | Mostra lo stato del tracking |

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

Imposta `prompt_detail` su `compact`, `standard` o `full` quando vuoi una cronologia dei prompt più breve o completa. Il default è `standard`: `compact` mostra solo i prompt high, `standard` mostra high + medium e `full` mostra tutti i prompt salvati.

Dashboard Mode usa la stessa action con `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
```

### Dati del Dashboard

Per la maggior parte dei repository non serve scrivere il workflow a mano. Generalo con `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Poi committa `.github/workflows/agentnote-pr-report.yml` e `.github/workflows/agentnote-dashboard.yml`, abilita GitHub Pages con `GitHub Actions` come source e apri `/dashboard/`.

Se hai già un sito GitHub Pages, consulta le [Dashboard docs](https://wasabeef.github.io/AgentNote/it/dashboard/) per il setup combinato sicuro.

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

- Agent Note è local-first. Il core CLI funziona senza hosted service.
- I dati temporanei di sessione sono salvati sotto `.git/agentnote/` nel tuo repository.
- Il record permanente è salvato in `refs/notes/agentnote`, non nei file sorgente tracciati.
- Per agent transcript-driven, Agent Note legge i transcript locali dalla data directory dell'agent.
- Il CLI non invia telemetry.
- Il commit tracking è best-effort. Se Agent Note fallisce durante un hook, il tuo `git commit` riesce comunque.

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Dettagli architetturali →](docs/knowledge/DESIGN.md)

## Contribuire

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## Licenza

MIT — [LICENSE](LICENSE)
