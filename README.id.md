# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [id] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — percakapan AI disimpan ke Git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Ketahui <em>mengapa</em> kode berubah, bukan hanya <em>apa</em> yang berubah.</strong></p>

<p align="center">
Agent Note menyimpan percakapan dengan AI dan file yang berubah untuk setiap Commit. Jika datanya cukup, Agent Note juga menampilkan perkiraan praktis seberapa besar perubahan yang dibuat dengan bantuan AI.
</p>

<p align="center">
Anggap saja sebagai <code>git log</code> ditambah percakapan AI di balik perubahan.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/id/">Dokumentasi</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Mengapa Agent Note

- Lihat percakapan AI di balik setiap Commit yang dibantu AI.
- Tinjau file yang ikut diedit AI dan perkiraan porsi AI langsung di Pull Request.
- Buka Dashboard bersama yang mengubah Commit History menjadi cerita yang mudah dibaca.
- Simpan data secara Git-native di `refs/notes/agentnote` — tanpa Hosted Service, tanpa Telemetry.

## Persyaratan

- Git
- Node.js 20 atau lebih baru
- Coding Agent yang didukung, sudah terpasang dan terautentikasi

## AI Agent Skill

Jika AI Agent Anda mendukung GitHub Agent Skills, pasang Agent Note Skill agar Anda bisa meminta tugas Agent Note dengan bahasa natural.

```bash
gh skill install wasabeef/AgentNote agent-note --agent codex --scope user
```

Pilih nilai `--agent` yang sesuai: `codex`, `claude-code`, `cursor`, atau `gemini-cli`. Skill biasanya hanya mengarahkan agent ke enam command publik: `init`, `deinit`, `status`, `log`, `show`, dan `why`.

## Quick Start

1. Aktifkan Agent Note untuk Coding Agent Anda.

```bash
npx agent-note init --agent claude
# atau: codex / cursor / gemini
```

Setiap pengembang harus menjalankannya sekali secara lokal setelah Clone.

Anda dapat mengaktifkan lebih dari satu Agent dalam Repository yang sama:

```bash
npx agent-note init --agent claude cursor
```

Jika juga ingin shared Dashboard di GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Commit file yang dibuat dan Push.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# ganti .claude/settings.json dengan config agent Anda di bawah
# dengan --dashboard, tambahkan juga .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: Commit `.claude/settings.json`
- Codex CLI: Commit `.codex/config.toml` dan `.codex/hooks.json`
- Cursor: Commit `.cursor/hooks.json`
- Gemini CLI: Commit `.gemini/settings.json`

3. Terus gunakan Workflow `git commit` normal.

Dengan Git Hooks yang dibuat, Agent Note otomatis merekam Commit dari `git commit` biasa.

## Data yang disimpan

Agent Note menyimpan cerita Commit:

- Percakapan: permintaan dan jawaban AI yang mengarah ke perubahan
- Context: catatan singkat yang tampil sebagai `📝 Context` saat permintaan saja terlalu pendek

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- File: file yang berubah dan apakah AI ikut mengeditnya
- Porsi AI: perkiraan persentase keseluruhan, plus jumlah baris jika Agent Note dapat memperkirakannya

Temporary Session Data berada di `.git/agentnote/`. Permanent Record berada di `refs/notes/agentnote` dan dibagikan melalui `git push`.

### Keluarkan generated bundle dari AI Ratio

Jika bundle atau generated output yang di-commit harus tetap terlihat tetapi tidak memengaruhi AI Ratio, tambahkan ke `.agentnoteignore` di repository root:

```gitignore
packages/cli/dist/**
packages/pr-report/dist/**
```

File tersebut tetap muncul di Notes, PR Report, dan Dashboard. File hanya dikeluarkan dari denominator AI Ratio.

## Agent Support

| Agent | Status | Prompt | Response | Files | AI Ratio | Line Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Full support | Ya | Ya | Ya | Ya | Default |
| Codex CLI | Supported | Ya | Ya | Ya | Ya | Saat riwayat patch Codex cocok dengan Commit akhir |
| Cursor | Supported | Ya | Ya | Ya | Ya | Saat jumlah edit cocok dan file akhir masih cocok dengan edit AI terakhir |
| Gemini CLI | Preview | Ya | Ya | Ya | Ya | Belum |

`Files` berarti Agent Note dapat menunjukkan file yang di-commit dan disentuh oleh Agent. `Line Estimate` berarti Agent Note juga dapat memperkirakan baris yang ditulis AI, bukan hanya menghitung file.

## Periksa Setup

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

`agent:` menunjukkan Agent Adapters yang aktif. `capture:` merangkum apa yang dikumpulkan Active Agent Hooks. `git:` menunjukkan apakah Managed Repository-Local Git Hooks sudah terpasang. `commit:` memberi tahu apakah `git commit` biasa adalah Primary Tracking Path.

## Yang Anda dapatkan

### Setiap Commit punya Story

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

### Scan history sekilas

```
$ npx agent-note log

ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### PR Report

GitHub Action memposting AI Session Report ke PR Description:

Blok `agentnote-reviewer-context` disimpan sebagai hidden comment di PR body. AI Review tool yang membaca raw PR description, seperti Copilot, CodeRabbit, Devin, dan Greptile, dapat menggunakannya sebagai intent dan review focus tambahan.

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

## Cara kerja

```
Anda mengirim Prompt ke Coding Agent
        │
        ▼
Hooks menyimpan percakapan dan informasi Session
        │
        ▼
Agent mengedit file
        │
        ▼
Hooks atau Local Transcripts mencatat file yang berubah
        │
        ▼
Anda menjalankan `git commit`
        │
        ▼
Agent Note menulis Git Note untuk Commit itu
        │
        ▼
Anda menjalankan `git push`
        │
        ▼
`refs/notes/agentnote` ikut di-push bersama Branch
```

Untuk Flow detail, cara Agent Note memperkirakan pekerjaan yang ditulis AI, dan Schema yang disimpan, lihat [Cara kerja](https://wasabeef.github.io/AgentNote/id/how-it-works/).

## Commands

| Command | Fungsi |
| --- | --- |
| `agent-note init` | Menyiapkan Hooks, Workflow, Git Hooks, dan Notes auto-fetch |
| `agent-note deinit` | Menghapus hooks dan config Agent Note |
| `agent-note status` | Menampilkan Tracking state |
| `agent-note log [n]` | Mendaftar Recent Commits dengan AI Ratio |
| `agent-note show [commit]` | Menampilkan AI Session di balik `HEAD` atau Commit SHA |
| `agent-note why <target>` | Menjelaskan konteks Agent Note di balik satu baris atau rentang baris file |

## GitHub Action

Root action punya dua mode:

- PR Report Mode memperbarui Pull Request description atau memposting comment.
- Dashboard Mode membangun data Dashboard bersama dan memublikasikan `/dashboard/` melalui GitHub Pages.

PR Report Mode adalah default:

```yaml
- uses: wasabeef/AgentNote@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Atur `prompt_detail` ke `compact` atau `full` jika ingin riwayat Prompt yang fokus atau lengkap. Default-nya adalah `compact`: preset ini menjaga laporan tetap mudah dibaca dengan menampilkan Prompt yang menjelaskan Commit, sedangkan `full` menampilkan semua Prompt yang tersimpan.

Dashboard Mode memakai action yang sama dengan `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
    prompt_detail: compact
```

### Data Dashboard

Untuk sebagian besar repositori, Anda tidak perlu menulis Workflow manual. Generate dengan `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Lalu Commit `.github/workflows/agentnote-pr-report.yml` dan `.github/workflows/agentnote-dashboard.yml`, aktifkan GitHub Pages dengan Source `GitHub Actions`, dan buka `/dashboard/`.

Jika Anda sudah punya GitHub Pages Site, lihat [Dashboard Docs](https://wasabeef.github.io/AgentNote/id/dashboard/) untuk Setup gabungan yang aman.

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
<summary>Yang disimpan</summary>

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

- Agent Note Local-first. Core CLI bekerja tanpa Hosted Service.
- Temporary Session Data disimpan di `.git/agentnote/` dalam repositori Anda.
- Permanent Record disimpan di `refs/notes/agentnote`, bukan di Tracked Source Files.
- Untuk Agents yang menyimpan log percakapan lokal, Agent Note membaca file tersebut dari Data Directory milik Agent.
- CLI tidak mengirim Telemetry.
- Commit Tracking bersifat Best-effort. Jika Agent Note gagal saat Hook, `git commit` Anda tetap berhasil.

## Design

Zero runtime dependencies · Git notes storage · Never breaks `git commit` · No telemetry · Agent-agnostic architecture

[Detail arsitektur →](docs/architecture.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
