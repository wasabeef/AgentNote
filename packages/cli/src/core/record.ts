import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeCode } from "../agents/claude-code.js";
import { git } from "../git.js";
import type { Interaction } from "./entry.js";
import { buildEntry } from "./entry.js";
import { readJsonlEntries, readJsonlField } from "./jsonl.js";
import { rotateLogs } from "./rotate.js";
import { writeNote } from "./storage.js";

/** Record an agentnote entry as a git note after a successful commit. */
export async function recordCommitEntry(opts: {
  agentnoteDirPath: string;
  sessionId: string;
  transcriptPath?: string;
}): Promise<{ promptCount: number; aiRatio: number }> {
  const sessionDir = join(opts.agentnoteDirPath, "sessions", opts.sessionId);
  const commitSha = await git(["rev-parse", "HEAD"]);

  let commitFiles: string[] = [];
  try {
    const raw = await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    commitFiles = raw.split("\n").filter(Boolean);
  } catch {
    // empty
  }

  const aiFiles = await readJsonlField(join(sessionDir, "changes.jsonl"), "file");
  const prompts = await readJsonlField(join(sessionDir, "prompts.jsonl"), "prompt");

  // Resolve transcript path from argument or saved file.
  const transcriptPath = opts.transcriptPath ?? (await readSavedTranscriptPath(sessionDir));

  // Build interactions from transcript for accurate prompt-response pairing.
  let interactions: Interaction[];

  if (transcriptPath) {
    const allInteractions = await claudeCode.extractInteractions(transcriptPath);
    interactions =
      prompts.length > 0 && allInteractions.length > 0
        ? allInteractions.slice(-prompts.length)
        : prompts.map((p) => ({ prompt: p, response: null }));
  } else {
    interactions = prompts.map((p) => ({ prompt: p, response: null }));
  }

  // Attach per-turn file attribution (v2 feature).
  await attachFilesTouched(sessionDir, interactions);

  const entry = buildEntry({
    sessionId: opts.sessionId,
    interactions,
    commitFiles,
    aiFiles,
  });

  await writeNote(commitSha, entry as unknown as Record<string, unknown>);
  await rotateLogs(sessionDir, commitSha);

  return { promptCount: interactions.length, aiRatio: entry.ai_ratio };
}

/** Group file changes by turn ID and attach to matching interactions. */
async function attachFilesTouched(sessionDir: string, interactions: Interaction[]): Promise<void> {
  const promptEntries = await readJsonlEntries(join(sessionDir, "prompts.jsonl"));
  const changeEntries = await readJsonlEntries(join(sessionDir, "changes.jsonl"));

  // Build a map of turn → files.
  const filesByTurn = new Map<number, Set<string>>();
  for (const entry of changeEntries) {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const file = entry.file as string;
    if (!file) continue;
    if (!filesByTurn.has(turn)) filesByTurn.set(turn, new Set());
    filesByTurn.get(turn)?.add(file);
  }

  // Map each interaction to its turn number.
  // Interactions are in the same order as prompts — match by index.
  const offset = Math.max(0, promptEntries.length - interactions.length);
  for (let i = 0; i < interactions.length; i++) {
    const promptEntry = promptEntries[offset + i];
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
