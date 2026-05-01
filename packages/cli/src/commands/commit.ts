import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HEARTBEAT_FILE,
  HEARTBEAT_TTL_SECONDS,
  MILLISECONDS_PER_SECOND,
  SESSIONS_DIR,
  TEXT_ENCODING,
  TRAILER_KEY,
} from "../core/constants.js";
import { recordCommitEntry } from "../core/record.js";
import { agentnoteDir, sessionFile } from "../paths.js";

export async function commit(args: string[]): Promise<void> {
  const sf = await sessionFile();
  let sessionId = "";

  if (existsSync(sf)) {
    sessionId = (await readFile(sf, TEXT_ENCODING)).trim();
    // Check heartbeat validity — must match prepare-commit-msg and status logic:
    // heartbeat must exist, be non-zero, and be at most 1 hour old.
    if (sessionId) {
      const dir = await agentnoteDir();
      const hbPath = join(dir, SESSIONS_DIR, sessionId, HEARTBEAT_FILE);
      try {
        const hb = Number.parseInt((await readFile(hbPath, TEXT_ENCODING)).trim(), 10);
        if (hb === 0 || Number.isNaN(hb)) {
          sessionId = ""; // explicitly stopped or corrupt heartbeat
        } else {
          const ageSeconds =
            Math.floor(Date.now() / MILLISECONDS_PER_SECOND) -
            Math.floor(hb / MILLISECONDS_PER_SECOND);
          if (ageSeconds > HEARTBEAT_TTL_SECONDS) sessionId = "";
        }
      } catch {
        // No heartbeat file — treat as expired (matches status behavior).
        sessionId = "";
      }
    }
  }

  const gitArgs = ["commit"];
  if (sessionId) {
    gitArgs.push("--trailer", `${TRAILER_KEY}: ${sessionId}`);
  }
  gitArgs.push(...args);

  const child = spawn("git", gitArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code: number | null) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  // After a successful commit, record the agentnote entry as a git note.
  if (sessionId) {
    try {
      const agentnoteDirPath = await agentnoteDir();
      const result = await recordCommitEntry({ agentnoteDirPath, sessionId });
      console.log(`agent-note: ${result.promptCount} prompts, AI ratio ${result.aiRatio}%`);
    } catch (err: unknown) {
      // Never let agentnote recording break a commit.
      console.error(`agent-note: warning: ${(err as Error).message}`);
    }
  }
}
