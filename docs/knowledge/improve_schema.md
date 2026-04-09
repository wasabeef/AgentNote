# Schema Improvement Plan

## Context

agentnote is **pre-release** (v0.1.x). No external consumers or published schema contracts. Schema version stays at `v: 1`. This is a destructive one-shot restructure: all readers and writers are updated atomically in a single PR. Old git notes from dev/test are discarded (no migration).

**Deployment model**: The GitHub Action currently shells out to `npx --yes @wasabeef/agentnote` at runtime (`packages/action/src/index.ts:22,48`), which can install a different CLI version than expected. **This must be fixed as part of the schema restructure** — the action should import the CLI directly (already ncc-bundled into `dist/index.js`) instead of using npx. This eliminates version skew between action and CLI.

### Acknowledged Risks (accepted for pre-release)

1. **Old notes become unreadable**: `agentnote show` on pre-restructure notes will show missing/empty fields. Accepted — no production data exists. Dev/test notes can be cleared with `git notes --ref=agentnote prune` or ignored.
2. **No version signal for shape change**: `v: 1` is reused for both old and new shapes. Accepted because there is no installed base reading old notes. If external consumers appear before 1.0, we will bump to `v: 2` at that point.
3. **Mixed-method rollup instability**: addressed below with per-method aggregation improvement.

## Current Schema (v1 flat)

```json
{
  "v": 1,
  "session_id": "uuid",
  "timestamp": "ISO-8601",
  "interactions": [
    { "prompt": "...", "response": "...|null", "files_touched": ["..."] }
  ],
  "files_in_commit": ["..."],
  "files_by_ai": ["..."],
  "ai_ratio": 100,
  "ai_added_lines": 31,
  "total_added_lines": 31,
  "deleted_lines": 7
}
```

**Issues**:
- Line-level fields scattered at root
- `files_in_commit` and `files_by_ai` are parallel arrays
- No separation between session context and commit analysis

## Cross-Agent Data Availability

### Hook System Availability

| Agent | Hook System | Status |
|---|---|---|
| **Claude Code** | PreToolUse, PostToolUse, SessionStart, Stop, UserPromptSubmit | GA |
| **Cursor** | beforeShellExecution, afterFileEdit, beforeSubmitPrompt, stop | Beta |
| **Gemini CLI** | BeforeAgent, AfterAgent, BeforeModel, BeforeTool, AfterTool | GA (v0.26+) |
| **Codex CLI** | SessionStart, Stop, UserPromptSubmit, PreToolUse, PostToolUse | Beta |
| **GitHub Copilot** | sessionStart, userPromptSubmitted, preToolUse, postToolUse | Preview |

### Field Availability Matrix

| Field | Claude Code | Cursor | Gemini CLI | Codex CLI | GitHub Copilot | Feasibility |
|---|---|---|---|---|---|---|
| **session_id** | ✅ | ✅ | ✅ | ✅ | ✅ | **Universal** |
| **model** | ✅ SessionStart | ❌ | ✅ AfterAgent | ❌ | ❌ | **Partial** (2/5) |
| **file-edit tools** | ✅ `tool_name` | ⚠️ Event type | ✅ `tool_name` | ❌ | ✅ `toolName` | **High** (3-4/5) |
| **token_usage** | ❌ hook / ⚠️ transcript | ❌ | ✅ `usageMetadata` | ❌ | ❌ | **Low** (1/5) |
| **prompt** | ✅ | ✅ | ✅ | ✅ | ✅ | **Universal** |
| **file changes** | ✅ | ✅ | ✅ | ⚠️ Bash only | ✅ | **High** (4/5) |
| **tool_use_id** | ✅ | ❌ | ❌ | ✅ | ✅ | **Partial** (3/5) |

### Feasibility Verdict

| Field | Verdict | Rationale |
|---|---|---|
| **`interactions[].tools`** | ✅ **Add** | 3-4/5 agents. Scoped to **file-edit tools only** (Edit, Write, NotebookEdit). Non-file tools like Bash/Read are excluded — see rationale below. |
| **`model`** | ✅ **Add** | Available from Claude Code SessionStart. Root field, nullable for agents that don't expose it. |
| **`token_usage`** | ❌ **Defer** | 1/5 agents. |

## Proposed Schema (v1 restructured)

```json
{
  "v": 1,
  "session_id": "uuid",
  "timestamp": "ISO-8601",
  "model": "claude-sonnet-4-20250514",   // string | null — null for agents that don't expose it

  "interactions": [
    {
      "prompt": "Implement auth middleware",
      "response": "I'll create the middleware...",
      "files_touched": ["src/auth.ts"],
      "tools": ["Edit"]              // string[] | null — null when telemetry unavailable
    }
  ],

  "files": [
    { "path": "src/auth.ts", "by_ai": true },
    { "path": "README.md", "by_ai": false }
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

### Changes from Current

| Before | After | Rationale |
|---|---|---|
| `files_in_commit[]` + `files_by_ai[]` | `files: [{path, by_ai}]` | Single array, no cross-reference. Extensible per-file. |
| `ai_ratio`, `ai_added_lines`, `total_added_lines`, `deleted_lines` | `attribution: {ai_ratio, method, lines}` | Grouped. `method` makes measurement explicit. |
| No tool tracking | `interactions[].tools: string[]` | Per-interaction file-edit tool provenance. |

### `attribution.method`

- `"line"` — blob-based 3-diff position attribution. `lines` sub-object present, `lines.total_added > 0`.
- `"file"` — binary file-count ratio. No `lines` sub-object.
- `"none"` — deletion-only commit (`total_added === 0`). No valid line or file ratio. `ai_ratio` is `0` (numeric, for backward compatibility). `lines` may be present with `total_added: 0` for deletion stats.

**Deletion-only commits**: `method: "none"`. Not `"file"` — they are explicitly non-ratio-eligible.

### `interactions[].tools`

**Scope: file-edit tools only.** Records which tools modified files during each interaction.

Values: `"Edit"`, `"Write"`, `"NotebookEdit"` (adapter-normalized).

**Why not all tools (Bash, Read, etc.)?**
Per Codex review: the current telemetry pipeline only tracks file-changing tool events in `changeEntries`. Non-file tools (Bash, Read, Search) are not recorded. Adding them would require a separate tool-use log at hook time, which is a larger infrastructure change. By scoping to file-edit tools, `interactions[].tools` is consistent with `files_touched` — both are derived from the same `changeEntries` data, grouped by turn.

**Telemetry encoding**:
- `tools: ["Edit", "Write"]` — file-edit tool events recorded for this interaction
- `tools: null` — no file-edit tool data available (adapter unsupported, or no events recorded)

**There is no empty array `[]` state.** The current async hook pipeline cannot guarantee completeness (a dropped PostToolUse is indistinguishable from "no tools used"), so `[]` would overstate confidence. Instead:
- Tools observed → `["Edit"]`, `["Write", "Edit"]`, etc.
- No tools observed or adapter unsupported → `null`

`null` intentionally collapses multiple states (adapter unsupported, no events observed, telemetry lost) into a single "data not available" value. This is an accepted simplification — distinguishing these states would require a `tools_status` field, which adds complexity without practical benefit at this stage. If analytics later require finer granularity, `tools_status: "unsupported" | "partial" | "complete"` can be added alongside `tools`.

This may undercount tool usage (a dropped event shows as `null`) but never overcounts or falsely claims "no tools used".

Cross-agent:
- Claude Code: `["Edit", "Write"]` — full telemetry
- Cursor: `["Edit"]` — from `afterFileEdit` events
- Gemini CLI: adapter normalizes from AfterTool file events
- Codex CLI: `null` — no file-edit events exposed yet

### `files` Array

Replaces parallel `files_in_commit` / `files_by_ai` lists.

```json
"files": [
  { "path": "src/auth.ts", "by_ai": true },
  { "path": "README.md", "by_ai": false }
]
```

**`by_ai` definition**: a file is `by_ai: true` if any AI tool (Edit/Write/NotebookEdit) was used on it during the session turns relevant to this commit. This is a binary signal — it does NOT indicate what fraction of the file's changes are AI-authored. For `method: "line"` commits, a file can be `by_ai: true` even if only 1 of 100 added lines was AI-written. For `method: "file"` commits, the same definition applies. This binary flag is the only file-level AI signal available for cross-method aggregation.

Extensible: future `files[].ai_added_lines`, `files[].tools`.

### Mixed-Method Aggregation Contract

PR and session rollups use one canonical algorithm. No ambiguity.

**Single normative algorithm:**

```typescript
// Step 1: Partition commits by method
// Strict line eligibility: method=line AND total_added > 0
const lineEligible = tracked.filter(c =>
  c.attribution.method === "line" && c.attribution.lines.total_added > 0
);
const fileOnly = tracked.filter(c => c.attribution.method === "file");
const eligible = [...lineEligible, ...fileOnly];
const excluded = tracked.filter(c => c.attribution.method === "none"); // deletion-only

// Step 2: Determine overall method
let overallMethod: "line" | "file" | "mixed" | "none";
if (tracked.length > 0 && excluded.length === tracked.length) {
  overallMethod = "none"; // every tracked commit is deletion-only
} else if (eligible.length === 0) {
  overallMethod = "none"; // no eligible commits at all (empty or all unknown)
} else if (fileOnly.length === 0 && lineEligible.length > 0) {
  overallMethod = "line";
} else if (lineEligible.length === 0) {
  overallMethod = "file";
} else {
  overallMethod = "mixed"; // both line and file commits present
}

// Step 3: Compute ratio (always numeric for backward compatibility)
let overallRatio: number;
if (overallMethod === "line") {
  const aiAdded = sum(lineEligible, "lines.ai_added");
  const totalAdded = sum(lineEligible, "lines.total_added");
  overallRatio = totalAdded > 0 ? Math.round(aiAdded / totalAdded * 100) : 0;
} else if (overallMethod === "file") {
  const filesAi = sum(fileOnly, "files.filter(by_ai).length");
  const filesTotal = sum(fileOnly, "files.length");
  overallRatio = filesTotal > 0 ? Math.round(filesAi / filesTotal * 100) : 0;
} else {
  // "mixed" or "none": weight each commit by its size (files count)
  const weightedSum = eligible.reduce((s, c) =>
    s + c.attribution.ai_ratio * c.files.length, 0);
  const weightTotal = eligible.reduce((s, c) => s + c.files.length, 0);
  overallRatio = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
}
```

**Rules (normative, no exceptions):**

1. `method: "none"` commits are **excluded** from all ratio calculations. They appear in output but don't contribute to `overallRatio`.
2. `overallMethod: "line"` = all eligible commits have `method: "line"`. Ratio is weighted `sum(ai_added) / sum(total_added)`.
3. `overallMethod: "file"` = all eligible commits have `method: "file"`. Ratio is `sum(files_ai) / sum(files_total)`.
4. `overallMethod: "mixed"` = both line and file commits present. `overall_ai_ratio` = weighted average of per-commit `ai_ratio` (best-effort approximation). `overall_method: "mixed"` signals precision-sensitive consumers to use per-commit data instead.

**Machine-readable output:**

```json
// Example: mixed branch (line + file commits) — best-effort average
{
  "overall_ai_ratio": 60,
  "overall_method": "mixed",
  "coverage": {
    "total_commits": 10,
    "tracked_commits": 8,
    "line_commits": 5,
    "file_commits": 2,
    "excluded_commits": 1
  }
}

// Example: pure line branch
{
  "overall_ai_ratio": 73,
  "overall_method": "line",
  "coverage": { "total_commits": 5, "tracked_commits": 5, "line_commits": 5, "file_commits": 0, "excluded_commits": 0 }
}

// Example: all deletion-only — 0% (no additions to attribute)
{
  "overall_ai_ratio": 0,
  "overall_method": "none",
  "coverage": { "total_commits": 3, "tracked_commits": 3, "line_commits": 0, "file_commits": 0, "excluded_commits": 3 }
}
```

- `overall_ai_ratio`: **always numeric (0-100)** — maintains backward compatibility with `fromJSON(...).overall_ai_ratio > 90`. For mixed/none: weighted average of per-commit `ai_ratio` (best-effort).
- `overall_method`: `"line"` | `"file"` | `"mixed"` | `"none"` — tells consumers which algorithm produced the ratio. New field.
- `coverage.excluded_commits`: `method: "none"` commits (deletion-only). **Excluded from ratio calculation** — they do not contribute to `overall_ai_ratio`.

Both `pr.ts` and `session.ts` will implement this exact algorithm as part of the restructure PR. The current code uses a simpler `allHaveLineData` check — this plan supersedes it.

## Agent-Specific Notes

### Cursor Adapter
- No PreToolUse for file edits → `attribution.method: "file"` only
- `interactions[].tools`: `["Edit"]` when `afterFileEdit` observed; `null` otherwise (no completeness signal — cannot distinguish "no tool used" from "event not observed")

### Gemini CLI Adapter
- `BeforeTool` can capture pre-edit → `attribution.method: "line"` feasible
- `interactions[].tools`: normalized from AfterTool file events

### Codex CLI Adapter
- `tool_name` = Bash only. No file-edit events → `interactions[].tools: null` (telemetry unavailable)
- Line-level attribution depends on tool event expansion

### GitHub Copilot Adapter
- `preToolUse` / `postToolUse` available → line-level feasible
- `interactions[].tools`: from postToolUse file events

## Implementation Plan

**Single PR. All readers and writers updated atomically. No partial deployment.**

Old git notes from dev/test are invalidated by the shape change. `agentnote show` on old notes will show empty/missing fields — acceptable for pre-release.

### Task Dependency Graph

```
#13 entry.ts (interfaces + buildEntry)
 ├→ #14 record.ts (model + tools collection)
 │   └→ #15 consumers (show/log/pr/session)
 │       ├→ #17 tests
 │       └→ #18 docs
 └→ #16 action (npx → direct import)
```

### Task Breakdown

#### #13: Schema restructure — entry.ts interfaces + buildEntry

**Files**: `entry.ts`
**Blocked by**: none
**Effort**: M

- Replace `AgentnoteEntry` with restructured interface
- Add `FileEntry` interface: `{ path: string; by_ai: boolean }`
- Add `Attribution` interface: `{ ai_ratio: number; method: "line" | "file" | "none"; lines?: { ai_added: number; total_added: number; deleted: number } }`
- Add `model?: string | null` to entry
- Add `interactions[].tools: string[] | null`
- Update `buildEntry` to produce new shape
- Update `calcAiRatio` to work with `Attribution`
- Remove old flat fields (`files_in_commit`, `files_by_ai`, `ai_added_lines`, `total_added_lines`, `deleted_lines`)

#### #14: Schema restructure — record.ts data collection

**Files**: `record.ts`
**Blocked by**: #13
**Effort**: M

- Read `model` from `events.jsonl` (session_start event) in `recordCommitEntry`
- Aggregate `interactions[].tools` from `changeEntries` grouped by turn (same mechanism as `files_touched`)
- Pass `model` and per-interaction `tools` to `buildEntry`
- Update `computeLineAttribution` to return `Attribution` object with `method` field

#### #15: Schema restructure — consumer commands

**Files**: `show.ts`, `log.ts`, `pr.ts`, `session.ts`
**Blocked by**: #13, #14
**Effort**: M

- `show.ts`: display `model`, `attribution.method`, `files[]` array, `interactions[].tools`
- `log.ts`: read `attribution.ai_ratio` instead of `ai_ratio`
- `pr.ts`: new rollup algorithm with `overall_method` and `coverage` fields. Handle mixed/none/line/file methods per normative contract.
- `session.ts`: same rollup contract as pr.ts
- All commands handle old v1 flat notes gracefully (check for `attribution` vs flat fields)

#### #16: Fix GitHub Action — import CLI directly

**Files**: `packages/action/src/index.ts`
**Blocked by**: #13
**Effort**: M

- Replace `npx --yes @wasabeef/agentnote pr` with direct import of CLI functions or bundled `dist/cli.js`
- Eliminates version skew between action and CLI
- Update action outputs for new schema fields (`overall_method`, `coverage`)
- Rebuild with `ncc`

#### #17: Schema restructure — tests

**Files**: `entry.test.ts`, `commit.test.ts`, `pr.test.ts`, `*.test.ts`
**Blocked by**: #13, #14, #15
**Effort**: M

- Update all existing tests for new schema shape
- New tests:
  - `entry.test.ts`: `buildEntry` produces correct new shape with `files[]`, `attribution`, `model`, `tools`
  - Deletion-only commit → `attribution.method: "none"`, `ai_ratio: 0`
  - Mixed-method PR rollup → `overall_method: "mixed"`, weighted ratio
  - Old v1 flat note reading in consumers (backward compat)
  - `model` field propagation from `events.jsonl`
  - `interactions[].tools` aggregation by turn

#### #18: Schema restructure — docs

**Files**: `docs/knowledge/DESIGN.md`, `CLAUDE.md`, `README.md`
**Blocked by**: #13, #15
**Effort**: S

- Update DESIGN.md: new schema shape, `attribution.method`, `files[]`, `model`, `interactions[].tools`
- Update CLAUDE.md if schema references exist
- Update README examples with new JSON output format

## Deferred

| Field | Reason | Future Path |
|---|---|---|
| `interactions[].model` | Per-interaction model tracking | When multi-model sessions exist |
| `token_usage` | 1/5 agents | Revisit when hooks expose it |
| `files[].ai_added_lines` | Per-file line attribution | `files` is extensible |
| Non-file tools (Bash, Read) | Needs separate tool-use log | Track in `events.jsonl` if needed |
