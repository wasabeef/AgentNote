# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [fr] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — conversations IA sauvegardées dans Git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Sachez <em>pourquoi</em> votre code a changé, pas seulement <em>ce qui</em> a changé.</strong></p>

<p align="center">
Agent Note conserve la conversation avec l'IA et les fichiers modifiés pour chaque Commit. Quand assez de détails sont disponibles, il affiche aussi une estimation pratique de la part écrite par l'IA.
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

- Capturer les prompts, réponses, fichiers modifiés et l'AI Ratio pour chaque Commit assisté par IA.
- Continuer à utiliser `git commit` normalement; Agent Note enregistre le contexte en arrière-plan.
- Donner aux humains et aux AI Review tools un PR Report avec un résumé visible et un Reviewer Context caché.
- Ouvrir un Dashboard partagé, ou lancer `agent-note why <file:line>` pour remonter d'une ligne à la conversation du Commit.
- Garder les données dans git avec `refs/notes/agentnote` — pas de service hébergé, pas de télémétrie.

## Prérequis

- Git
- Node.js 20 ou plus récent
- Un Coding Agent pris en charge, installé et authentifié

## Quick Start

1. Activez Agent Note pour votre Coding Agent.

```bash
npx agent-note init --agent claude
# ou: codex / cursor / gemini
```

Chaque développeur doit l'exécuter une fois localement après le Clone.

Vous pouvez activer plusieurs Agents dans le même Repository:

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

- Claude Code: Commit `.claude/settings.json`
- Codex CLI: Commit `.codex/config.toml` et `.codex/hooks.json`
- Cursor: Commit `.cursor/hooks.json`
- Gemini CLI: Commit `.gemini/settings.json`

3. Continuez à utiliser votre Workflow `git commit` habituel.

Avec les Git Hooks générés, Agent Note enregistre automatiquement les Commits faits avec `git commit`.

## AI Agent Skill

Si votre AI Agent prend en charge GitHub Agent Skills, installez le skill Agent Note pour demander les tâches Agent Note en langage naturel.

```bash
gh skill install wasabeef/AgentNote agent-note --agent codex --scope user
```

Pour `gh skill install`, choisissez l'identifiant d'agent adapté: `codex`, `claude-code`, `cursor` or `gemini-cli`. Le skill guide normalement l'agent vers seulement six commandes publiques: `init`, `deinit`, `status`, `log`, `show` et `why`.

## Données sauvegardées

Agent Note enregistre l'histoire du Commit:

- Conversation: la demande et la réponse IA qui ont mené au changement
- Contexte: de courtes Notes affichées comme `📝 Context` quand la demande seule est trop courte

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- Fichiers: les fichiers modifiés et si l'IA a aidé à les éditer
- AI Ratio: un pourcentage global, avec le nombre de lignes quand Agent Note peut l'estimer

Les données temporaires de Session vivent sous `.git/agentnote/`. L'enregistrement permanent vit dans `refs/notes/agentnote` et se partage avec `git push`.

### Exclure les bundles générés de l’AI Ratio

Si des bundles ou generated outputs commités doivent rester visibles sans influencer l’AI Ratio, ajoutez-les au `.agentnoteignore` à la racine du repository :

```gitignore
packages/cli/dist/**
packages/pr-report/dist/**
```

Ces fichiers restent visibles dans Notes, PR Report et Dashboard. Ils sont seulement retirés du dénominateur de l’AI Ratio.

## Agent Support

| Agent | Statut | Prompt | Response | Files | AI Ratio | Line Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Full support | Oui | Oui | Oui | Oui | Par défaut |
| Codex CLI | Supported | Oui | Oui | Oui | Oui | Quand l'historique de patch Codex correspond au Commit final |
| Cursor | Supported | Oui | Oui | Oui | Oui | Quand les compteurs d'edit correspondent et que le fichier final correspond encore au dernier edit IA |
| Gemini CLI | Preview | Oui | Oui | Oui | Oui | Pas encore |

`Files` signifie qu'Agent Note peut montrer quels fichiers commités ont été touchés par l'Agent. `Line Estimate` signifie qu'il peut aussi estimer les lignes écrites par l'AI au lieu de seulement compter les fichiers.

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

`agent:` montre les adapters d'Agent activés. `capture:` résume ce que les Hooks de l'Agent actif collectent. `git:` indique si les Hooks git locaux gérés sont installés. `commit:` indique si `git commit` est le chemin de Tracking principal.

## Ce que vous obtenez

### Chaque Commit raconte son histoire

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

### Parcourir l'historique d'un coup d'oeil

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Report

Par défaut, la GitHub Action poste un rapport de Session IA dans la description de la PR:

Le bloc `agentnote-reviewer-context` est enregistré comme hidden comment dans le PR body. Les AI Review tools qui lisent la raw PR description, comme Copilot, CodeRabbit, Devin et Greptile, peuvent l'utiliser comme intent et review focus supplémentaires.

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

## Fonctionnement

```
Vous envoyez un Prompt à votre Coding Agent
        │
        ▼
Les Hooks sauvegardent la conversation et les informations de Session
        │
        ▼
L'Agent modifie les fichiers
        │
        ▼
Les Hooks ou Local Transcripts enregistrent les fichiers modifiés
        │
        ▼
Vous exécutez `git commit`
        │
        ▼
Agent Note écrit une Git Note pour ce Commit
        │
        ▼
Vous exécutez `git push`
        │
        ▼
`refs/notes/agentnote` est poussé avec votre Branch
```

Pour le Flow détaillé, la façon dont Agent Note estime le travail écrit par l'IA et le schéma stocké, consultez [Fonctionnement](https://wasabeef.github.io/AgentNote/fr/how-it-works/).

## Commands

| Command | Ce que cela fait |
| --- | --- |
| `agent-note init` | Configure Hooks, Workflow, Git Hooks et notes auto-fetch |
| `agent-note deinit` | Supprime les hooks et la configuration Agent Note |
| `agent-note status` | Affiche l'état du Tracking |
| `agent-note log [n]` | Liste les Commits récents avec AI Ratio |
| `agent-note show [commit]` | Affiche la Session IA derrière `HEAD` ou un Commit SHA |
| `agent-note why <target>` | Explique le contexte Agent Note derrière une ligne ou une plage de fichier |

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

Définissez `prompt_detail` sur `compact` ou `full` pour obtenir un historique de Prompts ciblé ou complet. La valeur par défaut est `compact`: il garde le rapport lisible en affichant les Prompts qui expliquent le Commit, tandis que `full` affiche tous les Prompts enregistrés.

Dashboard Mode utilise la même action avec `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
    prompt_detail: compact
```

### Données du Dashboard

Pour la plupart des dépôts, vous n'avez pas besoin d'écrire le Workflow à la main. Générez-le avec `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Commitez ensuite `.github/workflows/agentnote-pr-report.yml` et `.github/workflows/agentnote-dashboard.yml`, activez GitHub Pages avec `GitHub Actions` comme Source, puis ouvrez `/dashboard/`.

Si vous avez déjà un Site GitHub Pages, consultez les [docs Dashboard](https://wasabeef.github.io/AgentNote/fr/dashboard/) pour la configuration combinée sûre.

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

- Agent Note est Local-first. Le Core CLI fonctionne sans service hébergé.
- Les données temporaires de Session sont stockées sous `.git/agentnote/` dans votre dépôt.
- L'enregistrement permanent est stocké dans `refs/notes/agentnote`, pas dans les fichiers Source suivis.
- Pour les Agents pilotés par Transcript, Agent Note lit les fichiers Transcript locaux dans le répertoire de données de l'Agent.
- Le CLI n'envoie pas de télémétrie.
- Le Tracking des Commits est Best-effort. Si Agent Note échoue dans un Hook, votre `git commit` réussit quand même.

## Design

Zero runtime dependencies · Git notes storage · Never breaks `git commit` · No telemetry · Agent-agnostic architecture

[Détails d'architecture →](docs/architecture.md)

## Contribuer

[Guide de contribution →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## Licence

MIT — [LICENSE](LICENSE)
