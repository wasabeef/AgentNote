import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SESSION_AGENT_FILE, TEXT_ENCODING, TRANSCRIPT_PATH_FILE } from "./constants.js";

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
