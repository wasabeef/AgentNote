# Agent Note Architecture

> Remember why your code changed. Minimal tooling, maximum traceability.

## Philosophy

Tools in this space make different tradeoffs. Some center checkpoints, dedicated metadata branches, and web applications. Agent Note intentionally focuses on a narrower goal:

> **Link every git commit to the AI session that produced it.**

AI agents already store transcripts locally. Agent Note captures the right metadata at the right time and attaches it to commits using Git's native mechanisms.

## Repository structure

The repository is a monorepo with three packages plus the docs site:

```
wasabeef/AgentNote/
├── action.yml                      # public Action dispatcher for PR Report and Dashboard
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
│   │   │   │   ├── interaction-context.ts # display-only context selector
│   │   │   │   ├── jsonl.ts        # JSONL read/append helpers
│   │   │   │   ├── prompt-window.ts # prompt-window policy and selection evidence
│   │   │   │   ├── record.ts       # shared recordCommitEntry()
│   │   │   │   ├── rotate.ts       # log rotation after commit
│   │   │   │   ├── session.ts      # per-session agent/transcript metadata
│   │   │   │   └── storage.ts      # git notes read/write
│   │   │   ├── agents/             # one file per agent
│   │   │   │   ├── index.ts        # agent registry
│   │   │   │   ├── types.ts        # AgentAdapter interface + NormalizedEvent
│   │   │   │   ├── claude.ts       # Claude Code adapter
│   │   │   │   ├── codex.ts        # Codex CLI adapter
│   │   │   │   ├── cursor.ts       # Cursor adapter
│   │   │   │   └── gemini.ts       # Gemini CLI adapter
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
│   ├── pr-report/                  # PR Report library used by the root Action
│   │   ├── src/
│   │   │   └── index.ts            # collects notes, sets outputs, posts to PR description/comment
│   │   ├── dist/
│   │   │   └── index.js            # ncc-bundled (committed, no node_modules needed)
│   │   └── package.json            # name: agent-note-pr-report (private, not published)
│
│   └── dashboard/                  # optional static dashboard package
│       ├── workflow/               # Dashboard restore/sync/build/persist scripts
│       ├── src/pages/index.astro   # dashboard shell + build-time note index
│       ├── public/notes/           # synced dashboard note JSON during build/deploy
│       └── package.json
│
├── website/                        # Starlight docs site
│
├── docs/
│   ├── engineering.md             # implementation guidelines for humans and AI agents
│   ├── architecture.md            # this canonical architecture reference
│   ├── assets/                    # README and website images
│   └── knowledge/                 # focused design notes, research, and archive
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

### Knowledge map

`docs/architecture.md` is the canonical architecture reference. Keep current implementation details here first.

Other knowledge files are narrower design or research records:

- `engineering.md` — implementation guidelines for constants, comments, Dashboard workflow safety, and verification.
- `knowledge/prompt-context.md` — deterministic `interactions[].contexts[]` selection and display rules.
- `knowledge/prompt-selection.md` — prompt selection evidence, scoring, tail handling, and display-density design.
- `knowledge/agent-support-policy.md` — support-tier gates for promoting agent adapters.
- `knowledge/investigations.md` — resolved regression investigations and follow-up notes.
- `knowledge/research/` — product and architecture research that still informs current decisions.
- `knowledge/archive/` — historical implementation plans and older research. Treat these as context, not current behavior.

### Why monorepo

The PR Report action reads the same git note schema that the CLI writes and the dashboard renders. Keeping them in one repo means:

- A single PR can change note schema, PR Report rendering, and Dashboard rendering in lockstep
- The static dashboard can reuse the same note schema without a second data contract
- No cross-repo version coordination
- Shared CI

### Dashboard deploy model

The dashboard package is a static Astro app. `packages/dashboard/public/notes/` is only the build input inside the workspace; generated note JSON is not committed to `main`.

For the live site, the generated Pages workflow calls `wasabeef/AgentNote@v1` with `dashboard: true`. The root Action delegates restore, sync, build, artifact upload, and note persistence to `packages/dashboard`. If the caller workflow already contains an `actions/upload-pages-artifact` step in the same job, Dashboard Mode auto-detects that artifact path and writes the built app under its `dashboard/` directory instead of uploading a standalone artifact. If another job or another workflow already owns Pages publishing, Dashboard Mode skips standalone publishing to avoid overwriting the existing site. This lets repositories with an existing docs site keep one combined Pages artifact without adding another input. It treats `gh-pages/dashboard/notes/*.json` as the durable store:

- restore those files into `packages/dashboard/public/notes/`
- on `pull_request` (`opened`, `reopened`, `synchronize`), rewrite the current PR's note set and persist it back to `gh-pages`
- on `push` to the default branch, rebuild the dashboard, persist merged note state, and deploy the public site

A brand-new Repository can therefore accumulate Dashboard note data before the Dashboard is published for the first time. If Pull Request Deploys are allowed, the shared Pages URL can appear after the first successful `pull_request` run. Otherwise it appears after the first successful deploy from `default branch`.

### Root action.yml dispatcher

GitHub resolves `uses: wasabeef/AgentNote@v1` by looking for `action.yml` at the repo root. The root file is the public facade:

```yaml
# PR Report Mode
- uses: wasabeef/AgentNote@v1

# Dashboard Mode
- uses: wasabeef/AgentNote@v1
  with:
    dashboard: true
```

The implementation stays split by responsibility: `packages/pr-report` owns PR body/comment rendering, while `packages/dashboard` owns the static UI and Pages data bundle workflow.

## Architecture

### Two execution paths

1. **CLI** (`packages/cli/`) — public user commands are `agent-note init`, `agent-note deinit`, `agent-note status`, `agent-note log`, `agent-note show`, and `agent-note why`. Automation-facing commands such as `agent-note pr`, `agent-note hook`, `agent-note record`, `agent-note commit`, and `agent-note push-notes` are kept for generated workflows and hooks.
2. **Hook handler** — `agent-note hook`, called by agent-specific hooks via stdin JSON (`--agent claude`, `codex`, `cursor`, or `gemini`). All data collection.

Public user installs generate agent hooks that call `npx --yes agent-note hook --agent <name>`. The Agent Note repository itself may use repo-local development hooks such as `node packages/cli/dist/cli.js hook --agent <name>` so maintainers can exercise the built CLI before publishing. That `cli.js hook` form is a maintainer-only compatibility path and should not appear in public setup guidance.

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

AI agent hooks handle data **collection** (prompts, file changes, session lifecycle, transcript references). Git hooks handle commit **integration** (trailer injection, note recording). For Claude Code, Codex, Cursor, and Gemini CLI, this means plain `git commit` works when the repository-local git hooks are installed. Cursor preview also recovers prompt / response pairs from Cursor response hooks or local transcripts, and its shell hooks provide a fallback path when git hooks are unavailable.

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

In git worktrees, this local temp layer intentionally lives under that
worktree's own git dir (`.git/worktrees/<name>/agentnote` for a non-bare
repository, or the equivalent worktree git dir for a bare repository). This
keeps active session pointers, heartbeats, and uncommitted JSONL buffers
isolated per worktree regardless of where the user chooses to place the
worktree directory, while git notes remain shared through the repository's
common git database.

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
  "agent": "claude",
  "session_id": "a1b2c3d4-...",
  "timestamp": "2026-04-02T10:30:00Z",
  "model": "claude-sonnet-4-20250514",
  "interactions": [
    {
      "prompt": "Implement JWT auth middleware",
      "contexts": [
        {
          "kind": "reference",
          "source": "previous_response",
          "text": "The previous response explains why this middleware needs to change."
        }
      ],
      "selection": {
        "schema": 1,
        "source": "primary",
        "signals": ["primary_edit_turn"]
      },
      "response": "I'll create the middleware with... ",
      "files_touched": ["src/auth.ts"],
      "tools": ["Edit"]
    }
  ],
  "files": [
    { "path": "src/auth.ts", "by_ai": true },
    { "path": "CHANGELOG.md", "by_ai": false },
    { "path": "packages/cli/dist/cli.js", "by_ai": false, "ai_ratio_excluded": true }
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
- **`agent`**: Agent adapter that produced the note, such as `claude`, `codex`, `cursor`, or `gemini`.
- **`model`**: LLM model identifier from SessionStart. `null` for agents that don't expose it.
- **`files`**: Array of `{path, by_ai}` plus optional flags. `by_ai` is true if any AI tool (Edit/Write) targeted the file. `generated: true` and `ai_ratio_excluded: true` keep the file visible while removing it from the AI ratio denominator.
- **`attribution`**: AI authorship metrics.
  - **`ai_ratio`**: 0–100 (rounded). Line-level when `method: "line"`, file-count when `method: "file"`, 0 when `method: "none"` (deletion-only).
  - **`method`**: `"line"` (blob-based 3-diff), `"file"` (binary file-count), or `"none"` (deletion-only, no valid ratio).
  - **`lines`**: Present when blob data available. `ai_added`, `total_added`, `deleted`.
- **`interactions[].tools`**: File-edit tools used in this interaction. Optional field — omitted when no tool data is available, `null` when adapter doesn't support tool tracking, `string[]` when tools were observed.
- **`interactions[].contexts[]`**: Optional display-only excerpts for short prompts. `reference` points to the immediately previous response; `scope` captures the current response's work scope. These contexts are never used for attribution, prompt counts, or file ownership. Older notes may still contain legacy `interactions[].context`, which readers treat as a `reference` context.
- **`interactions[].selection`**: Optional display-only prompt selection evidence. Stores only `schema`, `source`, and stable `signals`; runtime score, role, and display level are derived later and are never stored in the git note.
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

A commit note records a list of `interactions` (prompt + optional display-only `contexts[]` + response + `files_touched` + tools). Which prompts belong in that list is a separate question from which turns produce line-level attribution.

**Current: commit-to-commit window with selection evidence.** Agent Note starts from the previous recorded commit boundary, then keeps the conversation that leads to the current commit's surviving edit turns. `packages/cli/src/core/prompt-window.ts` owns this prompt-window policy, while `record.ts` owns data collection and note assembly. Each stored interaction may also get `selection` metadata (`schema`, `source`, `signals`) so renderers can later tune display density without changing git notes. The goal is to preserve the readable "why" between commits without falling back to the old full-session backlog.

**Step 1 — derive primary turns.**

- **Session-driven agents** (`Claude`, `Gemini`, partial `Cursor`): use line-level attribution when blob data is available. Turns that still own added lines in the final diff become the primary turns. If line-level attribution is unavailable, fall back to the **latest touch turn for each committed file**, not every historical same-file turn in the session.
- **Transcript-driven agents** (`Codex`): use transcript `files_touched` + `line_stats`. Agent Note searches backward for the smallest suffix of transcript edits whose cumulative line counts match the committed diff. Those turns become the primary turns. If an exact suffix cannot be proven, fall back to transcript turns that touched the commit's files.

**Step 2 — trim the commit prompt window.**

- Build the base window from turns `> maxConsumedTurn` through the latest primary turn for this commit.
- Keep nearby prompt-only planning, clarification, review, and follow-up turns inside that window.
- Drop edit turns that are not primary for this commit, even if they touched the same file earlier in the session.
- Keep post-primary tail prompts only when they are immediately before the commit boundary or have structural anchors to the current commit.
- Trim leading quoted prompt-history blocks, one-character continuation prompts, and overwritten edit bursts before the current work begins.
- Use structural signals only: path / file references, Unicode token overlap with the commit subject and paths, list-like prompt shape, quote markers, and edit-turn ownership. Do not use language-specific keyword lists.
- For transcript-driven agents such as Codex, apply the same window rule after transcript `files_touched` / `line_stats` identify the primary turns.

This keeps a readable commit narrative such as “remember the package redesign?” → “start the branch” → “do not keep backward compatibility” → “run the final review checklist”, while avoiding two failure modes: notes that collapse to a single short turn, and notes that drag in stale quoted PR summaries or overwritten edit bursts.

**Display-only context.**

If a selected prompt is short and needs nearby context, Agent Note may attach `interactions[].contexts[]`. This is a conservative display helper, not a second attribution signal.

- `reference` context comes from the immediately previous response. It must overlap the current commit through a strong structural anchor: changed file path, changed file basename, or code-like identifier extracted from the final diff.
- `scope` context comes from the current response. It is used when the prompt is short and the response's opening sentence has broad structural anchors such as scoped titles, PR / issue references with a title, or code identifiers tied to the commit subject. Code identifiers alone are not enough because they often describe a local implementation step rather than the work scope.
- Commit subject words can only break ties. A single subject word cannot create context by itself.
- Current prompts that already contain a strong anchor do not get extra context.
- If the immediately previous turn is already selected, no context is attached because the same information will appear as a normal prompt / response pair.
- Context selection uses language-neutral structural signals only. It does not use approval keywords such as "yes", "do it", or equivalents in any language.
- Context never changes `files_touched`, `ai_ratio`, prompt counts, consumed prompt state, or line-level attribution.

**Split-commit semantics are preserved.**

- Each commit records consumed `(turn, file)` pairs and prompt ids in `committed_pairs.jsonl`.
- `maxConsumedTurn` trims spent context from later commits in the same session.
- Tail prompt markers use `prompt_scope: "tail"` and do not advance `maxConsumedTurn`; they only prevent the same prompt from being shown repeatedly as display-only tail context.
- A turn that is primary for the current commit is still allowed through even if an earlier split commit already consumed the same turn.

**Trade-off:** the commit window is intentionally broader than edit-only attribution, but much narrower than the full session. This is deliberate: the goal is "the conversation between commits", not "only the prompt that touched the final line".

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

Every recordable commit made during an AI session gets a trailer:

```
feat: add auth middleware

Agentnote-Session: a1b2c3d4-5678-4abc-8def-111122223333
```

Injected via two parallel paths:
1. **Git hook** (`prepare-commit-msg`): reads session ID from `.git/agentnote/session`, verifies the session is fresh and has file evidence, then appends the trailer to the commit message file.
2. **Agent hook** (`PreToolUse Bash(*git commit*)`): Claude Code's hook can inject `--trailer` directly because the commit command itself came from the agent.

Both paths are redundant by design — if git hooks are not installed (e.g., first clone before `agent-note init`), the agent hook can still inject the trailer when the agent itself runs `git commit`.

### Git hooks for commit integration

Three git hooks handle commit integration and notes sharing:

| Git hook | When | What it does |
|---|---|---|
| `prepare-commit-msg` | Before commit message editor opens | Checks session freshness and file evidence (`changes.jsonl` or `pre_blobs.jsonl`), then appends `Agentnote-Session` trailer. Prompt-only active sessions are skipped for plain git commits. Skips amend/reuse (`$2=commit`). |
| `post-commit` | After commit succeeds | Reads session ID from the finalized trailer on HEAD, calls `agent-note record <session-id>` to write git note. If `prepare-commit-msg` explicitly marked a stale-heartbeat fallback, calls `agent-note record --fallback-head`, which only records when a session post-edit blob matches a committed HEAD blob. If the current process exposes an adapter-supported session environment such as `CODEX_THREAD_ID`, it may also call `agent-note record --fallback-env` when HEAD still has no Agent Note after the trailer/head attempt; fresh mutating transcript work can become commit-level attribution even when exact `files_touched` is unavailable. Direct file-matched env fallback rows may pull in bounded preceding decision-context prompts for display, but only the matched rows affect attribution. Idempotent — skips if note already exists. |
| `pre-push` | Before push to remote | Pushes `refs/notes/agentnote` to the actual remote (`$1`) and waits for `push-notes` to finish. Recursion-guarded via `AGENTNOTE_PUSHING` env var. |

Git hooks are installed into the hook directory reported by Git, not by assuming
`.git/hooks`. For worktrees, the hook script may run with a worktree-specific
`$GIT_DIR`, so `post-commit` and `pre-push` first try that worktree's local
Agent Note shim and then fall back to the common git dir shim shared by all
worktrees. This works for both bare and non-bare repositories, including custom
worktree directory layouts. It lets a main checkout `agent-note init` support
commits made inside Claude Agent View-style worktrees.

Session freshness is verified via per-session heartbeat file (`sessions/<id>/heartbeat`). Heartbeat is refreshed by normalized hook events during long turns. `Stop` does NOT invalidate the heartbeat — it fires when the AI finishes responding, not when the session ends. Gemini `SessionEnd` is a real session termination and removes the heartbeat. Missing heartbeat in `prepare-commit-msg` skips trailer injection. Stale heartbeat writes a one-shot fallback marker for brand-new commits only; `post-commit` consumes that marker and records only if the active session has post-edit blob evidence that matches the committed HEAD blobs. Agent-hosted terminals may also expose the current session through adapter-specific environment variables. Today, Codex exposes `CODEX_THREAD_ID`, which lets `post-commit` recover a fresh Codex transcript even when `.git/agentnote/session` points at a stale or unrelated session.

Plain git hook trailer injection also requires file evidence. File-change records or pre-edit blobs count as safe evidence because they can be matched back to committed files. Prompts alone are not enough for plain git hooks: a fresh prompt-only active session might belong to another agent or terminal workflow. Agent hook trailer injection can still preserve prompt-only work because the commit command itself was observed inside the agent. Transcript paths are supporting metadata, not recordable data by themselves. Heartbeat, `SessionStart`, and `transcript_path` metadata alone do not receive dangling `Agentnote-Session` trailers.

Environment fallback is narrower than trailer injection. It does not trust `.git/agentnote/session`; it trusts only an adapter-provided current process environment session id, validates the session id, discovers the agent transcript through the adapter, and requires a fresh heartbeat or fresh transcript mtime before recording. This helps terminals or agent hosts such as cmux, where the current Codex process may expose `CODEX_THREAD_ID` even if the repository active-session pointer was not updated. It can also recover when a stale active-session pointer injected a trailer but that trailer produced no git note. If the trusted transcript has direct file matches, Agent Note may ignore stale repository-local prompt logs and prefer the newest transcript rows after the parent commit that cover the commit files. For display, it keeps a bounded amount of preceding transcript discussion so the PR Report and Dashboard still explain why the implementation happened; for attribution and line counts, only the direct file-matched rows are used. The display window stops at large time gaps or prior edits to other files so a long transcript backlog does not become the commit note. If no newer matching row exists, it can still recover matching transcript work prepared just before the previous commit was finalized. Rows after the target commit are always ignored. If the trusted transcript has current mutating shell work but no exact per-prompt file touches, Agent Note records commit-level attribution by marking the commit files as AI-assisted while leaving `files_touched` empty. Read-only shell activity such as status checks is not enough for env fallback attribution.

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
agent-note deinit            remove Agent Note hooks and generated config
agent-note status            show current tracking state
agent-note log [n]           list recent commits with session info
agent-note show [commit]     show session details for HEAD or a commit SHA
agent-note why <target>      explain the Agent Note context behind a file line
```

Automation-facing commands exist for generated workflows and hooks, but should
not be presented as normal user actions:

```text
agent-note pr [base] [--json] [--output description|comment] [--update <PR#>] [--prompt-detail compact|full]
agent-note hook
agent-note record <session-id>
agent-note commit [args]
agent-note push-notes [remote]
```

### init model

`agent-note init` does four things by default:

1. **Agent config** — writes data collection hooks to the active agent config (`.claude/settings.json`, `.codex/config.toml` + `.codex/hooks.json`, `.cursor/hooks.json`, or `.gemini/settings.json`). Commit the generated repository-local files to share with the team.
2. **Git hooks** — installs `prepare-commit-msg`, `post-commit`, and `pre-push` hooks (respects `core.hooksPath`). Local to `.git/` — must be installed per clone.
3. **GitHub Actions workflow** — creates `.github/workflows/agentnote-pr-report.yml` for PR Reports. With `--dashboard`, it also creates `.github/workflows/agentnote-dashboard.yml`. Commit these files.
4. **Auto-fetch config** — adds `refs/notes/agentnote` to `remote.origin.fetch` so `git pull` fetches notes automatically.

Flags: `--agent <name...>`, `--dashboard`, `--no-hooks`, `--no-git-hooks`, `--no-action`, `--no-notes`, `--hooks`, `--action`.

### PR Report

The automation-facing PR renderer produces markdown or structured JSON reports
for the GitHub Action.

```bash
agent-note pr                              # markdown report (table format)
agent-note pr --prompt-detail compact      # shorter prompt/response details
agent-note pr --json                       # structured JSON (for scripts/actions)
agent-note pr --output description --update 42  # upsert into PR description
agent-note pr --output comment --update 42      # post as PR comment
```

Output: table format with summary header, hidden reviewer context, per-commit rows, and collapsible `📝 Context` / `🧑 Prompt` / `🤖 Response` section.

```
## 🧑💬🤖 Agent Note

**Total AI Ratio:** ████████ 73%
**Model:** `claude-sonnet-4-20250514`

<!-- agentnote-reviewer-context

Generated from Agent Note data. Use this as intent and review focus, not as proof that the implementation is correct.
-->
```

The Reviewer Context comment is deterministic. It groups changed files into generic areas such as Documentation, Workflows, Dependencies, Tests, and Source, then adds review focus and author intent signals from commit messages, stored prompts, display-only context, and changed files. The intent signal budget is small and newest-first, and primary commit interactions are preferred over older window/background prompts so stale tasks do not dominate the hidden context. It does not use an AI model and must not claim that the implementation is correct. It is hidden from the rendered PR description to avoid visual noise for human reviewers, but remains available in the raw PR body for review tools that read Markdown source.

Commit hashes are linked to the GitHub commit page. Context, prompts, and responses are in a collapsible `<details>` section.

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
      "interactions": [{"prompt": "...", "contexts": [{"kind": "scope", "source": "current_response", "text": "..."}], "selection": {"schema": 1, "source": "primary", "signals": ["primary_edit_turn"]}, "response": "...", "tools": ["Write"]}]
    }
  ]
}
```

## GitHub Action

### Usage

```yaml
- uses: wasabeef/AgentNote@v1
  id: agent-note
  with:
    base: main

# Use structured outputs
- run: echo "Total AI Ratio: ${{ steps.agent-note.outputs.overall_ai_ratio }}%"
```

### Action inputs

| Input | Default | Description |
|---|---|---|
| `base` | PR base branch | Base branch to compare against |
| `pr_output` | `description` | PR Report destination: `description`, `comment`, or `none` |
| `prompt_detail` | `compact` | Prompt history detail in PR Report: `compact` keeps the report focused, `full` shows every stored prompt |
| `dashboard` | `false` | Run Dashboard build/persist mode instead of PR Report Mode |

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
| `should_deploy` | boolean string | Dashboard Mode output that tells the caller workflow whether Pages should publish |

### Action internals

The root Action is a composite dispatcher.

In PR Report Mode (`dashboard` omitted or `false`), it:

1. `git fetch origin refs/notes/agentnote:refs/notes/agentnote`
2. Collects PR entries via `packages/pr-report`
3. Renders structured JSON and markdown via the shared PR Report package
4. Set GitHub Actions outputs
5. Post report to PR description (upsert between markers) or as a comment

Dependencies (`@actions/core`, `@actions/github`) are bundled with `ncc` into a single `dist/index.js` that is committed to the repo. No `npm install` needed at runtime.

In Dashboard Mode (`dashboard: true`), it prepares the caller repository without clobbering an existing checkout, restores existing Dashboard notes from `gh-pages`, syncs current git notes into the Dashboard note bundle, and persists the updated notes back to `gh-pages`. When the current job already uploads a Pages artifact, Dashboard Mode writes into that artifact path. Otherwise it uploads a standalone Dashboard artifact when deploy is allowed and no other Pages workflow is detected.

## Distribution

```
CLI:    npx agent-note init          (or npm install --save-dev)
Action: uses: wasabeef/AgentNote@v1             (Marketplace)
```

### Release procedure

`release.yml` is triggered by pushing a tag that matches `v*.*.*`. It does **not** rewrite package versions from the tag name. The npm publish job publishes whatever version is already committed in `packages/cli/package.json`.

The GitHub Release body is generated by `git-cliff` from commits since the
previous tag. Release notes include `feat:`, `fix:`, and `perf:` commits by
default. Internal commit types (`docs:`, `test:`, `refactor:`, `ci:`, `chore:`,
and `build:`) stay out of release notes unless their body contains a
`Release note:` line. `Release note: skip` hides an otherwise public-looking
commit.

GitHub Release notes do not use PR titles as release-copy bullets. PR titles
should still be written as release-summary-quality text because they are the
review-time signal that the underlying commit subjects and `Release note:` lines
are also user-facing. Merge commits are rendered only as a final "Merged Pull
Requests" section with links back to GitHub PRs. When a PR contains several
follow-up commits for the same behavior, keep only the primary implementation
commit visible in the release note and mark review-fix commits with
`Release note: skip`.

The changelog template applies `upper_first` to each rendered bullet so a
mechanical commit subject such as `recover Codex env sessions` becomes
`Recover Codex env sessions`. This is only a safety net; release-worthy wording
should still be written as a clear sentence in the commit body.

The canonical npm package is `agent-note`. The workflow also publishes `@wasabeef/agentnote` from the same built `dist/` as a reserved alias package, but end-user documentation should continue to point to `agent-note`.

Release steps:

1. Update the CLI package version in `packages/cli/package.json`.
2. Keep the workspace lockfile in sync. At minimum, update the `packages/cli` entry in `package-lock.json` so the committed workspace metadata matches the published package version.
3. Run the release checks locally:
   - `npm -w packages/cli run build`
   - `npm -w packages/cli test`
4. Review the generated release note locally before tagging:
   - `git-cliff --config .github/cliff.toml --latest --strip header`
5. If the generated note reads like an implementation log, rewrite the relevant
   commit subjects or add `Release note:` / `Release note: skip` lines before
   tagging.
6. Commit the version bump to `main`.
7. Create and push the matching git tag, for example `vX.Y.Z`.

Important:

- Do **not** cut a release tag before the package version bump lands on `main`.
- If `packages/cli/package.json` still has the previous version when you push the next tag, the workflow will try to publish that previous version and npm will reject it if it is already published.
- Treat `@wasabeef/agentnote` as a reserved alias only. Do not use it in README or website installation commands unless the project intentionally changes the canonical package name.
- The npm publish job is rerun-safe: if either `agent-note@<version>` or `@wasabeef/agentnote@<version>` is already published, that package publish step is skipped.
- The workflow updates the floating major tag (`v1` for `v1.x.y` releases) after the GitHub release is created, but it does not manage package.json versions for you.

### Team workflow

```bash
# 1. Enable agent-note (one person, once)
npx agent-note init
git add .claude/settings.json .github/workflows/agentnote-pr-report.yml
git commit -m "chore: enable agent-note"
git push

# Codex repositories commit `.codex/config.toml` + `.codex/hooks.json` instead.
# Cursor repositories commit `.cursor/hooks.json` instead.
# With `--dashboard`, also commit `.github/workflows/agentnote-dashboard.yml`.
# Plain `git commit` works when the generated git hooks are installed.

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
- **Input validation.** Environment-provided session IDs must use canonical UUID format. `transcript_path` must be under `~/.claude/` (or agent equivalent). Reject anything else silently.
- **Full response storage.** AI responses are stored in full. Git notes blobs are compressed and well within GitHub limits.

## Security

### Threat model

Agent Note records prompts, optional display-only context excerpts, and AI responses. This data may contain sensitive information:

- API keys, tokens, or credentials mentioned in prompts
- Internal business logic or proprietary algorithms
- PII (personally identifiable information)
- Vulnerability details in AI analysis responses

### Mitigations

| Threat | Mitigation |
|---|---|
| Secrets in prompts/context/responses | **Not automatically redacted.** Users are responsible for reviewing notes before pushing them to public repos. |
| Command injection via session ID | Environment-provided session IDs are validated as canonical UUIDs before fallback recording. Non-matching IDs are silently dropped. |
| Transcript path traversal | `transcript_path` must be under `~/.claude/` (or agent equivalent). Paths outside are rejected. |
| git notes tampering | Anyone with repo write access can modify or delete notes. Notes are **not signed or encrypted**. Treat them as advisory, not as audit trail. |
| GitHub Action markdown injection | PR Report renders prompts/context/responses as markdown inside the PR body. Treat git notes as trusted repository data; do not push untrusted prompt content to public notes. |
| `npx --yes` supply chain | Claude Code agent hooks use `npx --yes agent-note hook`. Git hooks (installed by `init`) prefer local binary (`node_modules/.bin/agent-note`), falling back to PATH. |
| Fork PR attacks | The GitHub Action should not run on `pull_request_target` with fork PRs. Default trigger is `pull_request` which is safe. |

### Recommendations for users

- **Be aware that `agent-note init` installs a `pre-push` hook that auto-pushes notes** on every `git push`. On public repositories, this means prompts and AI responses will be visible. Use `--no-git-hooks` to skip git hook installation if this is a concern.
- Use `git notes --ref=agentnote show <commit>` or `agent-note show <commit>` to review what will be shared.

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

GitHub's "Squash and merge" creates a new commit with a new SHA. All notes from the individual PR commits are lost on the merge commit. The PR Report is only meaningful **before merge**.

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

- well-known tool/cache paths such as `.next/`, `.nuxt/`, `coverage/`, `.dart_tool/`, `.turbo/`, and `bazel-out/`
- common generated suffixes such as `.generated.ts`, `.g.dart`, `.pb.go`, `.pb.rs`, `.generated.swift`, `.generated.kt`
- committed file names such as `GeneratedPluginRegistrant.swift` and `generated_plugin_registrant.dart`
- committed file headers that contain markers like `Code generated ... DO NOT EDIT`, `Generated by SwiftGen`, `@generated`, or `automatically generated by rust-bindgen`

Generic directory names such as `build/`, `dist/`, `gen/`, `generated/`, and `target/` are intentionally not path-only signals because many repositories keep handwritten source, checked-in bundles, or package entrypoints there.

Generated files still appear in the note's `files[]` list, but they do not drag the file-level `ai_ratio` toward human attribution.

Repositories can also add a root `.agentnoteignore` file when committed bundles or generated outputs should stay visible but not affect AI ratio:

```gitignore
packages/cli/dist/**
packages/pr-report/dist/**
```

`.agentnoteignore` uses gitignore-like patterns with `!` negation and last-match-wins behavior. Matching files still appear in `files[]`, PR Report, and Dashboard. They are only removed from the AI ratio denominator and are marked with `ai_ratio_excluded: true` in the stored note.

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

  /** Add agent-note hooks. Idempotent — safe to call multiple times. */
  installHooks(repoRoot: string): Promise<void>;

  /** Remove agent-note hooks. Idempotent — no-op if not installed. */
  removeHooks(repoRoot: string): Promise<void>;

  /** Check if hooks are installed for this adapter. */
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
4. `agent-note hook` is always dispatched by `--agent <name>`
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
| Team sharing | Auto-push checkpoint branch | **Auto-pushes git notes** via the generated `pre-push` hook |
| PR integration | None built-in | **GitHub Action** with structured outputs |
