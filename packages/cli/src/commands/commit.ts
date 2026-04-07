import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { TRAILER_KEY } from "../core/constants.js";
import { recordCommitEntry } from "../core/record.js";
import { agentnoteDir, sessionFile } from "../paths.js";

export async function commit(args: string[]): Promise<void> {
  const sf = await sessionFile();
  let sessionId = "";

  if (existsSync(sf)) {
    sessionId = (await readFile(sf, "utf-8")).trim();
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
      console.log(`agentnote: ${result.promptCount} prompts, AI ratio ${result.aiRatio}%`);
    } catch (err: unknown) {
      // Never let agentnote recording break a commit.
      console.error(`agentnote: warning: ${(err as Error).message}`);
    }
  }
}
