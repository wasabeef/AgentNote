# Refactoring Plan

Status as of v0.1.5 — 17 source files, 8 test files, 2,534 LOC.

## Priority 1: Config modernization

### tsconfig

```diff
- "target": "ES2022",
- "module": "Node16",
- "moduleResolution": "Node16",
+ "target": "ES2023",
+ "module": "NodeNext",
+ "moduleResolution": "NodeNext",
```

Node 20+ is the minimum. ES2023 enables `Array.findLast`, `Hashbang` grammar. `NodeNext` is the recommended replacement for `Node16`.

### Root package.json

```json
{
  "private": true,
  "packageManager": "npm@10.9.0",
  "engines": {
    "node": ">=20"
  },
  "workspaces": [
    "packages/cli",
    "packages/action"
  ]
}
```

### Action tsconfig

`packages/action/tsconfig.json` — currently missing. ncc works without it but type checking is impossible.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

## Priority 2: Code deduplication

### commit.ts and hook.ts share recordEntry logic

Both files build an entry and write it as a git note. `commit.ts` is a manual path, `hook.ts` is the automatic path. They diverge slightly:

- `hook.ts` reads transcript for responses
- `commit.ts` also reads transcript (added later)
- Both call `readJsonlField`, `buildEntry`, `writeNote`, `rotateLogs`

Extract shared logic into `core/record.ts`:

```typescript
// core/record.ts
export async function recordCommitEntry(opts: {
  agentnoteDirPath: string;
  sessionId: string;
  transcriptPath?: string;
  adapter: AgentAdapter;
}): Promise<{ promptCount: number; aiRatio: number }>
```

Both `commit.ts` and `hook.ts` call this single function.

### Files affected

- `packages/cli/src/core/record.ts` — new
- `packages/cli/src/commands/hook.ts` — simplify `recordEntry()` → call `core/record.ts`
- `packages/cli/src/commands/commit.ts` — simplify → call `core/record.ts`

## Priority 3: Interaction ↔ file attribution

Current data model links interactions and files to the commit but not to each other. No way to know which prompt caused which file change.

### Current

```json
{
  "interactions": [
    { "prompt": "add auth", "response": "..." },
    { "prompt": "add tests", "response": "..." }
  ],
  "files_by_ai": ["src/auth.ts", "src/auth.test.ts"]
}
```

### Target

```json
{
  "interactions": [
    {
      "prompt": "add auth",
      "response": "...",
      "files_touched": ["src/auth.ts"]
    },
    {
      "prompt": "add tests",
      "response": "...",
      "files_touched": ["src/auth.test.ts"]
    }
  ],
  "files_by_ai": ["src/auth.ts", "src/auth.test.ts"]
}
```

### Implementation

Track timestamps in `prompts.jsonl` and `changes.jsonl`. At commit time, assign each file change to the most recent preceding prompt based on timestamp ordering.

Schema version bump: `v: 2`. Readers must handle both v1 and v2.

## Priority 4: Session aggregation

Add `agentnote session <id>` to view all commits from a single session.

Currently each commit's note is independent. To list all commits from a session:

```bash
git log --format="%H" | while read sha; do
  git notes --ref=agentnote show "$sha" 2>/dev/null | jq -r '.session_id'
done
```

This is O(n) over all commits. For better performance, maintain a session index in a separate note or in `.git/agentnote/sessions/<id>/commits.json`.

## Priority 5: Tooling and DX

### Biome (lint + format)

Replace `tsc --noEmit` as the sole lint with Biome. Single binary, ~5ms startup, covers lint + format.

```bash
npm install --save-dev --save-exact @biomejs/biome
npx biome init
```

Add to CI:

```json
{
  "scripts": {
    "lint": "biome check src/",
    "format": "biome format --write src/",
    "typecheck": "tsc --noEmit"
  }
}
```

### .editorconfig

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

Zero cost. Ensures consistent formatting across any editor.

### Renovate

Auto-update devDependencies. Add `renovate.json` to repo root:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"]
}
```

Enable the Renovate GitHub App on the repo. PRs are created automatically for dependency updates.

## Priority 6: PR output improvements

### Chat format: per-prompt file attribution

Once Priority 3 is done, the chat output can show which files each response modified:

```markdown
> **🧑 Prompt**
> Add auth middleware

**🤖 Response** — `src/auth.ts`

I'll create the middleware...
```

### Markdown format: collapsible per-commit details

Same as chat format but in the table view — each row expands to show prompt/response.

## Priority 7: Claude Code harness hooks

Add hooks to `.claude/settings.json` so Claude Code automatically runs lint, typecheck, and tests at the right moments. This enforces quality without requiring manual discipline.

### PostToolUse: auto-lint on file changes

Run Biome check after every Edit/Write to catch issues immediately:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx biome check --no-errors-on-unmatched $(git diff --name-only HEAD)",
            "async": true
          }
        ]
      }
    ]
  }
}
```

### PreToolUse: typecheck before git commit

Catch type errors before they reach the commit:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(*git commit*)",
            "command": "cd packages/cli && npx tsc --noEmit"
          }
        ]
      }
    ]
  }
}
```

If typecheck fails (exit code != 0), the commit is blocked with feedback to Claude.

### Stop: run tests after each turn

Run the test suite after Claude finishes responding. Non-blocking (async), but results feed into the next prompt:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd packages/cli && npm test 2>&1 | tail -5",
            "async": true
          }
        ]
      }
    ]
  }
}
```

### Combined settings.json

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "npx --yes @wasabeef/agentnote hook", "async": true }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "npx --yes @wasabeef/agentnote hook", "async": true }] },
      { "hooks": [{ "type": "command", "command": "cd packages/cli && npm test 2>&1 | tail -5", "async": true }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "npx --yes @wasabeef/agentnote hook", "async": true }] }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "if": "Bash(*git commit*)", "command": "npx --yes @wasabeef/agentnote hook" },
          { "type": "command", "if": "Bash(*git commit*)", "command": "cd packages/cli && npx tsc --noEmit" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit|Bash",
        "hooks": [{ "type": "command", "command": "npx --yes @wasabeef/agentnote hook", "async": true }]
      }
    ]
  }
}
```

### Harness progression

Start simple, add gates incrementally:

| Phase | Hook | What | Blocking |
|---|---|---|---|
| 1 | Stop (async) | Run tests after each turn | No |
| 2 | PreToolUse (sync) | Typecheck before commit | Yes — blocks commit if types fail |
| 3 | PostToolUse (async) | Biome lint after edit | No — feedback only |
| 4 | PreToolUse (sync) | Tests before commit | Yes — blocks commit if tests fail |

Phase 1 alone gives fast feedback. Phase 2 prevents broken commits. Phase 3-4 add strictness as confidence grows.

## Not planned

| Item | Reason |
|---|---|
| ESLint | Biome replaces it. Fewer deps, faster, single config |
| Prettier | Biome replaces it |
| Jest | `node:test` works. 32 tests pass. No migration benefit |
| Rewind / Resume | Git + Claude Code handle this natively |
| Secret redaction | Only needed for public repo notes push |
| Token usage tracking | Useful but low demand |
| Working tree snapshots | Git already does this |
| Multi-agent (Cursor, Gemini) | Wait for second agent before abstracting |
