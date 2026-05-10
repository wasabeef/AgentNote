# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [es] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — conversaciones con IA guardadas en Git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Conoce <em>por qué</em> cambió tu código, no solo <em>qué</em> cambió.</strong></p>

<p align="center">
Agent Note guarda la conversación con la IA y los archivos modificados en cada Commit. Cuando hay suficiente detalle, también muestra una estimación práctica de cuánto del cambio vino de la IA.
</p>

<p align="center">
Piensa en ello como <code>git log</code> más la conversación AI detrás del cambio.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/es/">Documentación</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Por qué Agent Note

- Ve la conversación con la IA detrás de cada Commit asistido.
- Revisa en la Pull Request los archivos que la IA ayudó a modificar y la proporción estimada de IA.
- Abre un Dashboard compartido que convierte el historial de Commits en una historia legible.
- Mantén los datos en git con `refs/notes/agentnote` — sin Hosted Service ni Telemetry.

## Requisitos

- Git
- Node.js 20 o superior
- Un Coding Agent compatible, instalado y autenticado

## AI Agent Skill

Si tu AI Agent admite GitHub Agent Skills, instala el Skill de Agent Note para pedir tareas de Agent Note en lenguaje natural.

```bash
gh skill install wasabeef/AgentNote agent-note --agent codex --scope user
```

Para `gh skill install`, elige el identificador de agente adecuado: `codex`, `claude-code`, `cursor` or `gemini-cli`. El Skill normalmente guía al agente hacia solo seis comandos públicos: `init`, `deinit`, `status`, `log`, `show` y `why`.

## Quick Start

1. Habilita Agent Note para tu Coding Agent.

```bash
npx agent-note init --agent claude
# o: codex / cursor / gemini
```

Cada desarrollador debe ejecutarlo una vez localmente después de clonar.

Puedes habilitar más de un Agent en el mismo Repository:

```bash
npx agent-note init --agent claude cursor
```

Si también quieres el Dashboard compartido en GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Haz Commit de los archivos generados y Push.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# reemplaza .claude/settings.json por la config de tu agent abajo
# con --dashboard, agrega también .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: Commit `.claude/settings.json`
- Codex CLI: Commit `.codex/config.toml` y `.codex/hooks.json`
- Cursor: Commit `.cursor/hooks.json`
- Gemini CLI: Commit `.gemini/settings.json`

3. Sigue usando tu Workflow normal de `git commit`.

Con los Git Hooks generados instalados, Agent Note registra automáticamente los Commits hechos con `git commit`.

## Datos guardados

Agent Note guarda la historia del Commit:

- Conversación: la solicitud y la respuesta de IA que llevaron al cambio
- Contexto: notas breves que se muestran como `📝 Context` cuando la solicitud por sí sola es demasiado corta

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- Archivos: archivos modificados y si la IA ayudó a editarlos
- Participación de IA: un porcentaje general, más conteo de líneas cuando Agent Note puede estimarlo

Los datos temporales de sesión viven en `.git/agentnote/`. El registro permanente vive en `refs/notes/agentnote` y se comparte con `git push`.

### Excluir bundles generados del AI Ratio

Si los bundles o generated outputs commiteados deben seguir visibles pero no afectar el AI Ratio, agrégalos a la `.agentnoteignore` en la raíz del repository:

```gitignore
packages/cli/dist/**
packages/pr-report/dist/**
```

Esos archivos siguen apareciendo en Notes, PR Report y Dashboard. Solo se eliminan del denominador del AI Ratio.

## Agent Support

| Agent | Estado | Prompt | Response | Files | AI Ratio | Line Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Full support | Sí | Sí | Sí | Sí | Por defecto |
| Codex CLI | Supported | Sí | Sí | Sí | Sí | Cuando el historial de parches de Codex coincide con el Commit final |
| Cursor | Supported | Sí | Sí | Sí | Sí | Cuando los conteos de edit coinciden y el archivo final aún coincide con el último edit de IA |
| Gemini CLI | Preview | Sí | Sí | Sí | Sí | Todavía no |

`Files` significa que Agent Note puede mostrar qué archivos commiteados tocó el Agent. `Line Estimate` significa que también puede estimar líneas escritas por la IA en lugar de contar solo archivos.

## Verifica tu Setup

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

`agent:` muestra qué adapters de Agent están habilitados. `capture:` resume qué recopilan los Hooks del Agent activo. `git:` muestra si los Git Hooks locales gestionados están instalados. `commit:` indica si `git commit` es la ruta principal de Tracking.

## Qué obtienes

### Cada Commit cuenta su historia

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

### Escanea tu history de un vistazo

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Report

De forma predeterminada, la GitHub Action publica un reporte de sesión AI en la PR Description:

El bloque `agentnote-reviewer-context` se guarda como hidden comment en el PR body. Las AI Review tools que leen la raw PR description, como Copilot, CodeRabbit, Devin y Greptile, pueden usarlo como intent y review focus adicional.

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

## Cómo funciona

```
Envías un Prompt a tu Coding Agent
        │
        ▼
Los Hooks guardan la conversación y la información de Session
        │
        ▼
El Agent edita archivos
        │
        ▼
Los Hooks o Local Transcripts registran qué archivos cambiaron
        │
        ▼
Ejecutas `git commit`
        │
        ▼
Agent Note escribe una Git Note para ese Commit
        │
        ▼
Ejecutas `git push`
        │
        ▼
`refs/notes/agentnote` se pushea junto con tu Branch
```

Para el Flow detallado, cómo Agent Note estima el trabajo escrito por IA y el Schema guardado, consulta [Cómo funciona](https://wasabeef.github.io/AgentNote/es/how-it-works/).

## Commands

| Command | Qué hace |
| --- | --- |
| `agent-note init` | Configura Hooks, Workflow, Git Hooks y notes auto-fetch |
| `agent-note deinit` | Elimina hooks y configuración de Agent Note |
| `agent-note status` | Muestra el estado de Tracking |
| `agent-note log [n]` | Lista Commits recientes con AI Ratio |
| `agent-note show [commit]` | Muestra la sesión AI detrás de `HEAD` o un Commit SHA |
| `agent-note why <target>` | Explica el contexto de Agent Note detrás de una línea o rango de archivo |

## GitHub Action

La root action tiene dos modos:

- PR Report Mode actualiza la Pull Request description o publica un comment.
- Dashboard Mode genera los datos del Dashboard compartido y publica `/dashboard/` mediante GitHub Pages.

PR Report Mode es el predeterminado:

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Configura `prompt_detail` como `compact` o `full` cuando quieras un historial de Prompts enfocado o completo. El valor predeterminado es `compact`: mantiene el informe legible mostrando los Prompts que explican el Commit, mientras que `full` muestra todos los Prompts guardados.

Dashboard Mode usa la misma action con `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
    prompt_detail: compact
```

### Datos del Dashboard

En la mayoría de repositorios no necesitas escribir el Workflow a mano. Genéralo con `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Después haz Commit de `.github/workflows/agentnote-pr-report.yml` y `.github/workflows/agentnote-dashboard.yml`, habilita GitHub Pages con `GitHub Actions` como Source y abre `/dashboard/`.

Si ya tienes un sitio GitHub Pages, consulta la [documentación Dashboard](https://wasabeef.github.io/AgentNote/es/dashboard/) para el Setup combinado seguro.

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
<summary>Qué se guarda</summary>

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

## Seguridad y privacidad

- Agent Note es Local-first. El Core CLI funciona sin Hosted Service.
- Los datos temporales de sesión se almacenan en `.git/agentnote/` dentro de tu repositorio.
- El registro permanente se almacena en `refs/notes/agentnote`, no en archivos fuente versionados.
- Para Agents que mantienen registros locales de conversación, Agent Note lee esos archivos desde el directorio de datos propio del Agent.
- El CLI no envía Telemetry.
- El Commit Tracking es Best-effort. Si Agent Note falla durante un Hook, tu `git commit` igualmente continúa.

## Design

Zero runtime dependencies · Git notes storage · Never breaks `git commit` · No telemetry · Agent-agnostic architecture

[Detalles de arquitectura →](docs/architecture.md)

## Contribuir

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## Licencia

MIT — [LICENSE](LICENSE)
