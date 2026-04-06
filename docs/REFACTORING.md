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

## Priority 5: Lint and formatting

Current lint is `tsc --noEmit` only. Options:

| Tool | Pros | Cons |
|---|---|---|
| Biome | Fast, single binary, lint + format | New devDependency |
| ESLint + Prettier | Industry standard | Multiple deps, slow |
| `tsc --noEmit` only (current) | Zero deps | No style enforcement, no unused import detection |

Recommendation: Add Biome as a single devDependency. It replaces both ESLint and Prettier with one tool and ~5ms startup.

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

## Not planned

| Item | Reason |
|---|---|
| Rewind / Resume | Git + Claude Code handle this natively |
| Secret redaction | Only needed for public repo notes push |
| Token usage tracking | Useful but low demand |
| Working tree snapshots | Git already does this |
| Multi-agent (Cursor, Gemini) | Wait for second agent before abstracting |
