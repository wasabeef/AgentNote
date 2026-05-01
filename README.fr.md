# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [fr] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Sachez <em>pourquoi</em> votre code a changé, pas seulement <em>ce qui</em> a changé.</strong></p>

<p align="center">
Agent Note enregistre chaque prompt, réponse et fichier attribué à l'IA, puis attache ce contexte à vos commits git. Il atteint l'attribution ligne par ligne lorsque l'agent expose assez d'historique d'édition.
</p>

<p align="center">
Pensez-y comme à <code>git log</code> plus la conversation IA derrière le changement.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/fr/">Documentation</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Pourquoi Agent Note

- Voir le prompt et la réponse derrière chaque commit assisté par IA.
- Examiner les fichiers écrits par l'IA et l'AI ratio directement dans la Pull Request.
- Ouvrir un Dashboard partagé qui transforme l'historique des commits en récit lisible.
- Garder les données dans git avec `refs/notes/agentnote` — pas de service hébergé, pas de télémétrie.

## Prérequis

- Git
- Node.js 20 ou plus récent
- Un coding agent pris en charge, installé et authentifié

## Quick Start

1. Activez Agent Note pour votre coding agent.

```bash
npx agent-note init --agent claude
# ou: codex / cursor / gemini
```

Chaque développeur doit l'exécuter une fois localement après le clone.

Vous pouvez activer plusieurs agents dans le même repository:

```bash
npx agent-note init --agent claude cursor
```

Si vous voulez aussi le Dashboard partagé sur GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Commitez les fichiers générés et poussez.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# remplacez .claude/settings.json par la configuration de votre agent ci-dessous
# avec --dashboard, ajoutez aussi .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: commitez `.claude/settings.json`
- Codex CLI: commitez `.codex/config.toml` et `.codex/hooks.json`
- Cursor: commitez `.cursor/hooks.json`
- Gemini CLI: commitez `.gemini/settings.json`

3. Continuez à utiliser votre workflow `git commit` habituel.

Avec les git hooks générés, Agent Note enregistre les commits automatiquement. Utilisez `agent-note commit -m "..."` seulement comme solution de secours lorsque les git hooks ne sont pas disponibles.

## Données sauvegardées

Agent Note enregistre l'histoire du commit:

- `prompt` / `response`: la conversation derrière le changement
- `contexts[]`: des aides display-only affichées comme `📝 Context` quand un prompt est trop court

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- `files`: les fichiers changés et si l'IA les a touchés
- `attribution`: AI ratio, méthode et line counts lorsqu'ils sont disponibles

Les données temporaires de session vivent sous `.git/agentnote/`. L'enregistrement permanent vit dans `refs/notes/agentnote` et se partage avec `git push`.

## Agent Support

| Agent | Statut | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | Line-level par défaut | Récupération prompt / response via hooks natifs |
| Codex CLI | Preview | File-level par défaut | Piloté par transcript. Le line-level est activé seulement quand le nombre de lignes `apply_patch` du transcript correspond au diff final du commit. Si le transcript ne peut pas être lu, Agent Note saute la création de note au lieu d'écrire des données incertaines. |
| Cursor | Supported | File-level par défaut | Utilise les hooks `afterFileEdit` / `afterTabFileEdit`. Le line-level est activé seulement lorsque le blob commité correspond encore à la dernière édition IA. |
| Gemini CLI | Preview | File-level | Capture par hooks avec support du `git commit` normal via les git hooks générés |

## Vérifier la configuration

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

`agent:` montre les adapters d'agent activés. `capture:` résume ce que les hooks de l'agent actif collectent. `git:` indique si les hooks git locaux gérés sont installés. `commit:` indique le chemin de tracking principal: `git commit` normal quand les hooks git sont actifs, ou mode fallback quand il faut préférer `agent-note commit`.

## Ce que vous obtenez

### Chaque commit raconte son histoire

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

### Parcourir l'historique d'un coup d'oeil

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

Cela poste un rapport de session IA dans la description de la PR:

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## Fonctionnement

```
Vous envoyez un prompt à votre coding agent
        │
        ▼
Les hooks capturent le prompt et les session metadata
        │
        ▼
L'agent modifie les fichiers
        │
        ▼
Les hooks ou local transcripts enregistrent les fichiers touchés et les attribution signals
        │
        ▼
Vous exécutez `git commit`
        │
        ▼
Agent Note écrit une git note pour ce commit
        │
        ▼
Vous exécutez `git push`
        │
        ▼
`refs/notes/agentnote` est poussé avec votre branch
```

Pour le flow détaillé, les attribution rules et le schema, consultez [Fonctionnement](https://wasabeef.github.io/AgentNote/fr/how-it-works/).

## Commands

| Command | Ce que cela fait |
| --- | --- |
| `agent-note init` | Configure hooks, workflow, git hooks et notes auto-fetch |
| `agent-note deinit` | Supprime hooks et config pour un agent |
| `agent-note show [commit]` | Affiche la session IA derrière `HEAD` ou un commit SHA |
| `agent-note log [n]` | Liste les commits récents avec AI ratio |
| `agent-note pr [base]` | Génère un PR Report (markdown ou JSON) |
| `agent-note session <id>` | Affiche tous les commits liés à une session |
| `agent-note commit [args]` | Wrapper fallback autour de `git commit` quand les hooks git sont indisponibles |
| `agent-note status` | Affiche l'état du tracking |

## GitHub Action

L'action racine a deux modes:

- PR Report Mode met à jour la description de la Pull Request ou poste un commentaire.
- Dashboard Mode construit les données du Dashboard partagé et publie `/dashboard/` via GitHub Pages.

PR Report Mode est le mode par défaut:

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Dashboard Mode utilise la même action avec `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
```

### Données du Dashboard

Pour la plupart des dépôts, vous n'avez pas besoin d'écrire le workflow à la main. Générez-le avec `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Commitez ensuite `.github/workflows/agentnote-pr-report.yml` et `.github/workflows/agentnote-dashboard.yml`, activez GitHub Pages avec `GitHub Actions` comme source, puis ouvrez `/dashboard/`.

Si vous avez déjà un site GitHub Pages, consultez les [docs Dashboard](https://wasabeef.github.io/AgentNote/fr/dashboard/) pour la configuration combinée sûre.

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
<summary>Ce qui est enregistré</summary>

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

## Sécurité et confidentialité

- Agent Note est local-first. Le core CLI fonctionne sans service hébergé.
- Les données temporaires de session sont stockées sous `.git/agentnote/` dans votre dépôt.
- L'enregistrement permanent est stocké dans `refs/notes/agentnote`, pas dans les fichiers source suivis.
- Pour les agents pilotés par transcript, Agent Note lit les fichiers transcript locaux dans le répertoire de données de l'agent.
- Le CLI n'envoie pas de télémétrie.
- Le tracking des commits est best-effort. Si Agent Note échoue dans un hook, votre `git commit` réussit quand même.

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Détails d'architecture →](docs/knowledge/DESIGN.md)

## Contribuer

[Guide de contribution →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## Licence

MIT — [LICENSE](LICENSE)
