# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Agent Note (`@wasabeef/agentnote`) is a monorepo CLI + GitHub Action that links AI coding sessions to git commits. It records every prompt, AI response, file change, and AI authorship ratio so you can trace back to *why* code changed.

## Repository structure

```
packages/cli/     # @wasabeef/agentnote — npm package (CLI)
packages/action/  # GitHub Action (Marketplace)
action.yml        # root pointer to packages/action/dist/index.js
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

1. **CLI** (`packages/cli/src/cli.ts` → commands): `agentnote init`, `agentnote deinit`, `agentnote show`, `agentnote log`, `agentnote session`, `agentnote pr`, `agentnote status`, `agentnote commit`, `agentnote record`. Run by users and CI.
2. **Hook handler** (`packages/cli/src/commands/hook.ts`): Called by agent hooks via stdin JSON. All data collection. Agent-agnostic via adapter pattern.

### Data flow

```
Agent hooks → agentnote hook --agent <name> (stdin JSON) → .git/agentnote/sessions/<id>/*.jsonl (local temp)
git commit → prepare-commit-msg injects trailer → post-commit calls agentnote record → git note written
git push → pre-push auto-pushes refs/notes/agentnote
agentnote show/log/session → reads git notes --ref=agentnote
```

### Agent adapters (`packages/cli/src/agents/`)

Agent Note supports multiple coding agents via an adapter pattern:

- **`types.ts`**: `AgentAdapter` interface — each agent defines its hooks config, event parser, and transcript reader.
- **`index.ts`**: Agent registry — `getAgent()`, `hasAgent()`, `listAgents()`.
- **`claude.ts`**: Claude Code adapter. Hooks for Edit/Write/MultiEdit/NotebookEdit and Bash.
- **`codex.ts`**: Codex CLI adapter. Parses `apply_patch` transcripts for file attribution.
- **`cursor.ts`**: Cursor adapter (Preview). Hooks via `.cursor/hooks.json`. Parses `~/.cursor/projects/` transcripts. Edit-count attribution with line-level upgrade when edit stats match commit diff.
- **`gemini.ts`**: Gemini CLI adapter. Hooks via `.gemini/settings.json`. BeforeTool/AfterTool for file edits (`write_file`, `replace`) and shell commands. Trailer injection via `prepare-commit-msg` git hook (pending-commit pattern).

### Hook event handling (`packages/cli/src/commands/hook.ts`)

- **SessionStart**: Create session directory, write heartbeat, store agent name via `writeSessionAgent()`
- **Stop**: Log stop event only — does **not** invalidate heartbeat (Stop = AI response end, not session end)
- **UserPromptSubmit**: Append prompt to `prompts.jsonl`, increment turn counter in `turn` file, capture human snapshot via `git diff HEAD --numstat`
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

### Git hooks (`agentnote init`)

`agentnote init` installs three git hooks alongside the agent's hook config:

- **`prepare-commit-msg`**: Checks heartbeat freshness (< 1 hour), injects `Agentnote-Session` trailer into commit message. Skips amends.
- **`post-commit`**: Reads session ID from HEAD's trailer, calls `agentnote record <sid>` to write git note.
- **`pre-push`**: Auto-pushes `refs/notes/agentnote` to remote. Uses `AGENTNOTE_PUSHING` recursion guard.

Existing hooks are backed up and chained. Compatible with husky/lefthook.

### Core modules

- **`core/record.ts`**: Shared `recordCommitEntry()` used by both `hook.ts` and `commit.ts`. Reads JSONL, builds entry, writes git note, rotates logs. Agent-aware via registry. Idempotent (checks existing note). Includes consumed-pairs deduplication to prevent re-attribution across split commits.
- **`core/entry.ts`**: `buildEntry()` and `calcAiRatio()`. Structured schema with `files: [{path, by_ai}]`, `attribution: {ai_ratio, method, lines}`, `model`, and `interactions[].tools`.
- **`core/attribution.ts`**: 3-diff position algorithm for line-level AI attribution. Parses unified diff hunks, computes AI vs human line positions.
- **`core/session.ts`**: `writeSessionAgent()` / `readSessionAgent()` / `writeSessionTranscriptPath()` / `readSessionTranscriptPath()`. Per-session agent metadata.
- **`core/constants.ts`**: Shared constants — `TRAILER_KEY`, `SESSION_AGENT_FILE`, `HEARTBEAT_FILE`, etc.
- **`core/jsonl.ts`**: `readJsonlField()` (deduplicated single field), `readJsonlEntries()` (full objects), `appendJsonl()`.
- **`core/storage.ts`**: `writeNote()` and `readNote()` using `refs/notes/agentnote`.
- **`core/rotate.ts`**: Rename JSONL files with commit SHA prefix after each commit.

### Storage: two layers

**Layer 1 — Local temp** (`.git/agentnote/sessions/`): Append-only JSONL files accumulated during a session. Rotated after each commit. Never pushed.

**Layer 2 — Git notes** (`refs/notes/agentnote`): One JSON note per commit with `"v": 1` schema. Permanent, pushable, shareable.

### Causal turn ID

Each `UserPromptSubmit` increments a turn counter. File changes inherit the current turn number. At commit time, `recordCommitEntry()` groups files by turn and attaches them as `files_touched` per interaction. This avoids timestamp-based attribution which is unreliable under async hooks.

### init vs hook

- `init` modifies agent config (`.claude/settings.json` for Claude Code, `.codex/` for Codex, `.cursor/hooks.json` for Cursor, `.gemini/settings.json` for Gemini CLI) and installs git hooks (prepare-commit-msg, post-commit, pre-push). Agent config is intended to be committed to git so the team shares the same hooks config.
- `hook` is called by the coding agent at runtime. It never modifies config files.

### Harness hooks

`.claude/settings.json` includes quality gates beyond agentnote tracking:
- **Stop (async)**: Run tests after each turn
- **PreToolUse (sync)**: Typecheck before `git commit` — blocks if types fail
- **PostToolUse (async)**: Biome lint after Edit/Write — feedback only

## Commit conventions

- **Conventional Commits** required. Prefix: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `ci:`, `chore:`, `perf:`, `build:`. Used by git-cliff for changelog generation.
- **Scope is optional** but encouraged for targeted changes: `feat(website):`, `fix(action):`.
- **Structural vs behavioral changes** must not be mixed in a single commit. Renames/reformats separate from feature/fix commits.
- **Before committing**, all four checks must pass (run from `packages/cli/`):
  1. `npm run build` — esbuild bundle
  2. `npm run typecheck` — tsc --noEmit
  3. `npm run lint` — biome check
  4. `npm test` — node:test (requires build first)
- **Version bumps** go in a dedicated `chore: bump version to x.y.z` commit. Tag `vx.y.z` triggers the release workflow (test → GitHub Release → npm publish).

## Constraints

- **Zero runtime dependencies for CLI.** Only devDependencies. The action has its own deps (`@actions/core`, `@actions/github`), bundled with ncc.
- **Git CLI only.** All git operations go through `packages/cli/src/git.ts` which calls the `git` binary via `execFile`. Never use a git library.
- **Never break git commit.** All agentnote recording is wrapped in try/catch. If agentnote fails, the commit must still succeed.
- **All source code in English.** Comments, variable names, CLI output, test descriptions — everything in English.
- **PreToolUse hooks are synchronous.** Must write JSON to stdout, must not be marked `async: true`.
- **Input validation.** Session IDs must match UUID v4. `transcript_path` must be under the agent's home directory (e.g. `~/.claude/` for Claude Code, `~/.gemini/` for Gemini CLI).
- **Git notes for persistent storage.** Entry data goes to `refs/notes/agentnote`, not to files.
- **Biome for lint + format.** Run `npm run lint` (biome check) and `npm run typecheck` (tsc) separately. Both must pass in CI.
