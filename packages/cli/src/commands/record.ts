import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getAgent, listAgents } from "../agents/index.js";
import type { AgentName } from "../agents/types.js";
import {
  HEARTBEAT_FILE,
  HEARTBEAT_TTL_SECONDS,
  MILLISECONDS_PER_SECOND,
  NOTES_REF,
  SESSION_FILE,
  SESSIONS_DIR,
  TEXT_ENCODING,
  TRAILER_KEY,
} from "../core/constants.js";
import { hasSessionHeadBlobEvidence, recordCommitEntry } from "../core/record.js";
import {
  hasRecordableSessionData,
  readSessionAgent,
  readSessionTranscriptPath,
  writeSessionAgent,
  writeSessionTranscriptPath,
} from "../core/session.js";
import { git, gitSafe } from "../git.js";
import { agentnoteDir } from "../paths.js";

const FALLBACK_HEAD_FLAG = "--fallback-head";
const FALLBACK_ENV_FLAG = "--fallback-env";
const ENV_AGENTNOTE_DEBUG = "AGENTNOTE_DEBUG";
const SESSION_ID_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const UUID_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RAW_DIFF_STATUS_RE = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) ([A-Z][0-9]*)$/;
const RAW_DIFF_RENAME_OR_COPY_PREFIXES = ["R", "C"] as const;

/** Record an Agent Note entry for HEAD from post-commit hook inputs. */
export async function record(args: string[]): Promise<void> {
  try {
    if (args[0] === FALLBACK_HEAD_FLAG) {
      await recordHeadFallback();
      return;
    }
    if (args[0] === FALLBACK_ENV_FLAG) {
      await recordEnvironmentFallback();
      return;
    }

    const sessionId = args[0];
    if (!sessionId) return;
    await recordCommitEntry({ agentnoteDirPath: await agentnoteDir(), sessionId });
  } catch (err: unknown) {
    // Never break git commit hooks.
    console.error(`agent-note: warning: recording failed: ${(err as Error).message}`);
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

/** Recover notes for agent-hosted terminals that expose the current session id. */
export async function recordEnvironmentFallback(): Promise<void> {
  if (await hasHeadAgentNote()) {
    debugRecord("env fallback skipped: HEAD already has an Agent Note");
    return;
  }
  if (await readHeadTrailerSessionId())
    debugRecord("env fallback continuing after empty trailer record");

  const agentnoteDirPath = await agentnoteDir();
  const sessionId = await resolveEnvironmentSessionId(agentnoteDirPath);
  if (!sessionId) {
    debugRecord("env fallback skipped: no fresh environment session");
    return;
  }

  const result = await recordCommitEntry({
    agentnoteDirPath,
    sessionId,
    allowEnvironmentTranscriptFallback: true,
  });
  debugRecord(`env fallback recorded ${result.promptCount} prompt(s), aiRatio=${result.aiRatio}`);
}

async function readActiveSessionId(agentnoteDirPath: string): Promise<string | null> {
  const activeSessionPath = join(agentnoteDirPath, SESSION_FILE);
  if (!existsSync(activeSessionPath)) return null;
  const sessionId = (await readFile(activeSessionPath, TEXT_ENCODING)).trim();
  if (sessionId === "." || sessionId === "..") return null;
  return SESSION_ID_SEGMENT_RE.test(sessionId) ? sessionId : null;
}

async function hasHeadAgentNote(): Promise<boolean> {
  const result = await gitSafe(["notes", `--ref=${NOTES_REF}`, "show", "HEAD"]);
  return result.exitCode === 0 && result.stdout.trim() !== "";
}

async function resolveEnvironmentSessionId(agentnoteDirPath: string): Promise<string | null> {
  for (const agentName of listAgents()) {
    const candidate = await resolveAgentEnvironmentSession(agentnoteDirPath, agentName);
    if (candidate) return candidate;
  }
  return null;
}

async function resolveAgentEnvironmentSession(
  agentnoteDirPath: string,
  agentName: AgentName,
): Promise<string | null> {
  const adapter = getAgent(agentName);
  const sessionId = sanitizeSessionId(adapter.readEnvironmentSessionId?.() ?? undefined);
  if (!sessionId) return null;

  const sessionDir = join(agentnoteDirPath, SESSIONS_DIR, sessionId);
  const existingAgent = await readSessionAgent(sessionDir);
  if (existingAgent && existingAgent !== agentName) return null;

  const savedTranscriptPath = await readSessionTranscriptPath(sessionDir);
  const transcriptPath = savedTranscriptPath ?? adapter.findTranscript(sessionId);
  if (!(await hasFreshEnvironmentEvidence(sessionDir, transcriptPath))) {
    debugRecord(`env fallback skipped: no fresh evidence for ${agentName} ${sessionId}`);
    return null;
  }

  await mkdir(sessionDir, { recursive: true });
  if (!existingAgent) await writeSessionAgent(sessionDir, agentName);
  if (!savedTranscriptPath && transcriptPath)
    await writeSessionTranscriptPath(sessionDir, transcriptPath);
  return sessionId;
}

function debugRecord(message: string): void {
  if (process.env[ENV_AGENTNOTE_DEBUG]) console.error(`agent-note: debug: ${message}`);
}

function sanitizeSessionId(value: string | undefined): string | null {
  const sessionId = value?.trim();
  if (!sessionId || sessionId === "." || sessionId === "..") return null;
  return UUID_SESSION_ID_RE.test(sessionId) ? sessionId.toLowerCase() : null;
}

async function hasFreshEnvironmentEvidence(
  sessionDir: string,
  transcriptPath: string | null,
): Promise<boolean> {
  if (
    (await hasRecordableSessionData(sessionDir)) &&
    (await isFreshFile(join(sessionDir, HEARTBEAT_FILE)))
  ) {
    return true;
  }
  if (transcriptPath && (await isFreshFile(transcriptPath))) return true;
  return false;
}

async function isFreshFile(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return false;
    const ageMs = Date.now() - stats.mtimeMs;
    return ageMs >= 0 && ageMs <= HEARTBEAT_TTL_SECONDS * MILLISECONDS_PER_SECOND;
  } catch {
    return false;
  }
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
