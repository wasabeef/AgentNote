import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeCode } from "../agents/claude-code.js";
import { git } from "../git.js";
import {
  ARCHIVE_ID_RE,
  CHANGES_FILE,
  PROMPTS_FILE,
  TRANSCRIPT_PATH_FILE,
  TURN_FILE,
} from "./constants.js";
import type { Interaction } from "./entry.js";
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

  const entry = buildEntry({
    sessionId: opts.sessionId,
    interactions,
    commitFiles,
    aiFiles,
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
