import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  RECORDABLE_SESSION_FILES,
  SESSION_AGENT_FILE,
  TEXT_ENCODING,
  TRANSCRIPT_PATH_FILE,
} from "./constants.js";

// Session-scoped metadata lives under `.git/agentnote/sessions/<session-id>/`.
// The active session pointer itself is stored separately in SESSION_FILE.
/** Persist the adapter name that owns this session. */
export async function writeSessionAgent(sessionDir: string, agentName: string): Promise<void> {
  await writeFile(join(sessionDir, SESSION_AGENT_FILE), `${agentName}\n`);
}

/** Read the adapter name for a session, returning null for legacy sessions. */
export async function readSessionAgent(sessionDir: string): Promise<string | null> {
  const agentPath = join(sessionDir, SESSION_AGENT_FILE);
  if (!existsSync(agentPath)) return null;
  const agent = (await readFile(agentPath, TEXT_ENCODING)).trim();
  return agent || null;
}

/** Persist the local transcript path advertised by the agent hook. */
export async function writeSessionTranscriptPath(
  sessionDir: string,
  transcriptPath: string,
): Promise<void> {
  await writeFile(join(sessionDir, TRANSCRIPT_PATH_FILE), `${transcriptPath}\n`);
}

/** Read the saved transcript path for later response and prompt recovery. */
export async function readSessionTranscriptPath(sessionDir: string): Promise<string | null> {
  const saved = join(sessionDir, TRANSCRIPT_PATH_FILE);
  if (!existsSync(saved)) return null;
  const transcriptPath = (await readFile(saved, TEXT_ENCODING)).trim();
  return transcriptPath || null;
}

/**
 * Return true when the session contains data that can produce a non-empty
 * commit note.
 *
 * Heartbeat and SessionStart metadata only prove that an agent process exists;
 * they do not prove that a user prompt, file edit, or pre-edit signal happened.
 * Git hooks use this as a fail-closed guard before adding a session trailer, so
 * plain shell commits do not end up with dangling `Agentnote-Session` trailers.
 */
export async function hasRecordableSessionData(sessionDir: string): Promise<boolean> {
  for (const fileName of RECORDABLE_SESSION_FILES) {
    try {
      const stats = await stat(join(sessionDir, fileName));
      if (stats.isFile() && stats.size > 0) return true;
    } catch {
      // Missing files are normal for brand-new or metadata-only sessions.
    }
  }

  const agent = await readSessionAgent(sessionDir);
  if (agent === "codex") {
    try {
      const stats = await stat(join(sessionDir, TRANSCRIPT_PATH_FILE));
      if (stats.isFile() && stats.size > 0) return true;
    } catch {
      // Codex can be transcript-driven, but only when a transcript path exists.
    }
  }

  return false;
}
