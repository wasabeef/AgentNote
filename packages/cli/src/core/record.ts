import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeCode } from "../agents/claude-code.js";
import { git } from "../git.js";
import type { Interaction } from "./entry.js";
import { buildEntry } from "./entry.js";
import { readJsonlEntries, readJsonlField } from "./jsonl.js";
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

  // Read all change and prompt entries from the session.
  const changeEntries = await readJsonlEntries(join(sessionDir, "changes.jsonl"));
  const promptEntries = await readJsonlEntries(join(sessionDir, "prompts.jsonl"));

  // Check if turn tracking is available (v2 data has turn fields).
  const hasTurnData = promptEntries.some((e) => typeof e.turn === "number" && e.turn > 0);

  let aiFiles: string[];
  let prompts: string[];
  let relevantPromptEntries: Record<string, unknown>[];

  if (hasTurnData) {
    // Option 3: scope data to this commit's files via turn IDs.
    aiFiles = [
      ...new Set(
        changeEntries.map((e) => e.file as string).filter((f) => f && commitFileSet.has(f)),
      ),
    ];

    // Find turns that touched files in this commit.
    const relevantTurns = new Set<number>();
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
    aiFiles = await readJsonlField(join(sessionDir, "changes.jsonl"), "file");
    prompts = promptEntries.map((e) => e.prompt as string);
    relevantPromptEntries = promptEntries;
  }

  // Resolve transcript path from argument or saved file.
  const transcriptPath = opts.transcriptPath ?? (await readSavedTranscriptPath(sessionDir));

  // Build interactions from transcript for accurate prompt-response pairing.
  let interactions: Interaction[];

  if (transcriptPath && prompts.length > 0) {
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

  // Do NOT rotate logs here — rotation happens at the next UserPromptSubmit.
  // This allows split commits to each get their own scoped note.

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

async function readSavedTranscriptPath(sessionDir: string): Promise<string | null> {
  const saved = join(sessionDir, "transcript_path");
  if (!existsSync(saved)) return null;
  const p = (await readFile(saved, "utf-8")).trim();
  return p || null;
}
