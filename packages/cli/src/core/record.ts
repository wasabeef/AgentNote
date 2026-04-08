import { existsSync } from "node:fs";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode } from "../agents/claude-code.js";
import { git } from "../git.js";
import { computePositionAttribution } from "./attribution.js";
import {
  ARCHIVE_ID_RE,
  CHANGES_FILE,
  EMPTY_BLOB,
  PRE_BLOBS_FILE,
  PROMPTS_FILE,
  TRANSCRIPT_PATH_FILE,
  TURN_FILE,
} from "./constants.js";
import type { Interaction, LineCounts } from "./entry.js";
import { buildEntry } from "./entry.js";
import { readJsonlEntries } from "./jsonl.js";
import { writeNote } from "./storage.js";

/** Record an agentnote entry as a git note after a successful commit. */
export async function recordCommitEntry(opts: {
  agentnoteDirPath: string;
  sessionId: string;
  transcriptPath?: string;
}): Promise<{ promptCount: number; aiRatio: number }> {
  const sessionDir = join(opts.agentnoteDirPath, "sessions", opts.sessionId);
  const commitSha = await git(["rev-parse", "HEAD"]);

  // Get files in THIS specific commit.
  let commitFiles: string[] = [];
  try {
    const raw = await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    commitFiles = raw.split("\n").filter(Boolean);
  } catch {
    // empty
  }

  const commitFileSet = new Set(commitFiles);

  // Read all change and prompt entries: current files + any rotated (archived) files
  // from previous turns that have not yet been attributed to a commit.
  const changeEntries = await readAllSessionJsonl(sessionDir, CHANGES_FILE);
  const promptEntries = await readAllSessionJsonl(sessionDir, PROMPTS_FILE);

  // Check if turn tracking is available (turn-attributed data has turn fields).
  const hasTurnData = promptEntries.some((e) => typeof e.turn === "number" && e.turn > 0);

  let aiFiles: string[];
  let prompts: string[];
  let relevantPromptEntries: Record<string, unknown>[];
  const relevantTurns = new Set<number>();

  if (hasTurnData) {
    // Option 3: scope data to this commit's files via turn IDs.
    aiFiles = [
      ...new Set(
        changeEntries.map((e) => e.file as string).filter((f) => f && commitFileSet.has(f)),
      ),
    ];

    // Find turns that touched files in this commit.
    for (const entry of changeEntries) {
      const file = entry.file as string;
      if (file && commitFileSet.has(file)) {
        relevantTurns.add(typeof entry.turn === "number" ? entry.turn : 0);
      }
    }

    // Filter prompts to only those with matching turns.
    relevantPromptEntries = promptEntries.filter((e) => {
      const turn = typeof e.turn === "number" ? e.turn : 0;
      return relevantTurns.has(turn);
    });
    prompts = relevantPromptEntries.map((e) => e.prompt as string);
  } else {
    // Fallback: no turn data — use all prompts and changes (v1 compat).
    aiFiles = changeEntries.map((e) => e.file as string).filter(Boolean);
    prompts = promptEntries.map((e) => e.prompt as string);
    relevantPromptEntries = promptEntries;
  }

  // Resolve transcript path from argument or saved file.
  const transcriptPath = opts.transcriptPath ?? (await readSavedTranscriptPath(sessionDir));

  // Build interactions from transcript for accurate prompt-response pairing.
  // Suppress transcript pairing for cross-turn commits: slice(-prompts.length)
  // is only accurate when all relevant edits are from the current turn.
  let crossTurnCommit = false;
  if (hasTurnData && relevantTurns.size > 0) {
    const turnFilePath = join(sessionDir, TURN_FILE);
    let currentTurn = 0;
    if (existsSync(turnFilePath)) {
      currentTurn = Number.parseInt((await readFile(turnFilePath, "utf-8")).trim(), 10) || 0;
    }
    const minRelevantTurn = Math.min(...relevantTurns);
    crossTurnCommit = minRelevantTurn < currentTurn;
  }

  let interactions: Interaction[];

  if (transcriptPath && prompts.length > 0 && !crossTurnCommit) {
    const allInteractions = await claudeCode.extractInteractions(transcriptPath);
    interactions =
      allInteractions.length > 0
        ? allInteractions.slice(-prompts.length)
        : prompts.map((p) => ({ prompt: p, response: null }));
  } else {
    interactions = prompts.map((p) => ({ prompt: p, response: null }));
  }

  // Attach per-turn file attribution when turn data is available.
  if (hasTurnData) {
    attachFilesTouched(changeEntries, relevantPromptEntries, interactions, commitFileSet);
  }

  // Line-level attribution: compute AI vs human added-line counts.
  const lineCounts = await computeLineAttribution({
    sessionDir,
    commitFileSet,
    aiFileSet: new Set(aiFiles),
    relevantTurns,
    hasTurnData,
    changeEntries,
  });

  const entry = buildEntry({
    sessionId: opts.sessionId,
    interactions,
    commitFiles,
    aiFiles,
    lineCounts: lineCounts ?? undefined,
  });

  await writeNote(commitSha, entry as unknown as Record<string, unknown>);

  // Do NOT delete rotated archives here. They are kept available for subsequent
  // split commits in the same turn (each commit scopes its own files via
  // commitFileSet). Archives are purged at the start of the next turn by rotateLogs.

  return { promptCount: interactions.length, aiRatio: entry.ai_ratio };
}

/** Attach files_touched per interaction, scoped to the current commit's files. */
function attachFilesTouched(
  changeEntries: Record<string, unknown>[],
  promptEntries: Record<string, unknown>[],
  interactions: Interaction[],
  commitFileSet: Set<string>,
): void {
  // Build a map of turn → files (only files in this commit).
  const filesByTurn = new Map<number, Set<string>>();
  for (const entry of changeEntries) {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const file = entry.file as string;
    if (!file || !commitFileSet.has(file)) continue;
    if (!filesByTurn.has(turn)) filesByTurn.set(turn, new Set());
    filesByTurn.get(turn)?.add(file);
  }

  for (let i = 0; i < interactions.length; i++) {
    const promptEntry = promptEntries[i];
    if (!promptEntry) continue;
    const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
    const files = filesByTurn.get(turn);
    if (files && files.size > 0) {
      interactions[i].files_touched = [...files];
    }
  }
}

/**
 * Read entries from the current JSONL file and all rotated archives (stem-*.jsonl).
 * Rotated files are those renamed by the rotation mechanism on UserPromptSubmit.
 */
async function readAllSessionJsonl(
  sessionDir: string,
  baseFile: string,
): Promise<Record<string, unknown>[]> {
  const stem = baseFile.slice(0, baseFile.lastIndexOf(".jsonl"));
  const files = await readdir(sessionDir).catch(() => [] as string[]);
  const matching = files
    .filter((f) => {
      if (f === baseFile) return true;
      // Match rotated archives: stem-<Base36 ID>.jsonl
      const suffix = f.slice(stem.length + 1, -".jsonl".length);
      return f.startsWith(`${stem}-`) && f.endsWith(".jsonl") && ARCHIVE_ID_RE.test(suffix);
    })
    .sort((a, b) => {
      // Numeric Base36 sort. Base file (no suffix) sorts last (most recent).
      const getId = (f: string): number => {
        const s = f.slice(stem.length + 1, -".jsonl".length);
        return s ? parseInt(s, 36) : Infinity;
      };
      return getId(a) - getId(b);
    })
    .map((f) => join(sessionDir, f));

  const all: Record<string, unknown>[] = [];
  for (const file of matching) {
    const entries = await readJsonlEntries(file);
    all.push(...entries);
  }
  return all;
}

async function readSavedTranscriptPath(sessionDir: string): Promise<string | null> {
  const saved = join(sessionDir, TRANSCRIPT_PATH_FILE);
  if (!existsSync(saved)) return null;
  const p = (await readFile(saved, "utf-8")).trim();
  return p || null;
}

/**
 * Compute line-level AI attribution across all files in this commit.
 * Returns null if blob data is unavailable or attribution cannot be computed.
 */
async function computeLineAttribution(opts: {
  sessionDir: string;
  commitFileSet: Set<string>;
  aiFileSet: Set<string>;
  relevantTurns: Set<number>;
  hasTurnData: boolean;
  changeEntries: Record<string, unknown>[];
}): Promise<LineCounts | null> {
  const { sessionDir, commitFileSet, aiFileSet, relevantTurns, hasTurnData, changeEntries } = opts;

  // Parse parent↔committed blob hashes from git diff-tree.
  let diffTreeOutput: string;
  try {
    diffTreeOutput = await git(["diff-tree", "--raw", "--root", "-r", "HEAD"]);
  } catch {
    return null;
  }
  const committedBlobs = parseDiffTreeBlobs(diffTreeOutput);
  if (committedBlobs.size === 0) return null;

  // Write EMPTY_BLOB into the object store so new-file diffs work.
  // (blobHash returns EMPTY_BLOB as a constant without writing it to the store.)
  await ensureEmptyBlobInStore();

  // Read pre-blob entries (snapshot before AI edit).
  const preBlobEntries = await readAllSessionJsonl(sessionDir, PRE_BLOBS_FILE);

  // If no blob data exists at all (e.g., old session without hook v2), skip line-level
  // attribution and return null so the caller falls back to file-level ratio.
  const hasPreBlobData = preBlobEntries.some((e) => e.blob);
  const hasPostBlobData = changeEntries.some((e) => e.blob);
  if (!hasPreBlobData && !hasPostBlobData) return null;

  // Build map: tool_use_id → pre-blob info (file, blob, turn captured synchronously).
  // tool_use_id is the stable correlation key between PreToolUse and PostToolUse events.
  // Using it avoids FIFO ordering assumptions broken by async PostToolUse hooks.
  const preBlobById = new Map<string, { file: string; blob: string; turn: number }>();
  // Fallback: file → ordered preBlobs for entries without tool_use_id.
  const preBlobsFallback = new Map<string, string[]>();

  for (const entry of preBlobEntries) {
    const file = entry.file as string;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const id = entry.tool_use_id as string | undefined;
    if (!file || !commitFileSet.has(file)) continue;
    // Caution: turn from pre_blob was captured synchronously (correct turn),
    // so use it for relevantTurns filtering rather than file_change's async turn.
    if (hasTurnData && !relevantTurns.has(turn)) continue;
    if (id) {
      preBlobById.set(id, { file, blob: (entry.blob as string) || "", turn });
    } else {
      // No tool_use_id — fall back to FIFO ordering per file.
      if (!preBlobsFallback.has(file)) preBlobsFallback.set(file, []);
      preBlobsFallback.get(file)?.push((entry.blob as string) || "");
    }
  }

  // Build turnPairs per file by joining pre/post blobs on tool_use_id.
  const turnPairsByFile = new Map<string, { preBlob: string; postBlob: string }[]>();
  const hadNewFileEditByFile = new Map<string, boolean>();
  // Fallback: postBlobs per file for entries without tool_use_id.
  const postBlobsFallback = new Map<string, string[]>();

  for (const entry of changeEntries) {
    const file = entry.file as string;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const id = entry.tool_use_id as string | undefined;
    const postBlob = (entry.blob as string) || "";
    if (!file || !commitFileSet.has(file) || !postBlob) continue;

    if (id) {
      const pre = preBlobById.get(id);
      if (!pre) continue; // No matching pre-blob — skip this edit.
      // Use turn from pre_blob (sync capture) for relevantTurns check.
      if (hasTurnData && !relevantTurns.has(pre.turn)) continue;
      if (!pre.blob) {
        hadNewFileEditByFile.set(file, true);
      } else {
        if (!turnPairsByFile.has(file)) turnPairsByFile.set(file, []);
        turnPairsByFile.get(file)?.push({ preBlob: pre.blob, postBlob });
      }
    } else {
      // No tool_use_id — fall back to FIFO.
      if (hasTurnData && !relevantTurns.has(turn)) continue;
      if (!postBlobsFallback.has(file)) postBlobsFallback.set(file, []);
      postBlobsFallback.get(file)?.push(postBlob);
    }
  }

  // Merge FIFO fallback pairs into turnPairsByFile.
  for (const [file, postBlobs] of postBlobsFallback) {
    const preBlobs = preBlobsFallback.get(file) ?? [];
    const pairCount = Math.min(preBlobs.length, postBlobs.length);
    for (let i = 0; i < pairCount; i++) {
      const pre = preBlobs[i] || "";
      const post = postBlobs[i] || "";
      if (!pre) {
        hadNewFileEditByFile.set(file, true);
      } else if (post) {
        if (!turnPairsByFile.has(file)) turnPairsByFile.set(file, []);
        turnPairsByFile.get(file)?.push({ preBlob: pre, postBlob: post });
      }
    }
  }

  // Completeness check (issue #3 from adversarial review):
  // If any AI file has no blob data at all (neither pre nor post), the session
  // predates hook v2 or blob capture failed. Return null to fall back to file-level
  // attribution rather than silently reporting a partial (potentially misleading) ratio.
  for (const file of aiFileSet) {
    if (!commitFileSet.has(file)) continue;
    const hasPairs = (turnPairsByFile.get(file) ?? []).length > 0;
    const hasNewFileEdit = hadNewFileEditByFile.get(file) ?? false;
    const hasFallbackPre = (preBlobsFallback.get(file) ?? []).length > 0;
    const hasFallbackPost = (postBlobsFallback.get(file) ?? []).length > 0;
    if (!hasPairs && !hasNewFileEdit && !hasFallbackPre && !hasFallbackPost) {
      // No blob data for this AI file — fall back to file-level for the whole commit.
      return null;
    }
  }

  let totalAiAdded = 0;
  let totalAdded = 0;
  let totalDeleted = 0;

  for (const file of commitFileSet) {
    const blobs = committedBlobs.get(file);
    if (!blobs) continue;

    const { parentBlob, committedBlob } = blobs;
    const turnPairs = turnPairsByFile.get(file) ?? [];
    const hadNewFileEdit = hadNewFileEditByFile.get(file) ?? false;

    try {
      const result = await computePositionAttribution(parentBlob, committedBlob, turnPairs);

      // New file created by AI from scratch: attribute all added lines to AI.
      if (hadNewFileEdit && aiFileSet.has(file) && turnPairs.length === 0) {
        totalAiAdded += result.totalAddedLines;
      } else {
        totalAiAdded += result.aiAddedLines;
      }
      totalAdded += result.totalAddedLines;
      totalDeleted += result.deletedLines;
    } catch {
      // Attribution failed for this file — skip it without breaking the commit.
    }
  }

  return { aiAddedLines: totalAiAdded, totalAddedLines: totalAdded, deletedLines: totalDeleted };
}

/**
 * Parse `git diff-tree --raw --root -r HEAD` output into a file → blob hash map.
 * Maps the all-zeros "null blob" to EMPTY_BLOB.
 */
function parseDiffTreeBlobs(
  output: string,
): Map<string, { parentBlob: string; committedBlob: string }> {
  const map = new Map<string, { parentBlob: string; committedBlob: string }>();
  const ZEROS = "0000000000000000000000000000000000000000";

  for (const line of output.split("\n")) {
    // Format: :oldmode newmode oldblob newblob status\tfile
    const m = line.match(/^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) \w+\t(.+)$/);
    if (!m) continue;
    const parentBlob = m[1] === ZEROS ? EMPTY_BLOB : m[1];
    const committedBlob = m[2] === ZEROS ? EMPTY_BLOB : m[2];
    const file = m[3];
    map.set(file, { parentBlob, committedBlob });
  }
  return map;
}

/**
 * Write the git empty blob (e69de29...) into the object store using a temp file.
 * Required so that `git diff EMPTY_BLOB <blob>` works for new-file attribution.
 */
async function ensureEmptyBlobInStore(): Promise<void> {
  const tmp = join(tmpdir(), `agentnote-empty-${process.pid}.tmp`);
  try {
    await writeFile(tmp, "");
    await git(["hash-object", "-w", tmp]);
  } catch {
    // Not critical — new-file attribution may fall back to file-level.
  } finally {
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
  }
}
