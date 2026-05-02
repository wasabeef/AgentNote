# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [pt-BR]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Saiba <em>por que</em> seu código mudou, não apenas <em>o que</em> mudou.</strong></p>

<p align="center">
Agent Note registra cada prompt, response e arquivo atribuído à AI, e então anexa esse contexto aos seus commits git. Ele alcança line-level attribution quando o agent expõe histórico de edição suficiente.
</p>

<p align="center">
Pense nele como <code>git log</code> mais a conversa de AI por trás da mudança.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/pt-br/">Documentação</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Por que Agent Note

- Veja o prompt e a response por trás de cada commit assistido por AI.
- Revise AI-authored files e AI ratio diretamente na Pull Request.
- Abra um Dashboard compartilhado que transforma o histórico de commits em uma story legível.
- Mantenha os dados git-native em `refs/notes/agentnote` — sem hosted service, sem telemetry.

## Requisitos

- Git
- Node.js 20 ou mais recente
- Um coding agent compatível, instalado e autenticado

## Quick Start

1. Habilite Agent Note para seu coding agent.

```bash
npx agent-note init --agent claude
# ou: codex / cursor / gemini
```

Cada developer deve executar isso uma vez localmente após clonar.

Você pode habilitar mais de um agent no mesmo repository:

```bash
npx agent-note init --agent claude cursor
```

Se também quiser o shared Dashboard no GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Faça commit dos arquivos gerados e push.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# substitua .claude/settings.json pela config do seu agent abaixo
# com --dashboard, adicione também .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: commit `.claude/settings.json`
- Codex CLI: commit `.codex/config.toml` e `.codex/hooks.json`
- Cursor: commit `.cursor/hooks.json`
- Gemini CLI: commit `.gemini/settings.json`

3. Continue usando seu workflow normal de `git commit`.

Com os git hooks gerados instalados, Agent Note registra commits automaticamente. Use `agent-note commit -m "..."` apenas como fallback quando os git hooks não estiverem disponíveis.

## Dados salvos

Agent Note salva a história do commit:

- `prompt` / `response`: a conversa por trás da mudança
- `contexts[]`: dicas display-only mostradas como `📝 Context` quando um prompt é curto demais

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- `files`: arquivos modificados e se a AI tocou neles
- `attribution`: AI ratio, método e line counts quando disponíveis

Temporary session data ficam em `.git/agentnote/`. O permanent record fica em `refs/notes/agentnote` e é compartilhado com `git push`.

## Agent Support

| Agent | Status | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | Line-level por padrão | Hook-native prompt / response recovery |
| Codex CLI | Preview | File-level por padrão | Transcript-driven. Line-level só é promovido quando os counts de `apply_patch` do transcript batem com o final commit diff. Se o transcript não puder ser lido, Agent Note pula a criação da note em vez de gravar dados incertos. |
| Cursor | Supported | File-level por padrão | Usa hooks `afterFileEdit` / `afterTabFileEdit`. Line-level só é promovido quando o committed blob ainda corresponde ao latest AI edit. |
| Gemini CLI | Preview | File-level | Hook-based capture com suporte a `git commit` normal por meio dos git hooks gerados |

## Verifique o setup

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

`agent:` mostra quais agent adapters estão habilitados. `capture:` resume o que os active agent hooks coletam. `git:` mostra se os managed repository-local git hooks estão instalados. `commit:` indica o primary tracking path: `git commit` normal quando git hooks estão ativos, ou fallback mode quando você deve preferir `agent-note commit`.

## O que você recebe

### Todo commit conta sua story

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

### Escaneie sua history rapidamente

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

Isso publica um AI session report na PR description:

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## Como funciona

```
Você envia um prompt ao coding agent
        │
        ▼
hooks capturam o prompt e session metadata
        │
        ▼
O agent edita files
        │
        ▼
hooks ou local transcripts registram touched files e attribution signals
        │
        ▼
Você executa `git commit`
        │
        ▼
Agent Note grava uma git note para esse commit
        │
        ▼
Você executa `git push`
        │
        ▼
`refs/notes/agentnote` é enviado junto com a branch
```

Para o flow detalhado, as attribution rules e o schema, veja [Como funciona](https://wasabeef.github.io/AgentNote/pt-br/how-it-works/).

## Commands

| Command | O que faz |
| --- | --- |
| `agent-note init` | Configura hooks, workflow, git hooks e notes auto-fetch |
| `agent-note deinit` | Remove hooks e config de um agent |
| `agent-note show [commit]` | Mostra a AI session por trás de `HEAD` ou de um commit SHA |
| `agent-note log [n]` | Lista recent commits com AI ratio |
| `agent-note pr [base]` | Gera PR Report (markdown ou JSON) |
| `agent-note session <id>` | Mostra todos os commits vinculados a uma session |
| `agent-note commit [args]` | Fallback wrapper em torno de `git commit` quando git hooks não estão disponíveis |
| `agent-note status` | Mostra o tracking state |

## GitHub Action

A root action tem dois modes:

- PR Report Mode atualiza a Pull Request description ou publica um comment.
- Dashboard Mode gera os dados do Dashboard compartilhado e publica `/dashboard/` via GitHub Pages.

PR Report Mode é o default:

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Defina `prompt_detail` como `compact` ou `full` quando quiser um histórico de prompts focado ou completo. O padrão é `compact`: ele mantém o relatório legível mostrando os prompts que explicam o commit, enquanto `full` mostra todos os prompts salvos.

Dashboard Mode usa a mesma action com `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
    prompt_detail: compact
```

### Dados do Dashboard

Na maioria dos repositórios, você não precisa escrever o workflow manualmente. Gere com `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Depois faça commit de `.github/workflows/agentnote-pr-report.yml` e `.github/workflows/agentnote-dashboard.yml`, habilite GitHub Pages com `GitHub Actions` como source e abra `/dashboard/`.

Se você já tem um site GitHub Pages, veja a configuração combinada segura nas [Dashboard docs](https://wasabeef.github.io/AgentNote/pt-br/dashboard/).

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
<summary>O que é salvo</summary>

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

- Agent Note é local-first. O core CLI funciona sem hosted service.
- Temporary session data são armazenados em `.git/agentnote/` dentro do seu repositório.
- O permanent record é armazenado em `refs/notes/agentnote`, não em tracked source files.
- Para transcript-driven agents, Agent Note lê local transcript files do data directory do próprio agent.
- O CLI não envia telemetry.
- Commit tracking é best-effort. Se Agent Note falhar durante um hook, seu `git commit` ainda será bem-sucedido.

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Detalhes da arquitetura →](docs/architecture.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## Licença

MIT — [LICENSE](LICENSE)
