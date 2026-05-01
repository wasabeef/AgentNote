# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [es] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Conoce <em>por qué</em> cambió tu código, no solo <em>qué</em> cambió.</strong></p>

<p align="center">
Agent Note registra cada prompt, response y archivo atribuido a AI, y luego adjunta ese contexto a tus commits git. Alcanza line-level attribution cuando el agent expone suficiente historial de edición.
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

- Ve el prompt y response detrás de cada commit asistido por AI.
- Revisa archivos escritos por AI y el AI ratio directamente en la Pull Request.
- Abre un Dashboard compartido que convierte el historial de commits en una historia legible.
- Mantén los datos en git con `refs/notes/agentnote` — sin hosted service ni telemetry.

## Requisitos

- Git
- Node.js 20 o superior
- Un coding agent compatible, instalado y autenticado

## Quick Start

1. Habilita Agent Note para tu coding agent.

```bash
npx agent-note init --agent claude
# o: codex / cursor / gemini
```

Cada developer debe ejecutarlo una vez localmente después de clonar.

Puedes habilitar más de un agent en el mismo repository:

```bash
npx agent-note init --agent claude cursor
```

Si también quieres el Dashboard compartido en GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Haz commit de los archivos generados y push.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# reemplaza .claude/settings.json por la config de tu agent abajo
# con --dashboard, agrega también .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: commit `.claude/settings.json`
- Codex CLI: commit `.codex/config.toml` y `.codex/hooks.json`
- Cursor: commit `.cursor/hooks.json`
- Gemini CLI: commit `.gemini/settings.json`

3. Sigue usando tu workflow normal de `git commit`.

Con los git hooks generados instalados, Agent Note registra commits automáticamente. Usa `agent-note commit -m "..."` solo como fallback cuando los git hooks no están disponibles.

## Datos guardados

Agent Note guarda la historia del commit:

- `prompt` / `response`: la conversación detrás del cambio
- `contexts[]`: ayudas display-only que se muestran como `📝 Context` cuando un prompt es demasiado corto

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- `files`: archivos modificados y si AI los tocó
- `attribution`: AI ratio, método y line counts cuando están disponibles

Los datos temporales de sesión viven en `.git/agentnote/`. El registro permanente vive en `refs/notes/agentnote` y se comparte con `git push`.

## Agent Support

| Agent | Estado | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | Line-level por defecto | Recuperación prompt / response con hooks nativos |
| Codex CLI | Preview | File-level por defecto | Basado en transcript. Line-level se activa solo cuando los conteos `apply_patch` del transcript coinciden con el diff final del commit. Si el transcript no puede leerse, Agent Note omite la creación de note en vez de escribir datos inciertos. |
| Cursor | Supported | File-level por defecto | Usa hooks `afterFileEdit` / `afterTabFileEdit`. Line-level se activa solo cuando el blob commiteado aún coincide con el último edit AI. |
| Gemini CLI | Preview | File-level | Captura basada en hooks con soporte para `git commit` normal mediante los git hooks generados |

## Verifica tu setup

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

`agent:` muestra qué adapters de agent están habilitados. `capture:` resume qué recopilan los hooks del agent activo. `git:` muestra si los git hooks locales gestionados están instalados. `commit:` indica la ruta principal de tracking: `git commit` normal cuando los git hooks están activos, o fallback mode cuando conviene preferir `agent-note commit`.

## Qué obtienes

### Cada commit cuenta su historia

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

### Escanea tu history de un vistazo

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

Esto publica un reporte de sesión AI en la PR description:

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## Cómo funciona

```
Envías un prompt a tu coding agent
        │
        ▼
Los hooks capturan el prompt y session metadata
        │
        ▼
El agent edita files
        │
        ▼
Los hooks o local transcripts registran touched files y attribution signals
        │
        ▼
Ejecutas `git commit`
        │
        ▼
Agent Note escribe una git note para ese commit
        │
        ▼
Ejecutas `git push`
        │
        ▼
`refs/notes/agentnote` se pushea junto con tu branch
```

Para el flow detallado, las attribution rules y el schema, consulta [Cómo funciona](https://wasabeef.github.io/AgentNote/es/how-it-works/).

## Commands

| Command | Qué hace |
| --- | --- |
| `agent-note init` | Configura hooks, workflow, git hooks y notes auto-fetch |
| `agent-note deinit` | Elimina hooks y config para un agent |
| `agent-note show [commit]` | Muestra la sesión AI detrás de `HEAD` o un commit SHA |
| `agent-note log [n]` | Lista commits recientes con AI ratio |
| `agent-note pr [base]` | Genera PR Report (markdown o JSON) |
| `agent-note session <id>` | Muestra todos los commits vinculados a una sesión |
| `agent-note commit [args]` | Fallback wrapper alrededor de `git commit` cuando los git hooks no están disponibles |
| `agent-note status` | Muestra el estado de tracking |

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

Configura `prompt_detail` como `compact`, `standard` o `full` cuando quieras un historial de prompts más corto o completo. El valor predeterminado es `standard`: `compact` muestra solo prompts high, `standard` muestra high + medium y `full` muestra todos los prompts guardados.

Dashboard Mode usa la misma action con `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
```

### Datos del Dashboard

En la mayoría de repositorios no necesitas escribir el workflow a mano. Genéralo con `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Después haz commit de `.github/workflows/agentnote-pr-report.yml` y `.github/workflows/agentnote-dashboard.yml`, habilita GitHub Pages con `GitHub Actions` como source y abre `/dashboard/`.

Si ya tienes un sitio GitHub Pages, consulta la [documentación Dashboard](https://wasabeef.github.io/AgentNote/es/dashboard/) para el setup combinado seguro.

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

- Agent Note es local-first. El core CLI funciona sin hosted service.
- Los datos temporales de sesión se almacenan en `.git/agentnote/` dentro de tu repositorio.
- El registro permanente se almacena en `refs/notes/agentnote`, no en archivos fuente versionados.
- Para agents basados en transcript, Agent Note lee archivos transcript locales desde el directorio de datos propio del agent.
- El CLI no envía telemetry.
- El commit tracking es best-effort. Si Agent Note falla durante un hook, tu `git commit` igualmente continúa.

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Detalles de arquitectura →](docs/knowledge/DESIGN.md)

## Contribuir

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## Licencia

MIT — [LICENSE](LICENSE)
