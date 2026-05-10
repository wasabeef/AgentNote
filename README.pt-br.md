# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [<a href="./README.id.md">id</a>] [pt-BR]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — conversas com AI salvas no Git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Saiba <em>por que</em> seu código mudou, não apenas <em>o que</em> mudou.</strong></p>

<p align="center">
Agent Note salva a conversa com a AI e os arquivos alterados em cada Commit. Quando há detalhes suficientes, ele também mostra uma estimativa prática de quanto da mudança veio da AI.
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

- Veja a conversa com a AI por trás de cada Commit assistido.
- Revise na Pull Request os arquivos que a AI ajudou a editar e a participação estimada da AI.
- Abra um Dashboard compartilhado que transforma o histórico de Commits em uma história legível.
- Mantenha os dados Git-native em `refs/notes/agentnote` — sem Hosted Service, sem Telemetry.

## Requisitos

- Git
- Node.js 20 ou mais recente
- Um Coding Agent compatível, instalado e autenticado

## AI Agent Skill

Se o seu AI Agent oferece suporte a GitHub Agent Skills, instale o Agent Note Skill para pedir tarefas do Agent Note em linguagem natural.

```bash
gh skill install wasabeef/AgentNote agent-note --agent codex --scope user
```

Para `gh skill install`, escolha o identificador de agent correto: `codex`, `claude-code`, `cursor` or `gemini-cli`. O Skill normalmente guia o agent para apenas seis comandos públicos: `init`, `deinit`, `status`, `log`, `show` e `why`.

## Quick Start

1. Habilite Agent Note para seu Coding Agent.

```bash
npx agent-note init --agent claude
# ou: codex / cursor / gemini
```

Cada desenvolvedor deve executar isso uma vez localmente após clonar.

Você pode habilitar mais de um Agent no mesmo Repository:

```bash
npx agent-note init --agent claude cursor
```

Se também quiser o shared Dashboard no GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Faça Commit dos arquivos gerados e Push.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# substitua .claude/settings.json pela config do seu agent abaixo
# com --dashboard, adicione também .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: Commit `.claude/settings.json`
- Codex CLI: Commit `.codex/config.toml` e `.codex/hooks.json`
- Cursor: Commit `.cursor/hooks.json`
- Gemini CLI: Commit `.gemini/settings.json`

3. Continue usando seu Workflow normal de `git commit`.

Com os Git Hooks gerados instalados, Agent Note registra automaticamente os Commits feitos com `git commit`.

## Dados salvos

Agent Note salva a história do Commit:

- Conversa: o pedido e a resposta da AI que levaram à mudança
- Contexto: notas curtas mostradas como `📝 Context` quando o pedido sozinho é curto demais

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- Arquivos: arquivos modificados e se a AI ajudou a Editá-los
- Participação da AI: uma porcentagem geral, mais contagem de linhas quando Agent Note consegue estimar

Temporary Session Data ficam em `.git/agentnote/`. O Permanent Record fica em `refs/notes/agentnote` e é compartilhado com `git push`.

### Excluir bundles gerados do AI Ratio

Se bundles ou generated outputs commitados devem continuar visíveis, mas não influenciar o AI Ratio, adicione-os à `.agentnoteignore` na raiz do repository:

```gitignore
packages/cli/dist/**
packages/pr-report/dist/**
```

Esses arquivos continuam aparecendo em Notes, PR Report e Dashboard. Eles são removidos apenas do denominador do AI Ratio.

## Agent Support

| Agent | Status | Prompt | Response | Files | AI Ratio | Line Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Full support | Sim | Sim | Sim | Sim | Por padrão |
| Codex CLI | Supported | Sim | Sim | Sim | Sim | Quando o histórico de patches do Codex bate com o Commit final |
| Cursor | Supported | Sim | Sim | Sim | Sim | Quando a contagem de edições coincide e o arquivo final ainda bate com a última edição da IA |
| Gemini CLI | Preview | Sim | Sim | Sim | Sim | Ainda não |

`Files` significa que Agent Note pode mostrar quais arquivos commitados foram tocados pelo Agent. `Line Estimate` significa que ele também pode estimar linhas escritas pela IA, em vez de apenas contar arquivos.

## Verifique o Setup

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

`agent:` mostra quais adaptadores de agent estão habilitados. `capture:` resume o que os hooks ativos coletam. `git:` mostra se os Git Hooks locais gerenciados estão instalados. `commit:` indica se `git commit` é o caminho principal de rastreamento.

## O que você recebe

### Todo Commit conta sua Story

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

### Escaneie sua history rapidamente

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Report

Por padrão, a GitHub Action publica um relatório de sessão de IA na descrição da PR:

O bloco `agentnote-reviewer-context` é salvo como hidden comment no PR body. AI Review tools que leem a raw PR description, como Copilot, CodeRabbit, Devin e Greptile, podem usá-lo como intent e review focus adicionais.

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

## Como funciona

```
Você envia um Prompt ao Coding Agent
        │
        ▼
Hooks salvam a conversa e as informações de Session
        │
        ▼
O Agent edita arquivos
        │
        ▼
Hooks ou Local Transcripts registram quais arquivos mudaram
        │
        ▼
Você executa `git commit`
        │
        ▼
Agent Note grava uma Git Note para esse Commit
        │
        ▼
Você executa `git push`
        │
        ▼
`refs/notes/agentnote` é enviado junto com a Branch
```

Para o Flow detalhado, como Agent Note estima o trabalho escrito pela IA e o Schema salvo, veja [Como funciona](https://wasabeef.github.io/AgentNote/pt-br/how-it-works/).

## Commands

| Command | O que faz |
| --- | --- |
| `agent-note init` | Configura Hooks, Workflow, Git Hooks e notes auto-fetch |
| `agent-note deinit` | Remove hooks e config do Agent Note |
| `agent-note status` | Mostra o estado de rastreamento |
| `agent-note log [n]` | Lista commits recentes com proporção de IA |
| `agent-note show [commit]` | Mostra a sessão de IA por trás de `HEAD` ou de um Commit SHA |
| `agent-note why <target>` | Explica o contexto do Agent Note por trás de uma linha ou intervalo de arquivo |

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

Defina `prompt_detail` como `compact` ou `full` quando quiser um histórico de Prompts focado ou completo. O padrão é `compact`: ele mantém o relatório legível mostrando os Prompts que explicam o Commit, enquanto `full` mostra todos os Prompts salvos.

Dashboard Mode usa a mesma action com `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
    prompt_detail: compact
```

### Dados do Dashboard

Na maioria dos repositórios, você não precisa escrever o Workflow manualmente. Gere com `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Depois faça Commit de `.github/workflows/agentnote-pr-report.yml` e `.github/workflows/agentnote-dashboard.yml`, habilite GitHub Pages com `GitHub Actions` como Source e abra `/dashboard/`.

Se você já tem um Site GitHub Pages, veja a configuração combinada segura nas [Dashboard Docs](https://wasabeef.github.io/AgentNote/pt-br/dashboard/).

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

- Agent Note é Local-first. O Core CLI funciona sem Hosted Service.
- Temporary Session Data são armazenados em `.git/agentnote/` dentro do seu repositório.
- O Permanent Record é armazenado em `refs/notes/agentnote`, não em Tracked Source Files.
- Para Agents que mantêm logs locais da conversa, Agent Note lê esses arquivos do Data Directory do próprio Agent.
- O CLI não envia Telemetry.
- Commit Tracking é Best-effort. Se Agent Note falhar durante um Hook, seu `git commit` ainda será bem-sucedido.

## Design

Zero runtime dependencies · Git notes storage · Never breaks `git commit` · No telemetry · Agent-agnostic architecture

[Detalhes da arquitetura →](docs/architecture.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## Licença

MIT — [LICENSE](LICENSE)
