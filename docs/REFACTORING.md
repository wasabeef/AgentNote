# Refactoring Plan

Status as of v0.2.0 — 19 source files, 10 test files, ~2,800 LOC.

All phases (A–D) implemented. See execution log below for details.

## Execution order

Each step is an independent commit. Structure-only changes (formatting, config) are separated from behavior changes.

### Phase A: Foundation (no behavior change)

| Step | Source | What | Commit type | Depends on |
|---|---|---|---|---|
| A-1 | P1 | tsconfig → ES2023 / NodeNext | `chore: modernize tsconfig to ES2023/NodeNext` | — |
| A-2 | P1 | Add `packages/action/tsconfig.json` | `chore: add action tsconfig` | — |
| A-3 | P1 | Root `package.json` (engines, packageManager, workspaces) | `chore: add root package.json metadata` | — |
| A-4 | P5 | Add `.editorconfig` | `chore: add editorconfig` | — |

A-1 through A-4 are independent — can be done in any order or combined.

### Phase B: Tooling (no behavior change)

| Step | Source | What | Commit type | Depends on |
|---|---|---|---|---|
| B-1 | P5 | Install Biome, add `biome.json` | `chore: add biome configuration` | — |
| B-2 | P5 | `biome check --write src/` — auto-fix formatting | `style: apply biome formatting` | B-1 |
| B-3 | P5 | Manual fixes for remaining Biome diagnostics | `style: fix biome lint warnings` | B-2 |
| B-4 | P5 | Update `package.json` scripts (lint → biome, typecheck → tsc) | `chore: split lint and typecheck scripts` | B-2 |
| B-5 | P5 | Update CI workflow to run both lint + typecheck | `ci: add biome check to CI pipeline` | B-4 |
| B-6 | P5 | Install knip, add `knip.json`, verify no false positives | `chore: add knip for unused code detection` | — |
| B-7 | P5 | Install publint, add to `prepublishOnly` | `chore: add publint to prepublish validation` | — |
| B-8 | P5 | Add `renovate.json` | `chore: add renovate configuration` | — |

B-1 → B-5 are sequential (Biome pipeline). B-6, B-7, B-8 are independent of each other.

### Phase C: Code quality (behavior change)

| Step | Source | What | Commit type | Depends on |
|---|---|---|---|---|
| C-1 | P2 | Extract `core/record.ts` from hook.ts + commit.ts | `refactor: extract shared recordEntry to core/record` | — |
| C-2 | P2 | Update hook.ts → call `core/record.ts` | (included in C-1) | C-1 |
| C-3 | P2 | Update commit.ts → call `core/record.ts` | (included in C-1) | C-1 |
| C-4 | P7 | Harness Phase 1: Stop hook → run tests (async) | `chore: add test-on-stop harness hook` | — |
| C-5 | P7 | Harness Phase 2: PreToolUse → typecheck before commit (sync) | `chore: add typecheck-before-commit hook` | B-4 |
| C-6 | P7 | Harness Phase 3: PostToolUse → biome lint (async) | `chore: add biome-on-edit harness hook` | B-1 |

C-1 is the only behavior change — test thoroughly. C-4/C-5/C-6 are config-only (`.claude/settings.json`).

### Phase D: Feature work (future)

| Step | Source | What | Depends on |
|---|---|---|---|
| D-1 | P3 | Design causal turn ID scheme | — |
| D-2 | P3 | Implement turn ID in hook event capture | D-1 |
| D-3 | P3 | Schema v2 with `files_touched` per interaction | D-2 |
| D-4 | P4 | Session aggregation command + cache | — |
| D-5 | P6 | PR output: per-prompt file attribution | D-3 |
| D-6 | P6 | PR output: collapsible per-commit details | D-3 |

D-1 requires design decision on turn ID source. D-4 is independent.

### Validation gates

- After Phase A: `npm run build && npm test` must pass (no behavior change)
- After Phase B: `npm run lint && npm run typecheck && npm test` must all pass
- After Phase C: `npm test` must pass, `agentnote show` output unchanged for existing notes
- After each step: `git diff --stat` to confirm scope matches the commit description

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

**Do NOT use timestamp-based attribution.** Async hooks generate local timestamps at parse time, not at the time Claude actually produced the event. Under delayed execution or concurrent edits, timestamp order diverges from actual causality, producing permanently wrong `files_touched` data.

Instead, use a **causal turn ID**:

1. Each `UserPromptSubmit` event generates or receives a turn identifier
2. Subsequent `PostToolUse` (Edit/Write) events inherit the current turn ID
3. At commit time, group file changes by turn ID and attach to the corresponding interaction

The turn ID can come from:
- Claude Code's `transcript_path` entries (each user message has a `uuid`)
- A counter incremented on each `UserPromptSubmit` hook
- The agent's native turn/request ID if available in the event payload

Schema version bump: `v: 2`. Readers must handle both v1 and v2.

## Priority 4: Session aggregation

Add `agentnote session <id>` to view all commits from a single session.

Currently each commit's note is independent. To list all commits from a session:

```bash
git log --format="%H" | while read sha; do
  git notes --ref=agentnote show "$sha" 2>/dev/null | jq -r '.session_id'
done
```

This is O(n) over all commits. For better performance, a session index can be maintained as a cache.

**Important**: Any session index must be treated as a **rebuildable cache**, not source of truth. Git notes are SHA-keyed, and amend/rebase/squash rewrites SHAs. An append-only index will accumulate stale references to commits that no longer exist in the visible history.

Design:
- Derive session membership from commit trailers/notes at read time
- Cache opportunistically in `.git/agentnote/cache/sessions.json`
- Invalidate on `git reflog` changes or rebuild on demand (`agentnote session --rebuild`)

## Priority 5: Tooling and DX

### Biome (lint + format)

Replace `tsc --noEmit` as the sole lint with [Biome](https://biomejs.dev/). Single Rust binary, ~5ms startup, covers lint + format. No plugin ecosystem needed for this project's scope.

**Why Biome over ESLint + Prettier**: 10-50x faster, single config file, single binary, zero JS deps. ESLint v9 flat config migration + Prettier coordination is unnecessary overhead for 24 source files.

**Why not oxlint**: Still experimental (v0.x), no formatter, fewer rules. Biome is stable and covers both lint + format.

```bash
cd packages/cli
npm install --save-dev --save-exact @biomejs/biome
npx biome init
```

#### biome.json

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": { "recommended": true },
      "suspicious": { "recommended": true },
      "performance": { "recommended": true },
      "nursery": { "all": false }
    }
  },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always"
    }
  },
  "files": {
    "ignore": ["dist/", "node_modules/", "*.json"]
  }
}
```

`nursery` rules are unstable — disable all to avoid false positives and CI churn.

#### package.json scripts

```json
{
  "scripts": {
    "lint": "biome check src/",
    "lint:fix": "biome check --write src/",
    "format": "biome format --write src/",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsc --noEmit` remains as `typecheck` — Biome does not type-check.

#### CI integration

Update `.github/workflows/ci.yml` lint job:

```yaml
- run: npm -w packages/cli run lint      # biome check
- run: npm -w packages/cli run typecheck # tsc --noEmit
```

Both must pass. Biome catches style/correctness issues. tsc catches type errors.

#### Migration checklist

1. Install Biome, run `biome check src/` — fix all auto-fixable issues with `--write`
2. Review remaining diagnostics manually (expect ~5-15 issues on 2500 LOC)
3. Commit formatting changes as a **structure-only** commit (no behavior change)
4. Update CI to run both `lint` and `typecheck`
5. Remove `lint: tsc --noEmit` — rename to `typecheck`

### knip (unused code detection)

[knip](https://knip.dev/) detects unused exports, dependencies, and files. Useful for a monorepo where `packages/cli` and `packages/action` have separate dependency boundaries.

```bash
npm install --save-dev knip
```

Add `knip.json` to repo root:

```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "workspaces": {
    "packages/cli": {
      "entry": ["src/cli.ts"],
      "project": ["src/**/*.ts"]
    },
    "packages/action": {
      "entry": ["src/index.ts"],
      "project": ["src/**/*.ts"]
    }
  }
}
```

Run in CI as non-blocking initially:

```json
{
  "scripts": {
    "knip": "knip"
  }
}
```

### publint (package publishing validation)

[publint](https://publint.dev/) validates `package.json` exports, types, and main fields before publish. Catches broken package configurations that consumers would hit.

```bash
npm install --save-dev publint
```

Add to `prepublishOnly`:

```json
{
  "scripts": {
    "prepublishOnly": "npm run build && publint"
  }
}
```

Zero config. Fails if the package would break for consumers.

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

Zero cost. Ensures consistent formatting across any editor without Biome.

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
            "command": "cd packages/cli && npx biome check src/",
            "async": true
          }
        ]
      }
    ]
  }
}
```

**Note**: Checking all of `src/` is simpler and safer than trying to pass individual changed files via `xargs`. On a 2500 LOC codebase, Biome completes in ~5ms regardless — file-level targeting adds shell complexity (null delimiter handling, empty input edge cases) for no measurable gain.

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
| oxlint | Experimental (v0.x), no formatter. Biome covers both lint + format |
| Jest | `node:test` works. 32 tests pass. No migration benefit |
| tsdown / unbuild | esbuild is stable and fast. tsdown is v0.x, re-evaluate at 1.0 |
| lefthook / husky | Claude Code hooks already run lint/test. Git hooks would duplicate |
| Bun | `node:test` + tsx works. Bun adds runtime divergence risk for no gain |
| Rewind / Resume | Git + Claude Code handle this natively |
| Secret redaction | Only needed for public repo notes push |
| Token usage tracking | Useful but low demand |
| Working tree snapshots | Git already does this |
| Multi-agent (Cursor, Gemini) | Wait for second agent before abstracting |
