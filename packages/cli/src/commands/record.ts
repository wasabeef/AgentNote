import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SESSION_FILE, SESSIONS_DIR, TEXT_ENCODING, TRAILER_KEY } from "../core/constants.js";
import { hasSessionCommitFileEvidence, recordCommitEntry } from "../core/record.js";
import { hasRecordableSessionData } from "../core/session.js";
import { git } from "../git.js";
import { agentnoteDir } from "../paths.js";

const FALLBACK_HEAD_FLAG = "--fallback-head";
const SESSION_ID_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/** Record an Agent Note entry for HEAD from post-commit hook inputs. */
export async function record(args: string[]): Promise<void> {
  try {
    if (args[0] === FALLBACK_HEAD_FLAG) {
      await recordHeadFallback();
      return;
    }

    const sessionId = args[0];
    if (!sessionId) return;
    await recordCommitEntry({ agentnoteDirPath: await agentnoteDir(), sessionId });
  } catch {
    // Never break git commit hooks.
  }
}

/** Strictly recover a missing trailer when session evidence matches HEAD. */
export async function recordHeadFallback(): Promise<void> {
  if (await readHeadTrailerSessionId()) return;

  const agentnoteDirPath = await agentnoteDir();
  const sessionId = await readActiveSessionId(agentnoteDirPath);
  if (!sessionId) return;

  const sessionDir = join(agentnoteDirPath, SESSIONS_DIR, sessionId);
  if (!(await hasRecordableSessionData(sessionDir))) return;

  const commitFiles = await readHeadCommitFiles();
  if (!(await hasSessionCommitFileEvidence(sessionDir, commitFiles))) return;

  await recordCommitEntry({
    agentnoteDirPath,
    sessionId,
    requireAiFileEvidence: true,
  });
}

async function readActiveSessionId(agentnoteDirPath: string): Promise<string | null> {
  const activeSessionPath = join(agentnoteDirPath, SESSION_FILE);
  if (!existsSync(activeSessionPath)) return null;
  const sessionId = (await readFile(activeSessionPath, TEXT_ENCODING)).trim();
  if (sessionId === "." || sessionId === "..") return null;
  return SESSION_ID_SEGMENT_RE.test(sessionId) ? sessionId : null;
}

async function readHeadCommitFiles(): Promise<string[]> {
  const raw = await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
  return raw.split("\n").filter(Boolean);
}

async function readHeadTrailerSessionId(): Promise<string> {
  return (
    await git(["log", "-1", `--format=%(trailers:key=${TRAILER_KEY},valueonly)`, "HEAD"])
  ).trim();
}
