# Agent Note

<p align="center">
  [<a href="./README.md">en</a>] [<a href="./README.ja.md">ja</a>] [<a href="./README.fr.md">fr</a>] [<a href="./README.de.md">de</a>] [<a href="./README.it.md">it</a>] [<a href="./README.es.md">es</a>] [<a href="./README.ko.md">ko</a>] [<a href="./README.zh-cn.md">zh-CN</a>] [<a href="./README.zh-tw.md">zh-TW</a>] [<a href="./README.ru.md">ru</a>] [id] [<a href="./README.pt-br.md">pt-BR</a>]
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Agent Note — AI conversations saved to git" width="720">
</p>

<p align="center">
  <a href="https://github.com/wasabeef/AgentNote/actions"><img src="https://img.shields.io/github/actions/workflow/status/wasabeef/AgentNote/ci.yml?branch=main" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/agent-note"><img src="https://img.shields.io/npm/v/agent-note" alt="npm"></a>
</p>

<p align="center"><strong>Ketahui <em>mengapa</em> kode berubah, bukan hanya <em>apa</em> yang berubah.</strong></p>

<p align="center">
Agent Note merekam setiap prompt, response, dan AI-attributed file, lalu menautkan context itu ke git commit Anda. Saat agent menyediakan edit history yang cukup, Agent Note dapat mencapai line-level attribution.
</p>

<p align="center">
Anggap saja sebagai <code>git log</code> ditambah AI conversation di balik perubahan.
</p>

<p align="center">
  <a href="https://wasabeef.github.io/AgentNote/id/">Dokumentasi</a>
</p>

<p align="center">
  <img src="docs/assets/dashboard-preview.png" alt="Agent Note dashboard preview" width="1100">
</p>

## Mengapa Agent Note

- Lihat prompt dan response di balik setiap AI-assisted commit.
- Review AI-authored files dan AI ratio langsung di Pull Request.
- Buka shared Dashboard yang mengubah commit history menjadi story yang mudah dibaca.
- Simpan data secara git-native di `refs/notes/agentnote` — tanpa hosted service, tanpa telemetry.

## Persyaratan

- Git
- Node.js 20 atau lebih baru
- Coding agent yang didukung, sudah terpasang dan terautentikasi

## Quick Start

1. Aktifkan Agent Note untuk coding agent Anda.

```bash
npx agent-note init --agent claude
# atau: codex / cursor / gemini
```

Setiap developer harus menjalankannya sekali secara lokal setelah clone.

Anda dapat mengaktifkan lebih dari satu agent dalam repository yang sama:

```bash
npx agent-note init --agent claude cursor
```

Jika juga ingin shared Dashboard di GitHub Pages:

```bash
npx agent-note init --agent claude --dashboard
```

2. Commit file yang dibuat dan push.

```bash
git add .github/workflows/agentnote-pr-report.yml .claude/settings.json
# ganti .claude/settings.json dengan config agent Anda di bawah
# dengan --dashboard, tambahkan juga .github/workflows/agentnote-dashboard.yml
git commit -m "chore: enable agent-note"
git push
```

- Claude Code: commit `.claude/settings.json`
- Codex CLI: commit `.codex/config.toml` dan `.codex/hooks.json`
- Cursor: commit `.cursor/hooks.json`
- Gemini CLI: commit `.gemini/settings.json`

3. Terus gunakan workflow `git commit` normal.

Dengan git hooks yang dibuat, Agent Note merekam commit secara otomatis. Gunakan `agent-note commit -m "..."` hanya sebagai fallback saat git hooks tidak tersedia.

## Data yang disimpan

Agent Note menyimpan cerita commit:

- `prompt` / `response`: percakapan di balik perubahan
- `contexts[]`: petunjuk display-only yang tampil sebagai `📝 Context` saat prompt terlalu pendek

  <img src="website/public/images/context-dashboard-example.png" alt="Agent Note Dashboard showing Context before a short prompt" width="750">

- `files`: file yang berubah dan apakah AI menyentuhnya
- `attribution`: AI ratio, method, dan line counts jika tersedia

Temporary session data berada di `.git/agentnote/`. Permanent record berada di `refs/notes/agentnote` dan dibagikan melalui `git push`.

## Agent Support

| Agent | Status | Attribution | Notes |
| --- | --- | --- | --- |
| Claude Code | Full support | Line-level secara default | Hook-native prompt / response recovery |
| Codex CLI | Preview | File-level secara default | Transcript-driven. Line-level hanya dinaikkan saat count `apply_patch` transcript cocok dengan final commit diff. Jika transcript tidak dapat dibaca, Agent Note melewati pembuatan note alih-alih menulis data yang tidak pasti. |
| Cursor | Supported | File-level secara default | Menggunakan hooks `afterFileEdit` / `afterTabFileEdit`. Line-level hanya dinaikkan saat committed blob masih cocok dengan latest AI edit. |
| Gemini CLI | Preview | File-level | Hook-based capture dengan dukungan `git commit` normal melalui git hooks yang dibuat |

## Periksa setup

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

`agent:` menunjukkan agent adapters yang aktif. `capture:` merangkum apa yang dikumpulkan active agent hooks. `git:` menunjukkan apakah managed repository-local git hooks sudah terpasang. `commit:` memberi tahu primary tracking path: `git commit` normal saat git hooks aktif, atau fallback mode saat sebaiknya memakai `agent-note commit`.

## Yang Anda dapatkan

### Setiap commit punya story

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

```
$ npx agent-note pr --output description --update 42
```

Ini memposting AI session report ke PR description:

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts 🤖, token.ts 🤖 |

<div align="right"><a href="https://OWNER.github.io/REPO/dashboard/">Open Dashboard ↗</a></div>
```

## Cara kerja

```
Anda mengirim prompt ke coding agent
        │
        ▼
hooks menangkap prompt dan session metadata
        │
        ▼
agent mengedit files
        │
        ▼
hooks atau local transcripts mencatat touched files dan attribution signals
        │
        ▼
Anda menjalankan `git commit`
        │
        ▼
Agent Note menulis git note untuk commit itu
        │
        ▼
Anda menjalankan `git push`
        │
        ▼
`refs/notes/agentnote` ikut di-push bersama branch
```

Untuk flow detail, attribution rules, dan schema, lihat [Cara kerja](https://wasabeef.github.io/AgentNote/id/how-it-works/).

## Commands

| Command | Fungsi |
| --- | --- |
| `agent-note init` | Menyiapkan hooks, workflow, git hooks, dan notes auto-fetch |
| `agent-note deinit` | Menghapus hooks dan config untuk agent |
| `agent-note show [commit]` | Menampilkan AI session di balik `HEAD` atau commit SHA |
| `agent-note log [n]` | Mendaftar recent commits dengan AI ratio |
| `agent-note pr [base]` | Membuat PR Report (markdown atau JSON) |
| `agent-note session <id>` | Menampilkan semua commits yang terkait dengan satu session |
| `agent-note commit [args]` | Fallback wrapper untuk `git commit` saat git hooks tidak tersedia |
| `agent-note status` | Menampilkan tracking state |

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

Dashboard Mode memakai action yang sama dengan `dashboard: true`:

```yaml
- uses: wasabeef/AgentNote@v0
  with:
    dashboard: true
```

### Data Dashboard

Untuk sebagian besar repositori, Anda tidak perlu menulis workflow manual. Generate dengan `init`:

```bash
npx agent-note init --agent claude --dashboard
```

Lalu commit `.github/workflows/agentnote-pr-report.yml` dan `.github/workflows/agentnote-dashboard.yml`, aktifkan GitHub Pages dengan source `GitHub Actions`, dan buka `/dashboard/`.

Jika Anda sudah punya GitHub Pages site, lihat [Dashboard docs](https://wasabeef.github.io/AgentNote/id/dashboard/) untuk setup gabungan yang aman.

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

- Agent Note local-first. Core CLI bekerja tanpa hosted service.
- Temporary session data disimpan di `.git/agentnote/` dalam repositori Anda.
- Permanent record disimpan di `refs/notes/agentnote`, bukan di tracked source files.
- Untuk transcript-driven agents, Agent Note membaca local transcript files dari data directory milik agent.
- CLI tidak mengirim telemetry.
- Commit tracking bersifat best-effort. Jika Agent Note gagal saat hook, `git commit` Anda tetap berhasil.

## Design

Zero runtime dependencies · Git notes storage · Never breaks git commit · No telemetry · Agent-agnostic architecture

[Architecture details →](docs/knowledge/DESIGN.md)

## Contributing

[Contributing guide →](CONTRIBUTING.md) · [Code of Conduct →](CODE_OF_CONDUCT.md)

## License

MIT — [LICENSE](LICENSE)
