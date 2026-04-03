# lore — Design Document

> Remember why your code changed. Minimal tooling, maximum traceability.

## Philosophy

entire.io tried to do too much — shadow branches, condensation, state machines, multi-agent abstraction. The essential need is simpler:

> **Link every git commit to the AI session that produced it.**

AI agents already store transcripts locally. Lore captures the right metadata at the right time and attaches it to commits using Git's native mechanisms.

## Repository structure

The repository is a monorepo with two packages:

```
wasabeef/lore/
├── action.yml                      # root pointer → packages/action (for uses: wasabeef/lore@v1)
│
├── packages/
│   ├── cli/                        # @wasabeef/lore — npm package
│   │   ├── src/
│   │   │   ├── cli.ts              # entry point, command routing
│   │   │   ├── git.ts              # git CLI wrapper
│   │   │   ├── paths.ts            # path resolution
│   │   │   ├── core/               # agent-agnostic logic
│   │   │   │   ├── entry.ts        # build entry JSON, calc ai_ratio
│   │   │   │   ├── storage.ts      # git notes read/write
│   │   │   │   ├── jsonl.ts        # JSONL read/append helpers
│   │   │   │   └── rotate.ts       # log rotation after commit
│   │   │   ├── agents/             # one file per agent
│   │   │   │   ├── types.ts        # AgentAdapter interface + NormalizedEvent
│   │   │   │   └── claude-code.ts  # Claude Code adapter
│   │   │   └── commands/           # user-facing, delegates to agents/ + core/
│   │   │       ├── enable.ts
│   │   │       ├── disable.ts
│   │   │       ├── hook.ts
│   │   │       ├── commit.ts
│   │   │       ├── show.ts
│   │   │       ├── log.ts
│   │   │       ├── pr.ts
│   │   │       └── status.ts
│   │   ├── package.json            # name: @wasabeef/lore
│   │   └── tsconfig.json
│   │
│   └── action/                     # GitHub Action (Marketplace)
│       ├── action.yml              # action definition (inputs/outputs)
│       ├── src/
│       │   └── index.ts            # calls CLI, sets outputs, posts comment
│       ├── dist/
│       │   └── index.js            # ncc-bundled (committed, no node_modules needed)
│       └── package.json            # name: @wasabeef/lore-action (private, not published)
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

The action calls `lore pr --json` — it's tightly coupled to the CLI's output format. Keeping both in one repo means:

- A single PR can change CLI output + action parsing in lockstep
- No cross-repo version coordination
- Shared CI

### Root action.yml trick

GitHub resolves `uses: wasabeef/lore@v1` by looking for `action.yml` at the repo root. The root file is a 3-line pointer to the real implementation:

```yaml
# action.yml (root)
name: "Lore PR Report"
description: "AI session tracking report for pull requests"
runs:
  using: "node22"
  main: "packages/action/dist/index.js"
```

This gives users `uses: wasabeef/lore@v1` while code lives in `packages/action/`.

## Architecture

### Two execution paths

1. **CLI** (`packages/cli/`) — `lore enable`, `lore show`, `lore log`, `lore pr`. Run by users and CI.
2. **Hook handler** — `lore hook`, called by Claude Code via stdin JSON. All data collection.

### Data flow

```
                     AI Agent hooks
                           │
         ┌─────────────────┼──────────────────┐
         │                 │                   │
    SessionStart     UserPromptSubmit      PostToolUse
    Stop                                   PreToolUse
         │                 │                   │
         ▼                 ▼                   ▼
    .git/lore/        prompts.jsonl       changes.jsonl
    session           (append-only)       (Edit/Write tracking)
                                          ┌────────────────────┐
                                          │ PreToolUse:        │
                                          │ git commit →       │
                                          │ inject --trailer   │
                                          │ (synchronous)      │
                                          └────────────────────┘
                                          ┌────────────────────┐
                                          │ PostToolUse:       │
                                          │ git commit →       │
                                          │ record entry to    │
                                          │ git notes          │
                                          │ (async)            │
                                          └────────────────────┘
```

### Storage: two layers

**Layer 1 — Local temp (`.git/lore/sessions/`)**

Append-only JSONL files, accumulated during a session, rotated after each commit. Never pushed. Crash-safe — if the process dies, only the last line might be incomplete.

```
.git/lore/
├── session                          # active session ID (single line)
└── sessions/<session-id>/
    ├── prompts.jsonl                # one prompt per line
    ├── changes.jsonl                # files touched by AI (Edit/Write)
    ├── events.jsonl                 # session lifecycle
    ├── transcript_path              # path to agent's transcript file
    ├── prompts-<sha>.jsonl          # archived after commit
    └── ...
```

**Layer 2 — Git notes (`refs/notes/lore`)**

The permanent record. One JSON note per commit, written at commit time. Pushable, fetchable, shareable with the team.

```bash
git notes --ref=lore add -f -m '<json>' HEAD   # write
git notes --ref=lore show <commit>              # read
git push origin refs/notes/lore                 # share
git fetch origin refs/notes/lore:refs/notes/lore  # fetch
```

Note content per commit:

```json
{
  "v": 1,
  "session_id": "a1b2c3d4-...",
  "timestamp": "2026-04-02T10:30:00Z",
  "interactions": [
    {
      "prompt": "Implement JWT auth middleware",
      "response": "I'll create the middleware with... (truncated at 2000 chars)"
    }
  ],
  "files_in_commit": ["src/auth.ts", "CHANGELOG.md"],
  "files_by_ai": ["src/auth.ts"],
  "ai_ratio": 50
}
```

- **`v`**: Schema version. Always `1` for the current format. Future changes increment this.
- **`ai_ratio`**: Percentage of files in the commit that were touched by AI tools (Edit/Write). Calculated as `files_by_ai.length / files_in_commit.length * 100`, rounded. This is a file-count metric, not a line-count metric. A file counts as "by AI" if any Edit/Write tool use targeted it during the session.
- **`interactions[].response`**: Truncated to 2000 characters. Full responses are available in the local transcript file.

### Why git notes over alternatives

| Approach | Branch pollution | GitHub banner | CI impact | Push/share | Survives clone |
|---|---|---|---|---|---|
| `.git/lore/` files | None | None | None | **No** | **No** |
| Orphan branch | Shows in `git branch` | "Compare & PR" every push | Possible | Yes | Yes |
| **Git notes** | **None** | **None** | **None** | **Yes** | Yes (explicit fetch) |
| Repo files (`.lore/`) | None | None | None | Yes | Yes, but pollutes diff |

Git notes are invisible to branch listings, GitHub UI, and CI — but still pushable and fetchable.

### Commit trailer

Every commit made during an AI session gets a trailer:

```
feat: add auth middleware

Lore-Session: a1b2c3d4-5678-90ab-cdef-111122223333
```

Injected via `PreToolUse` hook (synchronous) by modifying the `git commit` command. Works with plain `git commit` — no need for `lore commit`.

## CLI commands

```
lore enable              add hooks to agent config (commit to share with team)
lore disable             remove hooks from agent config
lore commit [args]       git commit with session context (convenience wrapper)
lore show [commit]       show session details for a commit
lore log [n]             list recent commits with session info
lore pr [base] [--json]  generate report for a PR (markdown or structured JSON)
lore status              show current tracking state
lore hook                handle agent hook events (internal, via stdin)
```

### enable/disable model

`lore enable` writes hooks to the agent's config (e.g., `.claude/settings.json`). Commit this file to share with the team. No per-developer setup after that.

### PR report: data and presentation separated

`lore pr` produces two output formats:

```bash
lore pr                    # markdown (human-readable)
lore pr --json             # structured JSON (for scripts/actions)
lore pr origin/main --json # explicit base branch
```

JSON output structure:

```json
{
  "overall_ai_ratio": 80,
  "total_commits": 5,
  "tracked_commits": 4,
  "total_prompts": 6,
  "commits": [
    {
      "sha": "...",
      "short": "dd4f971",
      "message": "feat: add Button",
      "ai_ratio": 100,
      "prompts_count": 1,
      "files": [{"path": "button.tsx", "by_ai": true}],
      "interactions": [{"prompt": "...", "response": "..."}]
    }
  ]
}
```

## GitHub Action

### Usage

```yaml
- uses: wasabeef/lore@v1
  id: lore
  with:
    base: main

# Use structured outputs
- run: echo "AI ratio: ${{ steps.lore.outputs.overall_ai_ratio }}%"
- if: fromJSON(steps.lore.outputs.json).overall_ai_ratio > 90
  run: echo "::warning::High AI ratio — consider extra review"
```

### Action inputs

| Input | Default | Description |
|---|---|---|
| `base` | PR base branch | Base branch to compare against |
| `comment` | `"true"` | Post markdown report as PR comment |

### Action outputs

| Output | Type | Description |
|---|---|---|
| `overall_ai_ratio` | number | PR-wide AI ratio (0-100) |
| `tracked_commits` | number | Commits with lore data |
| `total_commits` | number | Total commits in PR |
| `total_prompts` | number | Total prompts across all commits |
| `json` | string | Full structured report (use with `fromJSON()`) |
| `markdown` | string | Rendered markdown report |

Each commit's data is available inside the `json` output — per-commit AI ratio, file-level attribution, full prompt-response interactions.

### Action internals

The action is a thin wrapper:

1. `git fetch origin refs/notes/lore:refs/notes/lore`
2. `npx @wasabeef/lore pr --json` → parse outputs
3. `npx @wasabeef/lore pr` → markdown
4. Set GitHub Actions outputs
5. Optionally post markdown as PR comment (with `<!-- lore-pr-report -->` marker for idempotent updates)

Dependencies (`@actions/core`, `@actions/github`) are bundled with `ncc` into a single `dist/index.js` that is committed to the repo. No `npm install` needed at runtime.

## Distribution

```
CLI:    npx @wasabeef/lore enable          (or npm install --save-dev)
Action: uses: wasabeef/lore@v1             (Marketplace)
```

### Team workflow

```bash
# 1. Enable lore (one person, once)
npx @wasabeef/lore enable
git add .claude/settings.json
git commit -m "chore: enable lore"
git push

# 2. Everyone works normally — hooks fire automatically

# 3. Share session data
git push origin refs/notes/lore

# 4. Add the action to CI (one person, once)
# Copy .github/workflows/lore-pr-report.yml to your repo
# Or add `uses: wasabeef/lore@v1` to an existing workflow
```

## Constraints

- **Zero runtime dependencies for CLI.** Only devDependencies. The action has its own deps (`@actions/core`, `@actions/github`), bundled with ncc.
- **Git CLI only.** All git operations via `execFile("git", ...)`. No git libraries.
- **Never break git commit.** All recording wrapped in try/catch. Errors are logged to stderr, never block the commit.
- **All source in English.** Comments, output, tests.
- **PreToolUse is synchronous.** Must write JSON to stdout, must not be `async: true`.
- **No telemetry, no auth, no external services.** Data stays local unless explicitly pushed via `git push origin refs/notes/lore`.
- **Input validation.** Session IDs must match `/^[0-9a-f-]{36}$/` (UUID v4). `transcript_path` must be under `~/.claude/` (or agent equivalent). Reject anything else silently.
- **Response truncation.** AI responses stored in notes are truncated to 2000 characters to prevent git notes bloat.

## Security

### Threat model

Lore records prompts and AI responses. This data may contain sensitive information:

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
| GitHub Action markdown injection | PR comment body must sanitize prompts that contain markdown/HTML. Image tags and links from untrusted prompts are escaped. |
| `npx --yes` supply chain | Hook command tries local binary first (`$(npm bin)/lore`, then `lore` in PATH), falls back to `npx` only as last resort. Pin versions in production. |
| Fork PR attacks | The GitHub Action should not run on `pull_request_target` with fork PRs. Default trigger is `pull_request` which is safe. |

### Recommendations for users

- **Do not push `refs/notes/lore` to public repositories** unless you are comfortable with prompts being visible.
- Use `lore pr --json | jq '.commits[].interactions[].prompt'` to review what will be shared before pushing.
- Consider `lore enable --no-responses` (future) to record prompts only, without AI responses.

## Known limitations

### git notes and rebase

When commits are rebased (interactive rebase, squash, fixup), their SHA changes. Git notes are keyed by SHA, so **notes become orphaned** after rebase.

Mitigation: configure git to copy notes on rewrite:

```bash
git config notes.rewriteRef refs/notes/lore
git config notes.rewrite.rebase true
git config notes.rewrite.amend true
```

`lore enable` should set these automatically (planned).

### Squash merge

GitHub's "Squash and merge" creates a new commit with a new SHA. All notes from the individual PR commits are lost on the merge commit. The PR report is only meaningful **before merge**.

Workaround: the GitHub Action posts the report as a PR comment before merge, preserving the data in the PR conversation.

### Clone does not include notes

`git clone` does not fetch notes by default. Team members must explicitly fetch:

```bash
git fetch origin refs/notes/lore:refs/notes/lore
```

Or configure automatic fetch:

```bash
git config --add remote.origin.fetch '+refs/notes/lore:refs/notes/lore'
```

### Push conflicts

If multiple developers push notes simultaneously, non-fast-forward pushes are rejected. Resolve with:

```bash
git fetch origin refs/notes/lore:refs/notes/lore
git notes --ref=lore merge origin/notes/lore
git push origin refs/notes/lore
```

In practice, notes conflicts are rare because each developer writes to different commit SHAs.

### Concurrent sessions

If multiple Claude Code sessions run in the same repo simultaneously, `.git/lore/session` (the active session pointer) may be overwritten by the last writer. Session-specific data in `.git/lore/sessions/<id>/` is isolated and safe. The trailer injection uses the event's session ID directly (not the file), so trailers are always correct.

### ai_ratio is file-count based

A 1-line AI edit to a 10,000-line file counts the same as a fully AI-written 5-line file. This is a known simplification. Line-count based measurement is a future consideration but adds complexity (requires diffstat parsing).

## Multi-agent extensibility

Lore supports Claude Code today, but the `agents/` + `core/` split makes adding agents straightforward.

### What varies per agent

| Concern | Claude Code | Cursor | Gemini CLI |
|---|---|---|---|
| Config file | `.claude/settings.json` | `.cursor/hooks.json` | `.gemini/settings.json` |
| Hook events | `SessionStart`, `Stop`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit` | `sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `stop` | TBD |
| Transcript location | `~/.claude/projects/<hash>/sessions/<uuid>.jsonl` | `~/.cursor/sessions/` | `~/.gemini/sessions/` |
| Commit detection | `PreToolUse` + `Bash(git commit *)` | `beforeSubmitPrompt` | TBD |
| Response format | `{type:"assistant", message:{content:[{type:"text"}]}}` | Different | Different |

### What stays the same (`core/`)

- Git notes storage (`refs/notes/lore`)
- Entry data structure (interactions, ai_ratio, files)
- JSONL append and rotation
- Display commands (show, log, pr, status)
- Commit trailer (`Lore-Session`)
- GitHub Action (agent-agnostic — reads git notes)

### AgentAdapter interface

```typescript
// packages/cli/src/agents/types.ts

interface HookInput {
  raw: string;       // stdin JSON from the agent
  sync: boolean;     // true for PreToolUse (must write to stdout), false for async hooks
}

interface NormalizedEvent {
  kind: "session_start" | "stop" | "prompt" | "file_change" | "pre_commit" | "post_commit";
  sessionId: string;
  timestamp: string;
  prompt?: string;
  response?: string;
  file?: string;
  tool?: string;
  commitCommand?: string;
  transcriptPath?: string;
  model?: string;
}

interface AgentAdapter {
  name: string;
  settingsRelPath: string;

  /** Add lore hooks. Idempotent — safe to call multiple times. Replaces legacy formats. */
  installHooks(repoRoot: string): Promise<void>;

  /** Remove lore hooks. Idempotent — no-op if not installed. Removes both current and legacy formats. */
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
3. `lore enable --agent <name>` calls `adapter.installHooks()`
4. `lore hook` detects agent from event payload or `--agent` flag
5. All core logic and the GitHub Action work unchanged

## entire.io comparison

| Aspect | entire.io | lore |
|---|---|---|
| Setup | CLI install + `entire enable` + login | `npx lore enable` + commit settings |
| Storage | Orphan branch `entire/checkpoints/v1` | **Git notes** `refs/notes/lore` |
| Branch pollution | Shadow branches + checkpoint branch | **None** |
| Transcript | Full copy per checkpoint (O(n²) bloat) | **Reference only** (pointer in note) |
| Git hooks | Overwrites `.git/hooks/` | **Agent hooks only** (e.g., `.claude/settings.json`) |
| CI impact | `entire@local` author breaks Vercel | **None** |
| GitHub UI | "Compare & PR" banner on every push | **None** (notes are invisible) |
| Dependencies | go-git, gitleaks, PostHog, entire.io auth | **Zero** (CLI), ncc-bundled (action) |
| Performance | Sync hooks, 2min 44s commit | **Async hooks** (except PreToolUse) |
| Team sharing | Auto-push checkpoint branch | **Explicit** `git push origin refs/notes/lore` |
| PR integration | None built-in | **GitHub Action** with structured outputs |
