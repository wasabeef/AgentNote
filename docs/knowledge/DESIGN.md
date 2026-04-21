# agent-note — Design Document

> Remember why your code changed. Minimal tooling, maximum traceability.

## Philosophy

Tools in this space make different tradeoffs. Some center checkpoints, dedicated metadata branches, and web applications. Agent Note intentionally focuses on a narrower goal:

> **Link every git commit to the AI session that produced it.**

AI agents already store transcripts locally. Agent Note captures the right metadata at the right time and attaches it to commits using Git's native mechanisms.

## Repository structure

The repository is a monorepo with three packages plus the docs site:

```
wasabeef/AgentNote/
├── action.yml                      # root pointer → packages/action (for uses: wasabeef/AgentNote@v0)
│
├── packages/
│   ├── cli/                        # agent-note — npm package
│   │   ├── src/
│   │   │   ├── cli.ts              # entry point, command routing
│   │   │   ├── git.ts              # git CLI wrapper
│   │   │   ├── paths.ts            # path resolution
│   │   │   ├── core/               # agent-agnostic logic
│   │   │   │   ├── attribution.ts  # line-level AI attribution (3-diff algorithm)
│   │   │   │   ├── constants.ts    # shared constants (file names, patterns)
│   │   │   │   ├── entry.ts        # build entry JSON, calc ai_ratio
│   │   │   │   ├── jsonl.ts        # JSONL read/append helpers
│   │   │   │   ├── record.ts       # shared recordCommitEntry()
│   │   │   │   ├── rotate.ts       # log rotation after commit
│   │   │   │   └── storage.ts      # git notes read/write
│   │   │   ├── agents/             # one file per agent
│   │   │   │   ├── types.ts        # AgentAdapter interface + NormalizedEvent
│   │   │   │   └── claude.ts       # Claude Code adapter
│   │   │   └── commands/           # user-facing, delegates to agents/ + core/
│   │   │       ├── init.ts
│   │   │       ├── hook.ts
│   │   │       ├── commit.ts
│   │   │       ├── session.ts
│   │   │       ├── show.ts
│   │   │       ├── log.ts
│   │   │       ├── pr.ts
│   │   │       └── status.ts
│   │   ├── package.json            # name: agent-note
│   │   └── tsconfig.json
│   │
│   └── action/                     # GitHub Action (Marketplace)
│       ├── action.yml              # action definition (inputs/outputs)
│       ├── src/
│       │   └── index.ts            # calls CLI, sets outputs, posts to PR description/comment
│       ├── dist/
│       │   └── index.js            # ncc-bundled (committed, no node_modules needed)
│       └── package.json            # name: agent-note-action (private, not published)
│   │
│   └── dashboard/                  # optional static dashboard package
│       ├── src/pages/index.astro   # dashboard shell + build-time note index
│       ├── public/notes/           # synced dashboard note JSON during build/deploy
│       └── package.json
│
├── website/                        # Starlight docs site
│
├── docs/
│   └── knowledge/
│
├── .github/
│   └── workflows/
│       ├── ci.yml                  # lint + test + build for CLI
│       └── release.yml             # npm publish + action tag update
│
├── README.md
├── LICENSE
└── CLAUDE.md
```

### Why monorepo

The action calls `agent-note pr --json` — it's tightly coupled to the CLI's output format. Keeping both in one repo means:

- A single PR can change CLI output + action parsing in lockstep
- The static dashboard can reuse the same note schema without a second data contract
- No cross-repo version coordination
- Shared CI

### Dashboard deploy model

The dashboard package is a static Astro app. `packages/dashboard/public/notes/` is only the build input inside the workspace; generated note JSON is not committed to `main`.

For the live site, the Pages workflow treats `gh-pages/dashboard/notes/*.json` as the durable store:

- restore those files into `packages/dashboard/public/notes/`
- on `pull_request` (`opened`, `reopened`, `synchronize`), rewrite the current PR's note set and persist it back to `gh-pages`
- on `push` to `main`, rebuild the dashboard (and optionally the docs site), persist merged note state, and deploy the public site

A brand-new repo can therefore accumulate dashboard note data before the first production deploy, but the public Pages URL only appears after the first `main` deployment.

### Root action.yml trick

GitHub resolves `uses: wasabeef/AgentNote@v0` by looking for `action.yml` at the repo root. The root file is a 3-line pointer to the real implementation:

```yaml
# action.yml (root)
name: "Agent Note PR Report"
description: "AI session tracking report for pull requests"
runs:
  using: "node24"
  main: "packages/action/dist/index.js"
```

This gives users `uses: wasabeef/AgentNote@v0` while code lives in `packages/action/`.

## Architecture

### Two execution paths

1. **CLI** (`packages/cli/`) — `agent-note init`, `agent-note show`, `agent-note log`, `agent-note pr`. Run by users and CI.
2. **Hook handler** — `agent-note hook`, called by agent-specific hooks via stdin JSON (`--agent claude` or `--agent codex`). All data collection.

### Data flow

```
         AI Agent hooks                          Git hooks
               │                                     │
   ┌───────────┼───────────┐             ┌───────────┼───────────┐
   │           │           │             │                       │
SessionStart  User     PostToolUse   prepare-commit-msg     post-commit
Stop        Prompt    (Edit/Write)        │                       │
   │        Submit        │               ▼                       ▼
   ▼           ▼          ▼         inject --trailer       record entry
.git/agentnote/ prompts  changes    (reads session file)   to git notes
session       .jsonl     .jsonl
```

AI agent hooks handle data **collection** (prompts, file changes, session lifecycle, transcript references). Git hooks handle commit **integration** (trailer injection, note recording). For Claude Code, Codex, Cursor, and Gemini CLI, this means plain `git commit` works when the repo-local git hooks are installed. Cursor preview also recovers prompt / response pairs from Cursor response hooks or local transcripts, and its shell hooks provide a fallback path when git hooks are unavailable.

### Storage: two layers

**Layer 1 — Local temp (`.git/agentnote/sessions/`)**

Append-only JSONL files, accumulated during a session, rotated after each commit. Never pushed. Crash-safe — if the process dies, only the last line might be incomplete.

```
.git/agentnote/
├── session                          # active session ID (single line)
└── sessions/<session-id>/
    ├── prompts.jsonl                # one prompt per line (current turn)
    ├── changes.jsonl                # files touched by AI, with post-edit blob hash (current turn)
    ├── pre_blobs.jsonl              # file blob hashes captured before each AI edit (current turn)
    ├── events.jsonl                 # session lifecycle
    ├── heartbeat                    # epoch-ms timestamp of last activity (for TTL cleanup)
    ├── transcript_path              # path to agent's transcript file
    ├── turn                         # monotonic turn counter (incremented on UserPromptSubmit)
    ├── prompts-<id>.jsonl           # archived at next turn boundary (Base36 rotation ID)
    ├── changes-<id>.jsonl           # archived at next turn boundary
    └── pre_blobs-<id>.jsonl         # archived at next turn boundary
```

**Layer 2 — Git notes (`refs/notes/agentnote`)**

The permanent record. One JSON note per commit, written at commit time. Pushable, fetchable, shareable with the team.

```bash
git notes --ref=agentnote add -f -m '<json>' HEAD   # write
git notes --ref=agentnote show <commit>              # read
git push origin refs/notes/agentnote                 # share
git fetch origin refs/notes/agentnote:refs/notes/agentnote  # fetch
```

Note content per commit:

```json
{
  "v": 1,
  "session_id": "a1b2c3d4-...",
  "timestamp": "2026-04-02T10:30:00Z",
  "model": "claude-sonnet-4-20250514",
  "interactions": [
    {
      "prompt": "Implement JWT auth middleware",
      "response": "I'll create the middleware with... ",
      "files_touched": ["src/auth.ts"],
      "tools": ["Edit"]
    }
  ],
  "files": [
    { "path": "src/auth.ts", "by_ai": true },
    { "path": "CHANGELOG.md", "by_ai": false }
  ],
  "attribution": {
    "ai_ratio": 73,
    "method": "line",
    "lines": {
      "ai_added": 146,
      "total_added": 200,
      "deleted": 12
    }
  }
}
```

- **`v`**: Schema version. Currently `1`.
- **`model`**: LLM model identifier from SessionStart. `null` for agents that don't expose it.
- **`files`**: Array of `{path, by_ai}`. `by_ai` is true if any AI tool (Edit/Write) targeted the file.
- **`attribution`**: AI authorship metrics.
  - **`ai_ratio`**: 0–100 (rounded). Line-level when `method: "line"`, file-count when `method: "file"`, 0 when `method: "none"` (deletion-only).
  - **`method`**: `"line"` (blob-based 3-diff), `"file"` (binary file-count), or `"none"` (deletion-only, no valid ratio).
  - **`lines`**: Present when blob data available. `ai_added`, `total_added`, `deleted`.
- **`interactions[].tools`**: File-edit tools used in this interaction. Optional field — omitted when no tool data is available, `null` when adapter doesn't support tool tracking, `string[]` when tools were observed.
- **`interactions[].response`**: Full AI response text. No truncation.

### Causal turn ID

Each `UserPromptSubmit` event increments a monotonic turn counter stored in `.git/agentnote/sessions/<id>/turn`. Every file change recorded via `PostToolUse` (Edit/Write) inherits the current turn number.

At commit time, `recordCommitEntry()` uses turn numbers to scope attribution:

1. Find all turns that touched files in this specific commit (`commitFileSet`) — these are the **edit-linked turns**.
2. Attach `files_touched` per interaction using the same turn grouping — non-edit-linked prompts get no `files_touched`.
3. Compute line-level attribution only from edit-linked turns (see Line-level attribution).

Prompt selection is a separate concern — see **Prompt selection for notes** below.

This avoids timestamp-based attribution, which is unreliable when hooks fire asynchronously.

Fallback: if no turn data is present (entries recorded before turn tracking was introduced), all prompts and changes are used without filtering (v1 compat).

### Prompt selection for notes

A commit note records a list of `interactions` (prompt + response + `files_touched` + tools). Which prompts belong in that list is a separate question from which turns produce line-level attribution.

**Current: causal window.** Agent Note keeps the prompt list centered on the turns that actually survive into the final commit, then expands just enough to preserve nearby planning / follow-up context.

**Step 1 — derive primary turns.**

- **Session-driven agents** (`Claude`, `Gemini`, partial `Cursor`): use line-level attribution when blob data is available. Turns that still own added lines in the final diff become the primary turns. If line-level attribution is unavailable, fall back to the commit's edit-linked turns.
- **Transcript-driven agents** (`Codex`): use transcript `files_touched` + `line_stats`. Agent Note searches backward for the smallest suffix of transcript edits whose cumulative line counts match the committed diff. Those turns become the primary turns. If an exact suffix cannot be proven, fall back to transcript turns that touched the commit's files.

**Step 2 — expand to a causal prompt window.**

- Find the nearest earlier edit turn that is **not** primary.
- Find the nearest later edit turn that is **not** primary.
- Include prompts between those two boundaries.
- Within that block, prompts from turns already consumed by earlier commits stay out unless the turn itself is primary.

This keeps nearby prompt-only context such as planning, clarification, or commit / conflict follow-up, but drops older overwritten edit bursts that no longer explain the final diff.

**Split-commit semantics are preserved.**

- Each commit records consumed `(turn, file)` pairs and prompt ids in `committed_pairs.jsonl`.
- `maxConsumedTurn` trims spent context from later commits in the same session.
- A turn that is primary for the current commit is still allowed through even if an earlier split commit already consumed the same turn.

**Trade-off:** the causal window is intentionally narrower than the old full-session window, but it can still include prompt-only turns near the active edit block. This is deliberate: the goal is "causal conversation", not "edit-only prompts".

### Line-level AI attribution

`ai_ratio` is computed at the line (added-line) level using a 3-diff position algorithm when blob data is available.

**Data captured by hooks:**

- **`PreToolUse Edit/Write/NotebookEdit`** (synchronous) → `git hash-object -w <file>` before the edit → stored as `preBlob` in `pre_blobs.jsonl`
- **`PostToolUse Edit/Write/NotebookEdit`** (asynchronous) → `git hash-object -w <file>` after the edit → stored as `postBlob` in `changes.jsonl`

**Attribution algorithm per file (at commit time):**

For each file in the commit, collect all `(preBlob, postBlob)` pairs from the session (FIFO per file). Then run 3 diffs, all targeting the committed blob:

```
diff1: parentBlob → committedBlob   → positions of all added lines in the commit
diff2: preBlob_T  → committedBlob   → AI's edit + any human edits after
diff3: postBlob_T → committedBlob   → human edits after AI (only)

AI positions for turn T = diff2 ∩ diff1 positions \ diff3 positions
```

Union AI positions across all turns. Count how many positions from `diff1` are in the AI union — this gives `attribution.lines.ai_added`. Positions are 1-based line numbers in the committed file, so they are directly comparable across all three diffs.

**Key properties:**

- Deletions are excluded from `attribution.ai_ratio` (old-side positions are not comparable to new-side positions). Tracked separately as `attribution.lines.deleted`.
- Human edits after the AI write are correctly subtracted from AI attribution.
- New files created by AI (no preBlob) attribute all added lines to AI.
- Falls back to file-level binary attribution if blob data is unavailable (old sessions, failed hooks).

**Object store:** Blob hashes are written to the git object store via `git hash-object -w` during hooks. Loose objects are cleaned up by `git gc` over time. The canonical empty blob (`e69de29...`) is written once per commit in `recordCommitEntry` to support new-file diffs.

### Cross-turn commits and split commit support

**Cross-turn scenario**: AI edits files in turn N, then the user confirms ("y") in turn N+1, triggering the commit. By turn N+1, `UserPromptSubmit` has already rotated `changes.jsonl` → `changes-<sha>.jsonl`. `recordCommitEntry()` reads both the current file and all `stem-*.jsonl` archives so nothing is lost.

**Split commit scenario**: Multiple `git commit` calls in the same turn (e.g. `/commit` splitting into several semantic commits). Rotated archives are **not** deleted at commit time — they remain available for each commit in the turn. Each commit scopes its own data via `commitFileSet` to avoid double-counting.

Archives are purged at the **start of the next `UserPromptSubmit`** (turn boundary) by `rotateLogs()`, which renames the current files into new archives and leaves previous archives in place until the next turn rotation.

### Why git notes over alternatives

| Approach | Branch pollution | GitHub banner | CI impact | Push/share | Survives clone |
|---|---|---|---|---|---|
| `.git/agentnote/` files | None | None | None | **No** | **No** |
| Orphan branch | Shows in `git branch` | "Compare & PR" every push | Possible | Yes | Yes |
| **Git notes** | **None** | **None** | **None** | **Yes** | Yes (explicit fetch) |
| Repo files (`.agentnote/`) | None | None | None | Yes | Yes, but pollutes diff |

Git notes are invisible to branch listings, GitHub UI, and CI — but still pushable and fetchable.

### Commit trailer

Every commit made during an AI session gets a trailer:

```
feat: add auth middleware

Agentnote-Session: a1b2c3d4-5678-90ab-cdef-111122223333
```

Injected via two parallel paths:
1. **Git hook** (`prepare-commit-msg`): reads session ID from `.git/agentnote/session` and appends trailer to the commit message file.
2. **Agent hook** (`PreToolUse Bash(*git commit*)`): Claude Code's hook rewrites the git commit command to inject `--trailer` directly.

Both paths are redundant by design — if git hooks are not installed (e.g., first clone before `agent-note init`), the agent hook still injects the trailer.

### Git hooks for commit integration

Three git hooks handle commit integration and notes sharing:

| Git hook | When | What it does |
|---|---|---|
| `prepare-commit-msg` | Before commit message editor opens | Checks session freshness via heartbeat, appends `Agentnote-Session` trailer. Skips amend/reuse (`$2=commit`). |
| `post-commit` | After commit succeeds | Reads session ID from the finalized trailer on HEAD, calls `agent-note record <session-id>` to write git note. Idempotent — skips if note already exists. |
| `pre-push` | Before push to remote | Auto-pushes `refs/notes/agentnote` to the actual remote (`$1`) in background. Recursion-guarded via `AGENTNOTE_PUSHING` env var. |

Session freshness is verified via per-session heartbeat file (`sessions/<id>/heartbeat`). Heartbeat is updated on `SessionStart` and `UserPromptSubmit`. `Stop` does NOT invalidate the heartbeat — it fires when the AI finishes responding, not when the session ends. Missing heartbeat in git hooks = skip (fail closed).

### Git hook installation

`agent-note init` installs git hooks respecting the repository's hook directory:

```bash
# Determine hook directory
HOOK_DIR=$(git config get core.hooksPath || echo ".git/hooks")
```

If `core.hooksPath` is set (e.g., by husky, lefthook, or custom configuration), hooks are installed there instead of `.git/hooks/`. This ensures compatibility with any hook manager.

When an existing hook file is found, agent-note chains to it — the original hook runs first, then agent-note's logic runs. This avoids overwriting user or tool-managed hooks.

## CLI commands

```
agent-note init              add hooks to agent config (commit to share with team)

agent-note commit [args]       git commit with session context (convenience wrapper)
agent-note show [commit]       show session details for HEAD or a commit SHA
agent-note log [n]             list recent commits with session info
agent-note pr [base] [--json] [--output description|comment] [--update <PR#>]
agent-note status              show current tracking state
agent-note hook                handle agent hook events (internal, via stdin, agent-specific)
agent-note record <session-id> record git note for HEAD (internal, used by post-commit hook)
```

### init model

`agent-note init` does four things by default:

1. **Agent config** — writes data collection hooks to the active agent config (`.claude/settings.json`, `.codex/config.toml` + `.codex/hooks.json`, `.cursor/hooks.json`, or `.gemini/settings.json`). Commit the generated repo-local files to share with the team.
2. **Git hooks** — installs `prepare-commit-msg`, `post-commit`, and `pre-push` hooks (respects `core.hooksPath`). Local to `.git/` — must be installed per clone.
3. **GitHub Actions workflow** — creates `.github/workflows/agentnote.yml` for PR reports. Commit this file.
4. **Auto-fetch config** — adds `refs/notes/agentnote` to `remote.origin.fetch` so `git pull` fetches notes automatically.

Flags: `--no-hooks`, `--no-git-hooks`, `--no-action`, `--no-notes`, `--hooks`, `--action`.

### PR report

`agent-note pr` produces markdown or structured JSON reports.

```bash
agent-note pr                              # markdown report (table format)
agent-note pr --json                       # structured JSON (for scripts/actions)
agent-note pr --output description --update 42  # upsert into PR description
agent-note pr --output comment --update 42      # post as PR comment
```

Output: table format with summary header, per-commit rows, and collapsible prompts/responses section.

```
## 🧑💬🤖 Agent Note

**AI ratio: 73%** ████████
`45/75 lines` · `4/5 commits` · `8 prompts` · `claude-sonnet-4-20250514`
```

Commit hashes are linked to the GitHub commit page. Prompts/responses are in a collapsible `<details>` section.

Prompt display: first meaningful line only (120 chars). Skill-generated expansions (`/commit`, `/plan`) are filtered to show the user's original input.

JSON output structure:

```json
{
  "overall_ai_ratio": 73,
  "overall_method": "line",
  "model": "claude-sonnet-4-20250514",
  "total_commits": 5,
  "tracked_commits": 4,
  "total_prompts": 8,
  "commits": [
    {
      "sha": "...",
      "short": "dd4f971",
      "message": "feat: add Button",
      "model": "claude-sonnet-4-20250514",
      "ai_ratio": 100,
      "attribution": { "ai_ratio": 100, "method": "line", "lines": { "ai_added": 32, "total_added": 32, "deleted": 0 } },
      "files": [{"path": "button.tsx", "by_ai": true}],
      "interactions": [{"prompt": "...", "response": "...", "tools": ["Write"]}]
    }
  ]
}
```

## GitHub Action

### Usage

```yaml
- uses: wasabeef/AgentNote@v0
  id: agent-note
  with:
    base: main

# Use structured outputs
- run: echo "AI ratio: ${{ steps.agent-note.outputs.overall_ai_ratio }}%"
```

### Action inputs

| Input | Default | Description |
|---|---|---|
| `base` | PR base branch | Base branch to compare against |
| `output` | `description` | Report destination: `description` or `comment` |
| `comment` | `"true"` | Legacy: set to `"false"` to disable posting |

### Action outputs

| Output | Type | Description |
|---|---|---|
| `overall_ai_ratio` | number | PR-wide AI ratio (0-100) |
| `overall_method` | string | Attribution method: `line`, `file`, `mixed`, `none` |
| `tracked_commits` | number | Commits with agent-note data |
| `total_commits` | number | Total commits in PR |
| `total_prompts` | number | Total prompts across all commits |
| `json` | string | Full structured report (use with `fromJSON()`) |
| `markdown` | string | Rendered markdown report |

### Action internals

The action:

1. `git fetch origin refs/notes/agentnote:refs/notes/agentnote`
2. `agent-note pr --json` → parse outputs
3. `agent-note pr` → markdown
4. Set GitHub Actions outputs
5. Post report to PR description (upsert between markers) or as a comment

Dependencies (`@actions/core`, `@actions/github`) are bundled with `ncc` into a single `dist/index.js` that is committed to the repo. No `npm install` needed at runtime.

## Distribution

```
CLI:    npx agent-note init          (or npm install --save-dev)
Action: uses: wasabeef/AgentNote@v0             (Marketplace)
```

### Release procedure

`release.yml` is triggered by pushing a tag that matches `v*.*.*`. It does **not** rewrite package versions from the tag name. The npm publish job publishes whatever version is already committed in `packages/cli/package.json`.

Release steps:

1. Update the CLI package version in `packages/cli/package.json`.
2. Keep the workspace lockfile in sync. At minimum, update the `packages/cli` entry in `package-lock.json` so the committed workspace metadata matches the published package version.
3. Run the release checks locally:
   - `npm -w packages/cli run build`
   - `npm -w packages/cli test`
4. Commit the version bump to `main`.
5. Create and push the matching git tag, for example `v0.1.11`.

Important:

- Do **not** cut a release tag before the package version bump lands on `main`.
- If `packages/cli/package.json` still says `0.1.9` and you push `v0.1.10`, the workflow will still try to publish `0.1.9` and npm will reject it as an already published version.
- The workflow updates the floating major tag (`v0`) after the GitHub release is created, but it does not manage package.json versions for you.

### Team workflow

```bash
# 1. Enable agent-note (one person, once)
npx agent-note init
git add .claude/settings.json .github/workflows/agentnote.yml
git commit -m "chore: enable agent-note"
git push

# Codex repositories commit `.codex/config.toml` + `.codex/hooks.json` instead.
# Cursor repositories commit `.cursor/hooks.json` instead.
# Plain `git commit` works when the generated git hooks are installed.
# `agent-note commit -m "..."` remains a useful fallback wrapper.

# 2. New clone setup (per developer, per clone)
git clone <repo> && cd <repo>
npx agent-note init   # installs git hooks + agent config + auto-fetch

# 3. Everyone works normally
# hooks fire automatically — trailer injected, note recorded, notes auto-pushed on push
```

Notes are automatically pushed to the remote via the `pre-push` git hook installed by `agent-note init`. No manual `git push origin refs/notes/agentnote` is needed.

## Constraints

- **Zero runtime dependencies for CLI.** Only devDependencies. The action has its own deps (`@actions/core`, `@actions/github`), bundled with ncc.
- **Git CLI only.** All git operations via `execFile("git", ...)`. No git libraries.
- **Never break git commit.** All recording wrapped in try/catch. Errors are logged to stderr, never block the commit.
- **All source in English.** Comments, output, tests.
- **Git hooks for commit ops.** Trailer injection (`prepare-commit-msg`) and note recording (`post-commit`) use git hooks, not agent hooks. Respects `core.hooksPath` and chains with existing hooks.
- **No telemetry, no auth, no external services.** Data stays local until pushed. The `pre-push` git hook (installed by `agent-note init`) auto-pushes notes alongside code on every `git push`.
- **Input validation.** Session IDs must match `/^[0-9a-f-]{36}$/` (UUID v4). `transcript_path` must be under `~/.claude/` (or agent equivalent). Reject anything else silently.
- **Full response storage.** AI responses are stored in full. Git notes blobs are compressed and well within GitHub limits.

## Security

### Threat model

Agent Note records prompts and AI responses. This data may contain sensitive information:

- API keys, tokens, or credentials mentioned in prompts
- Internal business logic or proprietary algorithms
- PII (personally identifiable information)
- Vulnerability details in AI analysis responses

### Mitigations

| Threat | Mitigation |
|---|---|
| Secrets in prompts/responses | **Not automatically redacted.** Users are responsible for not pushing notes to public repos. Future: optional secret detection before note creation. |
| Command injection via session ID | Session ID validated as UUID v4 before trailer injection. Non-matching IDs are silently dropped. |
| Transcript path traversal | `transcript_path` must be under `~/.claude/` (or agent equivalent). Paths outside are rejected. |
| git notes tampering | Anyone with repo write access can modify or delete notes. Notes are **not signed or encrypted**. Treat them as advisory, not as audit trail. |
| GitHub Action markdown injection | PR report embeds raw prompts/responses in markdown. **Sanitization is not yet implemented.** Untrusted prompts could inject markdown/HTML into PR descriptions. |
| `npx --yes` supply chain | Claude Code agent hooks use `npx --yes agent-note hook`. Git hooks (installed by `init`) prefer local binary (`node_modules/.bin/agent-note`), falling back to PATH. |
| Fork PR attacks | The GitHub Action should not run on `pull_request_target` with fork PRs. Default trigger is `pull_request` which is safe. |

### Recommendations for users

- **Be aware that `agent-note init` installs a `pre-push` hook that auto-pushes notes** on every `git push`. On public repositories, this means prompts and AI responses will be visible. Use `--no-git-hooks` to skip git hook installation if this is a concern.
- Use `agent-note pr --json | jq '.commits[].interactions[].prompt'` to review what will be shared.
- Consider `agent-note init --no-responses` (future) to record prompts only, without AI responses.

## Known limitations

### git notes and rebase

When commits are rebased (interactive rebase, squash, fixup), their SHA changes. Git notes are keyed by SHA, so **notes become orphaned** after rebase.

Mitigation: configure git to copy notes on rewrite:

```bash
git config notes.rewriteRef refs/notes/agentnote
git config notes.rewrite.rebase true
git config notes.rewrite.amend true
```

`agent-note init` should set these automatically (planned).

### Squash merge

GitHub's "Squash and merge" creates a new commit with a new SHA. All notes from the individual PR commits are lost on the merge commit. The PR report is only meaningful **before merge**.

Workaround: the GitHub Action posts the report to the PR description (or comment) before merge, preserving the data in the PR.

### Clone does not include notes

`git clone` does not fetch notes by default. Team members must explicitly fetch:

```bash
git fetch origin refs/notes/agentnote:refs/notes/agentnote
```

Or configure automatic fetch:

```bash
git config --add remote.origin.fetch '+refs/notes/agentnote:refs/notes/agentnote'
```

### Push conflicts

If multiple developers push notes simultaneously, non-fast-forward pushes are rejected. Resolve with:

```bash
git fetch origin refs/notes/agentnote:refs/notes/agentnote
git notes --ref=agentnote merge origin/notes/agentnote
git push origin refs/notes/agentnote
```

In practice, notes conflicts are rare because each developer writes to different commit SHAs.

### Concurrent sessions

If multiple Claude Code sessions run in the same repo simultaneously, `.git/agentnote/session` (the active session pointer) may be overwritten by the last writer. Session-specific data in `.git/agentnote/sessions/<id>/` is isolated and safe. Since `prepare-commit-msg` reads the session ID from the file, a concurrent overwrite could attach the wrong session ID to a trailer. In practice this is rare — concurrent commits from the same repo are uncommon.

### ai_ratio accuracy depends on blob data

`ai_ratio` uses line-level attribution when `pre_blobs.jsonl` data is available (sessions recorded with hook v2+). Cursor preview can also upgrade to line-level when `afterFileEdit` / `afterTabFileEdit` edit counts match and the final committed blob still matches the last AI edit for an AI-touched file. For older sessions or when those signals are unavailable, it falls back to file-count ratio. Deletions are always excluded from the attribution denominator — only added lines are classified as AI or human.

Agent Note excludes common generated artifacts from the AI ratio denominator on a best-effort basis for both line-level and file-level attribution. The heuristic combines:

- well-known generated paths such as `dist/`, `build/`, `.dart_tool/`, `target/`, `.next/`, `bazel-out/`
- common generated suffixes such as `.generated.ts`, `.g.dart`, `.pb.go`, `.pb.rs`, `.generated.swift`, `.generated.kt`
- committed file names such as `GeneratedPluginRegistrant.swift` and `generated_plugin_registrant.dart`
- committed file headers that contain markers like `Code generated ... DO NOT EDIT`, `Generated by SwiftGen`, `@generated`, or `automatically generated by rust-bindgen`

Generated files still appear in the note's `files[]` list, but they do not drag the file-level `ai_ratio` toward human attribution.

## Multi-agent extensibility

Agent Note supports Claude Code, Codex CLI, Cursor preview, and Gemini CLI preview today, and the `agents/` + `core/` split makes adding more agents straightforward.

### What varies per agent

| Concern | Claude Code | Codex CLI | Cursor | Gemini CLI |
|---|---|---|---|---|
| Config files | `.claude/settings.json` | `.codex/config.toml` + `.codex/hooks.json` | `.cursor/hooks.json` | `.gemini/settings.json` |
| Hook events | `SessionStart`, `Stop`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit` | `SessionStart`, `UserPromptSubmit`, `Stop` | `beforeSubmitPrompt`, `afterAgentResponse`, `afterFileEdit`, `afterTabFileEdit`, `beforeShellExecution`, `afterShellExecution`, `stop` | `SessionStart`, `SessionEnd`, `BeforeAgent`, `AfterAgent`, `BeforeTool`, `AfterTool` |
| Transcript location | `~/.claude/projects/<hash>/sessions/<uuid>.jsonl` | `~/.codex/sessions/.../*.jsonl` | `~/.cursor/projects/<project>/agent-transcripts/...` when available | `~/.gemini/tmp/<project_hash>/chats/*.jsonl` |
| Attribution strategy | Hook-captured blob pairs + transcript | Transcript-driven, with safe line-level upgrade when patch counts match | `afterFileEdit` / `afterTabFileEdit`-driven attribution, with safe line-level upgrade when the committed blob still matches the AI edit, plus response recovery from hooks / transcripts | `BeforeTool`/`AfterTool`-driven file-level attribution via `write_file` and `replace` hooks |
| Commit detection | **Git hooks** (agent-agnostic) | **Git hooks** (agent-agnostic) | **Git hooks** by default, plus `beforeShellExecution` / `afterShellExecution` fallback in preview | **Git hooks** (agent-agnostic), pending-commit pattern via `BeforeTool`/`AfterTool` on `run_shell_command` |

### What stays the same (`core/` + git hooks)

- Git notes storage (`refs/notes/agentnote`)
- Entry data structure (interactions, files, attribution)
- JSONL append and rotation
- Display commands (show, log, pr, status)
- Commit trailer (`Agentnote-Session`) — injected by `prepare-commit-msg` git hook
- Note recording — handled by `post-commit` git hook
- GitHub Action (agent-agnostic — reads git notes)

Commit integration is fully agent-agnostic. Adding a new agent only requires implementing its collection path and transcript parser — git hooks handle the rest.

### AgentAdapter interface

```typescript
// packages/cli/src/agents/types.ts

interface HookInput {
  raw: string;       // stdin JSON from the agent
  sync: boolean;     // true for PreToolUse (must write to stdout), false for async hooks
}

interface NormalizedEvent {
  kind: "session_start" | "stop" | "response" | "prompt" | "pre_edit" | "file_change" | "pre_commit" | "post_commit";
  sessionId: string;
  timestamp: string;
  prompt?: string;
  response?: string;
  file?: string;
  tool?: string;
  toolUseId?: string;
  commitCommand?: string;
  transcriptPath?: string;
  model?: string;
}
// "pre_edit": fired by PreToolUse Edit/Write/NotebookEdit — captures preBlob before the edit.
// "pre_commit" and "post_commit": Claude Code PreToolUse/PostToolUse for git commit commands.

interface AgentAdapter {
  name: string;
  settingsRelPath: string;

  /** Add agent-note hooks. Idempotent — safe to call multiple times. Replaces legacy formats. */
  installHooks(repoRoot: string): Promise<void>;

  /** Remove agent-note hooks. Idempotent — no-op if not installed. Removes both current and legacy formats. */
  removeHooks(repoRoot: string): Promise<void>;

  /** Check if current-format hooks are installed. Returns false for legacy-only installs. */
  isEnabled(repoRoot: string): Promise<boolean>;

  /** Parse raw hook input into a normalized event. Returns null for unrecognized events. */
  parseEvent(input: HookInput): NormalizedEvent | null;

  /** Find the local transcript file for a session. Returns null if not available. Path must be under the agent's data directory. */
  findTranscript(sessionId: string): string | null;

  /** Extract prompt-response pairs from the agent's transcript format. */
  extractInteractions(transcriptPath: string): Promise<Array<{prompt: string; response: string | null}>>;
}
```

### Adding a new agent

1. Create `packages/cli/src/agents/<agent-name>.ts` implementing `AgentAdapter`
2. Register it in `agents/index.ts`
3. `agent-note init --agent <name>` calls `adapter.installHooks()`
4. `agent-note hook` is dispatched by `--agent <name>`; bare `agent-note hook` is retained only for legacy Claude compatibility and now fails fast for Codex payloads
5. All core logic and the GitHub Action work unchanged

## entire.io comparison

| Aspect | entire.io | agent-note |
|---|---|---|
| Setup | CLI install + `entire enable` + login | `npx agent-note init` + commit settings |
| Storage | Orphan branch `entire/checkpoints/v1` | **Git notes** `refs/notes/agentnote` |
| Branch pollution | Shadow branches + checkpoint branch | **None** |
| Transcript | Full copy per checkpoint (O(n²) bloat) | **Reference only** (pointer in note) |
| Git hooks | Overwrites `.git/hooks/` | **Git hooks + agent hooks** (git hooks for commit ops, agent hooks for data collection; respects `core.hooksPath`, chains with existing hooks) |
| CI impact | `entire@local` author breaks Vercel | **None** |
| GitHub UI | "Compare & PR" banner on every push | **None** (notes are invisible) |
| Dependencies | go-git, gitleaks, PostHog, entire.io auth | **Zero** (CLI), ncc-bundled (action) |
| Performance | Sync hooks, 2min 44s commit | **Async agent hooks** + lightweight git hooks |
| Team sharing | Auto-push checkpoint branch | **Explicit** `git push origin refs/notes/agentnote` |
| PR integration | None built-in | **GitHub Action** with structured outputs |
