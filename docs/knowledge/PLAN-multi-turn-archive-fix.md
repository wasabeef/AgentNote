# Plan: Multi-Turn Archive Fix + Position-Based AI Attribution

## Problem

`ai_added_ratio` = 0% for multi-turn commits because `rotateLogs` purges archives at each prompt.

## Design

### Multi-Turn Fix
Remove `purgeRotatedArchives` from `rotateLogs`. Archives persist within the session.

### Position-Based Attribution (3-Diff Intersection)

Three unified diffs share the **committed blob** as endpoint. All added-line positions are
in committed → directly comparable. No coordinate-space mismatch, no duplicate ambiguity.

```
diff1 = git diff --unified=0 <HEAD_blob> <committed_blob>   // all commit changes

For each AI turn T on this file:
  diff2_T = git diff --unified=0 <pre_T> <committed_blob>   // AI_T + everything after pre_T
  diff3_T = git diff --unified=0 <post_T> <committed_blob>  // everything after post_T
  AI_positions_T = positions in diff2_T NOT in diff3_T       // AI_T's additions

total_AI_positions = ∪(AI_positions_T for all turns)

For each ADDED line in diff1 (at position P in committed):
  if P is in total_AI_positions → AI
  else                          → human

Deletions are NOT attributed (positions in HEAD, not comparable with post).
Tracked separately as `deleted_lines` in note schema. NOT in ratio denominator.
`ai_added_ratio = ai_added / total_added * 100` (new-content authorship only).
Display: "73% of new lines by AI (15 lines deleted)".
If `total_added == 0` (pure deletion): `ai_added_ratio = 0`. Fallback: use file-level binary
attribution (`files_by_ai` membership) for `ai_ratio`. Prompt trail preserved via `files_by_ai`
turn lookup. Deletion-only AI commits are NOT invisible — they have `ai_ratio > 0` via
file-level fallback and their prompts are in the note.

**Two ratios** for different views:
- `ai_added_ratio = ai_added / total_added * 100` — new-content authorship. Rewrites = 100%.
- `ai_change_ratio = ai_added / (total_added + deleted_lines) * 100` — full-change view.
  Deletions treated as unknown (not AI). Rewrites = 50%. Delete-heavy commits pull ratio down.

Primary display: `ai_change_ratio` (full-change view, conservative). Secondary: `ai_added_ratio`
(new-content view). Both stored in note. Consumers see deletion count alongside.

Default headline in `show`/`log`/`pr`: `ai_change_ratio` with `(X added, Y deleted)` context.
```

**Why per-turn**: collapsing to first-pre/last-post loses human edits between AI turns.
Per-turn `diff2_T/diff3_T` correctly isolates each turn's AI contribution. Union of AI
positions across turns = total AI. Positions not in any AI set = human.

All diffs target committed → positions in the new-side are directly comparable.

**Key properties**:
- **Stateless**: no consumed pairs. HEAD is the parent → previously committed AI content
  is in HEAD → not in diff1 → not attributed. Each commit is independent.
- **Duplicate-safe**: positions uniquely identify lines. Two `}` at different positions
  are different entries → no collision.
- **Human in-place edits**: modified line is at position P in committed. P is also in diff2
  (human changed it) → human. Exact.
- **Split commits**: each commit has different HEAD. Independent attribution.
- **Amend/rebase**: no state to lose.
- **Human-between-AI-turns**: per-turn diff2/diff3 isolates each AI turn. Human edits
  between turns are NOT in any AI position set → correctly attributed as human.
- **Human-before-AI (same turn)**: diff2_T(pre_T → committed) excludes pre_T content.
- **Performance**: 1 + 2×T diffs per file (T = AI turns, typically 1-3). ~2ms per diff.
  1 turn: 3 diffs ~6.5ms. 3 turns: 7 diffs ~14.5ms. 10 files × 1 turn: ~65ms.

### Accuracy
- **Exact for additions**: per-turn position-based. No duplicate ambiguity. Handles
  human-before-AI, human-between-turns, human-after-AI — all categories by position intersection.
- **Deletions → unknown**: not attributed to AI or human (position not comparable, content
  duplicates common). Counted in total but not in ai_lines. Conservative: under-attributes.
- **Move/reorder**: not detectable by position alone. Aggregate add=delete counts also match
  normal rewrites → false positive too high. Deferred to content-identity move detection.

---

## Verification

| # | Scenario | diff1 (HEAD→c) | diff2 (pre→c) | diff3 (post→c) | AI | Human | ratio |
|---|---|---|---|---|---|---|---|
| 1 | AI +50, intact | [1-50] | [1-50] | [] | 50 | 0 | 100% |
| 2 | AI +50, human +10 after | [1-60] | [1-60] | [51-60] | 50 | 10 | 83% |
| 3 | Human +20, AI +30 | [1-50] | [21-50] | [] | 30 | 20 | 60% |
| 4 | AI rewrites 20, intact | 20a+20d | 20a | [] | 20 | 0 | 100% (20/20 added) |
| 5 | AI +50, human del 15 | 35a+15d | 35a | [] | 35 | 0 | 100% (35/35 added) |
| 6 | AI +10, human +5, del 3 | 12a+3d | 12a | [8-12]a | 7 | 5 | 58% (7/12 added) |
| 7 | Multi-turn gap | [1-50] | [1-50] | [] | 50 | 0 | 100% |
| 8 | Human-only (no file_change) | [1-30] | — | — | 0 | 30 | 0% |
| 9 | Human modifies 5 AI lines | [1-10] | [1-10] | [3,5,7,8,10] | 5 | 5 | 50% |
| 10 | Split: stage 50 (A) | [1-50] | [1-50] | [] | 50 | 0 | 100% |
| 11 | Split: remaining 50 (B) | [1-50]* | [1-50] | [] | 50 | 0 | 100% |
| 12 | Follow-up human +1 | [51] | — (no file_change) | — | 0 | 1 | 0% |
| 13 | AI rewrites AI (turn1→2) | t2 delta | t2 delta | [] | t2 | 0 | 100% |

*Case 11: HEAD advances to include commit A → diff1 shows only remaining 50 lines.

---

## Changes

### Change 1: Remove purge — `core/rotate.ts`
- Delete `purgeRotatedArchives`. Rename `commitSha` → `rotateId`. Remove `slice(0,8)`.

### Change 2: Constants — `core/constants.ts`
- `ARCHIVE_ID_RE`, `SNAPSHOT_FILE`, `HEARTBEAT_FILE`.

### Change 3: Archive regex + sort — `core/record.ts`
- `ARCHIVE_ID_RE` filter. Numeric Base36 sort.

### Change 4: Hook infrastructure — `commands/hook.ts` + `agents/claude-code.ts`
- Parse `tool_use_id` from hook events. If present: exact match. If missing (bug #13241):
  fallback to per-file FIFO within turn (consume oldest unmatched pre_edit for same file/turn).
  Safe under sequential tool processing. Avoids unnecessary degradation on older hook versions.
- Remove `--amend` exclusion from `isGitCommit`. Amend: parse trailer VALUE from commit
  message, inject only if current session doesn't match. Non-amend: parse `--trailer` flag.
- Add Edit/Write/NotebookEdit to PreToolUse hooks config.
- **PreToolUse (Edit/Write)**: `git hash-object <file>` → `pre_edit` with `tool_use_id`.
  New files: empty blob hash.
- **PostToolUse (Edit/Write)**: `git hash-object <file>` → match by `tool_use_id`, dedup.
  Deleted files: empty blob hash.
- Add Bash (non-commit) to Pre/PostToolUse.
- **PreToolUse (Bash)**: hash dirty + untracked + staged-only files. Cap at 100 files —
  if more dirty files exist, skip Bash attribution for this command (degrade). This bounds
  sync latency to ~50ms (100 × 0.5ms). Staged-only: use `git rev-parse :<file>`.
- **PostToolUse (Bash)**: re-list dirty + untracked + staged-only. Compare hashes.
  Changed → write `file_change`. Newly dirtied tracked: pre from `HEAD:<file>`.
  New files: pre = empty blob. Deleted: post = empty blob.
- Pre-turn snapshot at `UserPromptSubmit`. Heartbeat at `session_start` + `prompt`.

### Change 5: Position-Based Attribution — `core/attribution.ts` (NEW) + `core/record.ts`

**`core/attribution.ts`**:
```typescript
interface DiffHunk { oldStart: number; oldCount: number; newStart: number; newCount: number; }

function parseUnifiedHunks(diffOutput: string): DiffHunk[]
  // Parse @@ -oldStart,oldCount +newStart,newCount @@ lines from --unified=0 output.

function computePositionAttribution(
  headBlob: string, committedBlob: string,
  turnPairs: {preBlob: string, postBlob: string}[]
): { aiLines: number; humanLines: number; totalLines: number }
  // 1. diff1 = git diff --unified=0 <headBlob> <committedBlob> → parse hunks (total)
  // 2. For each turn T:
  //    diff2_T = git diff --unified=0 <preBlob_T> <committedBlob> → parse hunks
  //    diff3_T = git diff --unified=0 <postBlob_T> <committedBlob> → parse hunks
  //    AI_T = positions in diff2_T NOT in diff3_T
  // 3. totalAI = ∪(AI_T)
  // 4. For each added position in diff1: if in totalAI → AI, else → human
  // 5. For deletions: content check against latest post (position not comparable)
  // 6. Return counts
```

**In `recordCommitEntry`**:
1. Check merge: `git rev-list --parents -n1 HEAD`. Merge → skip attribution, all unknown.
2. `git diff-tree --root --find-renames -r HEAD` for file list. Rename map.
3. Get blob hashes: `git rev-parse HEAD:<file>`, `git rev-parse HEAD~1:<file>`.
   Root: empty blob. New file: empty parent. Deleted: empty committed.
4. For each file with `file_change` entries: collect all turns' `(pre_hash, post_hash)` pairs.
   `computePositionAttribution(parentBlob, committedBlob, turnPairs[])`.
5. Files without `file_change`: ai_lines = 0.
6. Degradation: missing post_hash → unknown. Drift → unknown.
7. Prompt scoping: `relevantTurns` = turns with `ai_lines > 0` OR contributing to
   `unknown_added_lines`. Deletion-only files (no additions from AI): do NOT include old
   turns — avoids stale AI prompts leaking into human-only deletion commits.
8. Transcript suppression: `min(relevantTurns) < currentTurn` → response = null.

### Change 6: Consumer updates
- `pr.ts/session.ts`: aggregate line counts. Coverage when `unknown > 0`.
- `show.ts`: `"ai: 73% (146/200 lines)"`. `⚠️` when degraded.
- `log.ts`: coverage.

---

## Current Note Schema (existing code)

```json
{
  "v": 1,
  "session_id": "a1b2c3d4-...",
  "timestamp": "2026-04-07T10:00:00Z",
  "interactions": [
    {"prompt": "add feature", "response": "I will...", "files_touched": ["src/auth.ts"]}
  ],
  "files_in_commit": ["src/auth.ts", "README.md"],
  "files_by_ai": ["src/auth.ts"],
  "ai_ratio": 50
}
```

`ai_ratio` = file-count based: `files_by_ai.length / files_in_commit.length * 100`.
No line-level data. No consumed state. No deletion tracking.

## New Note Schema (v1, backward-compatible evolution)

Keep existing `ai_ratio` field (now = `ai_change_ratio` value) for backward compatibility.
Add new fields alongside. Old consumers reading only `ai_ratio` still get a valid number.

```json
{
  "v": 1,
  "session_id": "...",
  "timestamp": "...",
  "interactions": [...],
  "files_in_commit": [...],
  "files_by_ai": [...],
  "ai_ratio": 58,
  "ai_added_ratio": 73,
  "ai_change_ratio": 58,
  "ai_added_lines": 146,
  "total_added_lines": 200,
  "deleted_lines": 15,
  "unknown_added_lines": 0,
  "binary_files_by_ai": 0,
  "binary_files_in_commit": 0,
  "attribution_degraded": false
}
```

No consumed state. Stateless per commit.

---

## Files to Change

| File | Change |
|---|---|
| `core/constants.ts` | ARCHIVE_ID_RE, SNAPSHOT_FILE, HEARTBEAT_FILE |
| `core/rotate.ts` | Remove purge, rename param |
| `core/attribution.ts` | **NEW**: parseUnifiedHunks, computePositionAttribution |
| `core/record.ts` | Archive regex/sort, position-based attribution, rename map, --root, merge check, prompt scoping, transcript suppression |
| `core/entry.ts` | Schema fields, calcAiRatio |
| `commands/hook.ts` | PreToolUse/PostToolUse hash capture, Bash detection, snapshot, heartbeat |
| `agents/claude-code.ts` | tool_use_id, Edit/Write PreToolUse, Bash pre/post, --amend fix, trailer parsing |
| `agents/types.ts` | pre_edit, bash_pre events + tool_use_id |
| `commands/pr.ts` | Line-count aggregation + coverage |
| `commands/session.ts` | Same |
| `commands/show.ts` | Line-count + coverage + degraded |
| `commands/log.ts` | Coverage |
| `commands/commit.test.ts` | All verification scenarios + edge cases |

## Deferred

| Item | Reason |
|---|---|
| Stale-session TTL | Needs PID lease or closed marker |
| Stable transcript index | Cross-turn response pairing redesign |
| Position-based deletion attribution | Requires 3-way merge or LCS for occurrence-aware matching |
| Rename path linkage in hooks | Stable file identity across renames for exact attribution |
| Bash authored vs side-effect separation | Distinguish AI-intended edits from npm install/codegen/formatter output |
| Formatter isolation from AI edit | post_hash includes formatter changes — can't separate without post-write re-hash before formatter runs |

## Edge Cases

| Case | Handling |
|---|---|
| Multi-turn gap | Archives preserved. Latest post_hash used. HEAD doesn't have AI content → attributed. |
| Human polish (adds lines) | New lines at new positions → in diff2 → human. AI lines at original positions → NOT in diff2 → AI. |
| Human modifies AI lines | Modified positions appear in diff2 → human. Remaining AI positions → AI. Exact. |
| AI rewrites human lines | New content at AI's positions → NOT in diff2 → AI. |
| AI rewrites AI (multi-turn) | Latest post_hash used. HEAD has prior AI → diff1 shows only new changes. |
| Split commits (same file) | Each commit has different HEAD. diff1 shows only this commit's changes. |
| Follow-up human commit | No file_change OR AI content in HEAD → diff1 shows only human changes → 0% AI. |
| Formatter after AI edit | Formatter output is in post_hash but is a secondary side effect. Lines from formatter → `unknown_changed_lines` unless the Edit/Write tool directly wrote them. |
| Drift (formatter between edits) | Detected. Degrade to unknown. |
| New file | parent = empty blob. All committed lines in diff1. |
| Deleted file | committed = empty blob. All deleted lines in diff1. |
| Root commit | parent = empty blob. |
| Binary files | Separate tracking. |
| Renames | Detected via --find-renames. `attribution_degraded`: hook data has no stable path linkage across renames. AI edits on old path can't be reliably paired with new path. |
| `git add -p` (same file) | Each commit's HEAD is different. Position-based attribution independent. ✅ |
| `git commit --amend` | No state. Trailer VALUE check. |
| Bash edits | Hash-based detection. Bash-driven changes default to `unknown_changed_lines` (can't distinguish AI-intended edits from tool side effects like npm install, codegen, formatters). `attribution_degraded` for files modified by Bash. |
| Bash creates new file | pre = empty blob. Still `unknown` (could be codegen output). |
| Merge commits | Detected. ai=0, all unknown. |
| Duplicate lines (`}`, blank) | Position-based → no collision. Two `}` at different positions are independent. ✅ |
| AI rewrites then human rewrites | AI deletion: old line not in post → AI. Human addition: new content at position in diff2 → human. |
| Large files (>10k lines) | Unified diff parsing is O(n). git diff is optimized (Myers). ~5ms for 10k lines. |

## Trade-offs

| Concern | Assessment |
|---|---|
| Performance | ~6.5ms/file for 1 turn (3 diffs). ~14.5ms for 3 turns. ~65-145ms/10 files. |
| Accuracy | Exact for additions (position-based). Content-based for deletions (rare collision). |
| Consumed state | None. Stateless. HEAD baseline handles re-attribution. |
| Duplicate lines | Resolved: positions are unique. No multiset collision. |
| Simplicity | Parse 3 unified diffs + position set intersection. ~250 lines TypeScript. |
| PreToolUse overhead | ~5ms per edit (git hash-object). |
| Coverage | Unknown only from degradation (missing tool_use_id, drift, merge). |
| Transcript pairing | Suppressed for cross-turn. Deferred: index-based. |

---

## Implementation Tasks

### PR 1: Multi-Turn Archive Fix (file-level ai_ratio preserved)

- [x] `core/rotate.ts`: Delete `purgeRotatedArchives`, rename `commitSha` → `rotateId`
- [x] `core/constants.ts`: Add `ARCHIVE_ID_RE`, `HEARTBEAT_FILE`
- [x] `core/record.ts`: Tighten archive regex with `ARCHIVE_ID_RE`
- [x] `core/record.ts`: Numeric Base36 sort in `readAllSessionJsonl`
- [x] `commands/hook.ts`: Write `heartbeat` at `session_start` + `prompt`
- [x] `core/record.ts`: Transcript suppression (`min(relevantTurns) < currentTurn`)
- [x] `commands/commit.test.ts`: Multi-turn gap test (edit turn N, many UPS gaps, commit turn N+M)
- [x] `commands/commit.test.ts`: Update existing cross-turn test for Base36 archive naming
- [x] Build + typecheck + lint + all 40 tests pass
- [x] `docs/knowledge/DESIGN.md`: Update archive lifecycle

### PR 2: Position-Based Line-Level Attribution

- [x] `agents/claude-code.ts`: `tool_use_id` extraction, PreToolUse for Edit/Write/NotebookEdit, `pre_edit` event
- [x] `agents/types.ts`: `pre_edit` kind + `toolUseId` field
- [x] `commands/hook.ts`: `pre_edit` handler (preBlob capture, sync), `file_change` postBlob + `tool_use_id`, `rotateLogs` includes `PRE_BLOBS_FILE`
- [x] `core/attribution.ts` (NEW): `parseUnifiedHunks`, `expandNewPositions`, `countLines`, `computePositionAttribution`
- [x] `core/constants.ts`: `PRE_BLOBS_FILE`, `EMPTY_BLOB`
- [x] `core/record.ts`: `computeLineAttribution` with `tool_use_id` join, FIFO fallback, completeness check, `ensureEmptyBlobInStore`, `parseDiffTreeBlobs`
- [x] `core/entry.ts`: `ai_added_lines`, `total_added_lines`, `deleted_lines`, `LineCounts`, line-level `calcAiRatio`
- [x] Consumer updates: `show.ts` (lines display), `pr.ts` (weighted ratio), `session.ts` (weighted ratio)
- [x] `docs/knowledge/DESIGN.md`: Line-level attribution section + schema update + NormalizedEvent update
- [x] Build + typecheck + lint + all 40 tests pass
- [x] Codex adversarial review: 3 issues found and fixed (tool_use_id join, async turn fix, completeness check)
