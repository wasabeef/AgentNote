# Repository Guidelines

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Agent Note (`agent-note`) is a monorepo CLI + GitHub Action that links AI coding sessions to git commits. It records every prompt, AI response, file change, and AI authorship ratio so you can trace back to *why* code changed.

Repository development uses Node.js >= 22.12.0 and npm 11.13.0. The published CLI package still supports Node.js >= 20.

## Maintainer docs

- `docs/README.md`: Start here for the maintainer documentation map.
- `docs/engineering.md`: Implementation guidelines for constants, comments, safety boundaries, and verification.
- `docs/architecture.md`: Canonical architecture and data-flow reference.
- `docs/knowledge/README.md`: Focused design notes, investigation history, research, and archive.

## Repository structure

```
packages/cli/     # agent-note — npm package (CLI)
packages/pr-report/  # PR Report library used by the GitHub Action
packages/dashboard/  # Dashboard static app + workflow scripts
action.yml           # public Action entrypoint for PR Report and Dashboard
website/          # Documentation site (Astro Starlight, 12 locales)
```

## Commands (run from packages/cli/)

```bash
cd packages/cli
npm run build          # esbuild → dist/cli.js (single ESM bundle)
npm run lint           # biome check src/
npm run lint:fix       # biome check --write src/
npm run format         # biome format --write src/
npm run typecheck      # tsc --noEmit
npm test               # node:test runner via tsx
npm run test:coverage  # same with V8 coverage
npx tsx src/cli.ts     # run CLI without building (must run from packages/cli/)
node dist/cli.js       # run built CLI
```

Tests shell out to `node dist/cli.js`, so always build before running tests.

## Architecture

### Two execution paths

1. **CLI** (`packages/cli/src/cli.ts` → commands): public user commands are `agent-note init`, `agent-note deinit`, `agent-note status`, `agent-note log`, `agent-note show`, and `agent-note why`. Internal or automation-facing commands include `agent-note hook`, `agent-note record`, `agent-note pr`, `agent-note commit`, and `agent-note push-notes`.
2. **Hook handler** (`packages/cli/src/commands/hook.ts`): Called by agent hooks via stdin JSON. All data collection. Agent-agnostic via adapter pattern.

### Data flow

```
Agent hooks → agent-note hook --agent <name> (stdin JSON) → .git/agentnote/sessions/<id>/*.jsonl (local temp)
git commit → prepare-commit-msg injects trailer when file evidence exists → post-commit calls agent-note record → git note written
git push → pre-push auto-pushes refs/notes/agentnote
agent-note show/log/why → reads git notes --ref=agentnote
```

### Agent adapters (`packages/cli/src/agents/`)

Agent Note supports multiple coding agents via an adapter pattern:

- **`types.ts`**: `AgentAdapter` interface — each agent defines its hooks config, event parser, and transcript reader.
- **`index.ts`**: Agent registry — `getAgent()`, `hasAgent()`, `listAgents()`.
- **`claude.ts`**: Claude Code adapter. Hooks for Edit/Write/MultiEdit/NotebookEdit and Bash.
- **`codex.ts`**: Codex CLI adapter. Parses `apply_patch` transcripts for file attribution.
- **`cursor.ts`**: Cursor adapter. Hooks via `.cursor/hooks.json`. Parses `~/.cursor/projects/` transcripts. Edit-count attribution with line-level upgrade when edit stats match commit diff.
- **`gemini.ts`**: Gemini CLI adapter (Preview). Hooks via `.gemini/settings.json`. BeforeTool/AfterTool for file edits (`write_file`, `replace`) and shell commands. Trailer injection via `prepare-commit-msg` git hook (pending-commit pattern). `extractInteractions` parses JSONL transcripts from `~/.gemini/tmp/`; transcript schema may evolve with Gemini CLI updates.

### Hook event handling (`packages/cli/src/commands/hook.ts`)

- **SessionStart**: Create session directory, write heartbeat, store agent name via `writeSessionAgent()`
- **Stop**: Log stop event only — does **not** invalidate heartbeat (Stop = AI response end, not session end)
- **UserPromptSubmit**: Normalize prompt text, append it to `prompts.jsonl`, increment turn counter in `turn` file. Agent Note strips leading runtime metadata such as `<environment_context>` while preserving the actual user request, and drops standalone system-injected messages (`<task-notification>`, `<system-reminder>`, `<teammate-message>`) to prevent turn pollution
- **PreToolUse (Edit/Write/MultiEdit/NotebookEdit)**: Capture pre-edit blob hash via `git hash-object -w` for line-level attribution (synchronous)
- **PreToolUse (Bash, git commit)**: Inject `--trailer` into the `git commit` segment only via regex replace (`cmd.replace(/(git\s+commit)/, ...)`) to handle chained commands like `git commit && git push` (synchronous, must write to stdout)
- **PostToolUse (Edit/Write/MultiEdit/NotebookEdit)**: Track file changes in `changes.jsonl` with current turn number and post-edit blob hash
- **PostToolUse (Bash, git commit)**: Call `recordCommitEntry()` to write git note, then rotate logs

Gemini-specific event handling:
- **BeforeTool (`write_file`, `replace`)**: Maps to `pre_edit`; writes `{"decision": "allow"}` to stdout (synchronous requirement)
- **BeforeTool (shell, git commit)**: Maps to `pre_commit`; writes pending-commit state to `PENDING_COMMIT_FILE` and `{"decision": "allow"}` to stdout
- **AfterTool (`write_file`, `replace`)**: Maps to `file_change` (standard)
- **AfterTool (shell, git commit)**: Maps to `post_commit`; reads `PENDING_COMMIT_FILE` to detect HEAD change, then calls `recordCommitEntry()`
- **BeforeAgent**: Maps to `prompt` (increments turn, appends to `prompts.jsonl`)
- **AfterAgent**: Maps to `response`
- **SessionStart / SessionEnd**: Standard session lifecycle events
- **BeforeTool (unrecognized tool)**: Null fallback — still writes `{"decision": "allow"}` to stdout to avoid blocking Gemini CLI

### Git hooks (`agent-note init`)

`agent-note init` installs three git hooks alongside the agent's hook config:

- **`prepare-commit-msg`**: Checks heartbeat freshness (< 1 hour) and file evidence (`changes.jsonl` or `pre_blobs.jsonl`) before injecting an `Agentnote-Session` trailer for plain git commits. Prompt-only sessions do not get plain git hook trailers. Agent `PreToolUse git commit` hooks may still inject trailers for prompt-only rescue because the commit command itself came from the agent. Skips amends.
- **`post-commit`**: Reads session ID from HEAD's trailer, calls `agent-note record <sid>` to write git note. If `prepare-commit-msg` marked a long-running session as too stale for trailer injection, it calls `agent-note record --fallback-head`, which records only when a session post-edit blob matches a committed HEAD blob. If the current process exposes an adapter-supported session environment such as `CODEX_THREAD_ID`, it may also call `agent-note record --fallback-env` when HEAD still has no Agent Note after the trailer/head attempt. Env fallback prefers transcript rows tied to current commit files, ignores rows after HEAD, can recover work prepared just before the previous commit when no newer match exists, keeps bounded preceding decision-context prompts for display, and uses commit-level attribution only for mutating shell-only work without exact `files_touched`.
- **`pre-push`**: Auto-pushes `refs/notes/agentnote` to remote. Uses `AGENTNOTE_PUSHING` recursion guard.

Existing hooks are backed up and chained. Compatible with husky/lefthook.
Git worktrees are supported by keeping session buffers in each worktree's own git dir while sharing the repo-local CLI shim from the common git dir. This must work for bare and non-bare repositories, arbitrary worktree directory layouts, and agent-managed worktree commits after init from either the main checkout or a linked worktree. Claude Agent View is one example, but the worktree behavior must stay agent-agnostic for Codex, Cursor, Gemini, and future adapters.

### Core modules

- **`core/record.ts`**: Shared `recordCommitEntry()` used by both `hook.ts` and `commit.ts`. Reads JSONL, builds entry, writes git note, rotates logs. Agent-aware via registry. Idempotent (checks existing note). Includes consumed-pairs deduplication to prevent re-attribution across split commits.
- **`core/prompt-window.ts`**: Prompt-window policy and stable selection evidence. Keeps commit-to-commit prompt context while trimming stale task prompts, tail duplicates, quoted history, and non-primary edit turns.
- **`core/entry.ts`**: `buildEntry()` and `calcAiRatio()`. Structured schema with `files: [{path, by_ai}]`, `attribution: {ai_ratio, method, lines}`, `model`, `interactions[].contexts[]`, and `interactions[].tools`.
- **`core/attribution.ts`**: 3-diff position algorithm for line-level AI attribution. Parses unified diff hunks, computes AI vs human line positions.
- **`core/session.ts`**: `writeSessionAgent()` / `readSessionAgent()` / `writeSessionTranscriptPath()` / `readSessionTranscriptPath()`. Per-session agent metadata.
- **`core/constants.ts`**: Shared constants — `TRAILER_KEY`, `SESSION_AGENT_FILE`, `HEARTBEAT_FILE`, `PENDING_COMMIT_FILE`, etc.
- **`core/jsonl.ts`**: `readJsonlField()` (deduplicated single field), `readJsonlEntries()` (full objects), `appendJsonl()`.
- **`core/storage.ts`**: `writeNote()` and `readNote()` using `refs/notes/agentnote`.
- **`core/rotate.ts`**: Rename JSONL files with commit SHA prefix after each commit.

### Storage: two layers

**Layer 1 — Local temp** (`.git/agentnote/sessions/`): Append-only JSONL files accumulated during a session. Rotated after each commit. Never pushed.

**Layer 2 — Git notes** (`refs/notes/agentnote`): One JSON note per commit with `"v": 1` schema. Permanent, pushable, shareable.

### Causal turn ID

Each `UserPromptSubmit` increments a turn counter. File changes inherit the current turn number. At commit time, `recordCommitEntry()` groups files by turn and attaches them as `files_touched` per interaction. Prompt lists are selected from the commit-to-commit window: turns after the previous recorded commit through the current commit's surviving edit turns, with structurally stale leading quoted history and overwritten edit turns trimmed. If a short selected prompt depends on the immediately previous response but that previous turn is already consumed by an older commit, Agent Note may attach display-only `context`; this never changes attribution. This avoids timestamp-based attribution which is unreliable under async hooks.

### init vs hook

- `init` modifies agent config (`.claude/settings.json` for Claude Code, `.codex/` for Codex, `.cursor/hooks.json` for Cursor, `.gemini/settings.json` for Gemini CLI) and installs git hooks (prepare-commit-msg, post-commit, pre-push). Agent config is intended to be committed to git so the team shares the same hooks config.
- `hook` is called by the coding agent at runtime. It never modifies config files.
- Public user installs generate agent hooks that call `npx --yes agent-note hook --agent <name>`. This repository may keep repo-local development hooks that call `node packages/cli/dist/cli.js hook --agent <name>` so local changes can be tested before publishing. Treat `cli.js hook` as a maintainer-only compatibility path, not public setup guidance.

### Harness hooks

`.claude/settings.json` includes quality gates beyond agent-note tracking:
- **Stop (async)**: Run tests after each turn
- **PreToolUse (sync)**: Typecheck before `git commit` — blocks if types fail
- **PostToolUse (async)**: Biome lint after Edit/Write — feedback only

## Commit conventions

- **Conventional Commits** required. Prefix: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `ci:`, `chore:`, `perf:`, `build:`. Used by git-cliff for changelog generation.
- **Scope is optional** but encouraged for targeted changes: `feat(website):`, `fix(action):`.
- **Write commit subjects for release notes.** The subject should describe the user-facing outcome, not the mechanical edit. Prefer `fix(report): hide absorbed external review prompts` over `fix: address review comments`.
- **Use the body when the subject is not enough.** Good AI-generated commits should include `Why`, `User impact`, `Verification`, and `Release note:` sections. Do not write `Why:`, `User impact:`, or `Verification:` with colons because git-cliff may parse them as commit footers instead of body text.
- **Release note rules.** `feat:`, `fix:`, and `perf:` commits are included by default. `docs:`, `test:`, `refactor:`, `ci:`, `chore:`, and `build:` commits are omitted unless the body contains `Release note:` with a value other than `skip`.
- **Keep release notes human-sized.** A multi-commit PR should normally produce one clear release bullet per user-visible change, not one bullet per review fix. Put the public wording on the primary implementation commit with `Release note: <sentence>`, and add `Release note: skip` to follow-up commits such as `address review findings`, `tighten fallback`, `bound window`, or generated bundle syncs unless they describe a distinct user-visible outcome.
- **Write release notes as natural English sentences.** The generator capitalizes the first character as a safety net, but do not rely on that to fix awkward wording. Prefer `Release note: Codex commits made from cmux sessions are now recorded reliably.` over `Release note: recover codex env sessions`.
- **PR titles should be release-summary quality.** Write PR titles as a user-facing outcome, not an implementation step. Even though GitHub Releases are generated from commits, a good PR title is the easiest review-time signal that the eventual release note will be understandable.
- **Preview release notes before merging release-sensitive PRs.** If `git-cliff --config .github/cliff.toml --latest --strip header` reads like an implementation log, rewrite commit subjects/bodies before merge. Before tagging, use the release command below so the preview targets the next version.
- **Do not rely on merge commits for release copy.** Release notes include merged PR links from `Merge pull request...` commits, but the user-facing bullets still come from implementation commits and `Release note:` lines. Version bumps and generated bundle sync commits stay hidden.
- **Structural vs behavioral changes** must not be mixed in a single commit. Renames/reformats separate from feature/fix commits.
- **Before committing**, all four checks must pass (run from `packages/cli/`):
  1. `npm run build` — esbuild bundle
  2. `npm run typecheck` — tsc --noEmit
  3. `npm run lint` — biome check
  4. `npm test` — node:test (requires build first)
- **Version bumps** go in a dedicated `chore: bump version to x.y.z` commit. Prefer the repo-local `agentnote-release` skill or `/release` command; `x.y.z` and `vx.y.z` inputs both create the `vx.y.z` tag. Push the tag only when ready to trigger the release workflow (test → GitHub Release → npm publish).

## Constraints

- **Zero runtime dependencies for CLI.** Only devDependencies. The action has its own deps (`@actions/core`, `@actions/github`), bundled with ncc.
- **Git CLI only.** All git operations go through `packages/cli/src/git.ts` which calls the `git` binary via `execFile`. Never use a git library.
- **Never break git commit.** All agent-note recording is wrapped in try/catch. If agent-note fails, the commit must still succeed.
- **All source code in English.** Comments, variable names, CLI output, test descriptions — everything in English.
- **PreToolUse hooks are synchronous.** Must write JSON to stdout, must not be marked `async: true`.
- **Input validation.** Environment-provided session IDs must use canonical UUID format. `transcript_path` must be under the agent's home directory (e.g. `~/.claude/` for Claude Code, `~/.gemini/` for Gemini CLI).
- **Git notes for persistent storage.** Entry data goes to `refs/notes/agentnote`, not to files.
- **Biome for lint + format.** Run `npm run lint` (biome check) and `npm run typecheck` (tsc) separately. Both must pass in CI.
