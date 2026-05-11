import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SESSION_FILE, SESSIONS_DIR, TEXT_ENCODING, TRAILER_KEY } from "../core/constants.js";
import { hasSessionHeadBlobEvidence, recordCommitEntry } from "../core/record.js";
import { hasRecordableSessionData } from "../core/session.js";
import { git } from "../git.js";
import { agentnoteDir } from "../paths.js";

const FALLBACK_HEAD_FLAG = "--fallback-head";
const SESSION_ID_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const RAW_DIFF_STATUS_RE = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) ([A-Z][0-9]*)$/;
const RAW_DIFF_RENAME_OR_COPY_PREFIXES = ["R", "C"] as const;

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

  const headBlobs = await readHeadCommittedBlobs();
  if (!(await hasSessionHeadBlobEvidence(sessionDir, headBlobs))) return;

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

async function readHeadCommittedBlobs(): Promise<Map<string, string>> {
  const raw = await git(["diff-tree", "-z", "--raw", "--root", "--no-commit-id", "-r", "HEAD"]);
  return parseCommittedBlobs(raw);
}

async function readHeadTrailerSessionId(): Promise<string> {
  return (
    await git(["log", "-1", `--format=%(trailers:key=${TRAILER_KEY},valueonly)`, "HEAD"])
  ).trim();
}

function parseCommittedBlobs(output: string): Map<string, string> {
  const blobs = new Map<string, string>();
  const fields = output.split("\0");

  for (let index = 0; index < fields.length; ) {
    const metadata = fields[index++];
    if (!metadata) continue;

    const match = metadata.match(RAW_DIFF_STATUS_RE);
    if (!match) continue;

    const [, blob, status] = match;
    const pathCount = RAW_DIFF_RENAME_OR_COPY_PREFIXES.some((prefix) => status.startsWith(prefix))
      ? 2
      : 1;
    let path = "";
    for (let pathIndex = 0; pathIndex < pathCount && index < fields.length; pathIndex++) {
      path = fields[index++] ?? "";
    }
    if (path) blobs.set(path, blob);
  }

  return blobs;
}
