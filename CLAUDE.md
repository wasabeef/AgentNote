# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Agent Note (`@wasabeef/agentnote`) is a monorepo CLI + GitHub Action that links AI coding sessions to git commits. It records every prompt, AI response, file change, and AI authorship ratio so you can trace back to *why* code changed.

## Repository structure

```
packages/cli/     # @wasabeef/agentnote — npm package (CLI)
packages/action/  # GitHub Action (Marketplace)
action.yml        # root pointer to packages/action/dist/index.js
```

## Commands (run from packages/cli/)

```bash
cd packages/cli
npm run build          # esbuild → dist/cli.js (single ESM bundle)
npm run lint           # tsc --noEmit (type check only)
npm test               # node:test runner via tsx
npm run test:coverage  # same with V8 coverage
npx tsx src/cli.ts     # run CLI without building
node dist/cli.js       # run built CLI
```

Tests shell out to `node dist/cli.js`, so always build before running tests.

## Architecture

### Two execution paths

1. **CLI** (`packages/cli/src/cli.ts` → commands): `agentnote init`, `agentnote show`, `agentnote log`, `agentnote pr`. Run by users and CI.
2. **Hook handler** (`packages/cli/src/commands/hook.ts`): Called by Claude Code hooks via stdin JSON. All data collection.

### Data flow

```
Claude Code hooks → agentnote hook (stdin JSON) → .git/agentnote/sessions/<id>/*.jsonl (local temp)
git commit (via Claude Code) → PreToolUse injects --trailer → PostToolUse records entry to git notes
agentnote show/log → reads git notes --ref=agentnote
```

### Hook event handling (`packages/cli/src/commands/hook.ts`)

- **SessionStart/Stop**: Track active session ID in `.git/agentnote/session`
- **UserPromptSubmit**: Append prompt to `prompts.jsonl`
- **PreToolUse (Bash, git commit)**: Inject `--trailer 'Agentnote-Session: <id>'` via `updatedInput` (synchronous, must write to stdout)
- **PostToolUse (Edit/Write)**: Track file changes in `changes.jsonl`
- **PostToolUse (Bash, git commit)**: Call `recordEntry()` to write git note, then rotate logs

### Storage: two layers

**Layer 1 — Local temp** (`.git/agentnote/sessions/`): Append-only JSONL files accumulated during a session. Rotated after each commit. Never pushed.

**Layer 2 — Git notes** (`refs/notes/agentnote`): One JSON note per commit with `"v": 1` schema version. Permanent, pushable, shareable.

### init vs hook

- `init` modifies `.claude/settings.json` — intended to be committed to git so the team shares the same hooks config.
- `hook` is called by Claude Code at runtime. It never modifies settings.json.

## Constraints

- **Zero runtime dependencies for CLI.** Only devDependencies. The action has its own deps (`@actions/core`, `@actions/github`), bundled with ncc.
- **Git CLI only.** All git operations go through `packages/cli/src/git.ts` which calls the `git` binary via `execFile`. Never use a git library.
- **Never break git commit.** All agentnote recording is wrapped in try/catch. If agentnote fails, the commit must still succeed.
- **All source code in English.** Comments, variable names, CLI output, test descriptions — everything in English.
- **PreToolUse hooks are synchronous.** Must write JSON to stdout, must not be marked `async: true`.
- **Input validation.** Session IDs must match UUID v4. `transcript_path` must be under `~/.claude/`.
- **Response truncation.** AI responses in notes are truncated to 2000 characters.
- **Git notes for persistent storage.** Entry data goes to `refs/notes/agentnote`, not to files.
