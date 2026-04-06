import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { sessionFile, agentnoteDir } from "../paths.js";
import { git } from "../git.js";
import { claudeCode } from "../agents/claude-code.js";
import { readJsonlField } from "../core/jsonl.js";
import { writeNote } from "../core/storage.js";
import { buildEntry } from "../core/entry.js";
import { rotateLogs } from "../core/rotate.js";

export async function commit(args: string[]): Promise<void> {
  const sf = await sessionFile();
  let sessionId = "";

  if (existsSync(sf)) {
    sessionId = (await readFile(sf, "utf-8")).trim();
  }

  const gitArgs = ["commit"];
  if (sessionId) {
    gitArgs.push("--trailer", `Agentnote-Session: ${sessionId}`);
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
      const sessionDir = join(agentnoteDirPath, "sessions", sessionId);
      const commitSha = await git(["rev-parse", "HEAD"]);

      let commitFiles: string[] = [];
      try {
        const raw = await git([
          "diff-tree",
          "--no-commit-id",
          "--name-only",
          "-r",
          "HEAD",
        ]);
        commitFiles = raw.split("\n").filter(Boolean);
      } catch {
        // empty
      }

      const aiFiles = await readJsonlField(
        join(sessionDir, "changes.jsonl"),
        "file",
      );
      const prompts = await readJsonlField(
        join(sessionDir, "prompts.jsonl"),
        "prompt",
      );

      // Read transcript for accurate prompt-response pairing.
      let interactions: Array<{ prompt: string; response: string | null }>;
      const transcriptPathFile = join(sessionDir, "transcript_path");
      if (existsSync(transcriptPathFile)) {
        const transcriptPath = (await readFile(transcriptPathFile, "utf-8")).trim();
        if (transcriptPath) {
          const allInteractions = await claudeCode.extractInteractions(transcriptPath);
          interactions = prompts.length > 0 && allInteractions.length > 0
            ? allInteractions.slice(-prompts.length)
            : prompts.map((p) => ({ prompt: p, response: null }));
        } else {
          interactions = prompts.map((p) => ({ prompt: p, response: null }));
        }
      } else {
        interactions = prompts.map((p) => ({ prompt: p, response: null }));
      }

      const entry = buildEntry({
        sessionId,
        interactions,
        commitFiles,
        aiFiles,
      });

      await writeNote(commitSha, entry as unknown as Record<string, unknown>);
      await rotateLogs(sessionDir, commitSha);

      console.log(
        `agentnote: ${interactions.length} prompts, AI ratio ${entry.ai_ratio}%`,
      );
    } catch (err: any) {
      // Never let agentnote recording break a commit.
      console.error(`agentnote: warning: ${err.message}`);
    }
  }
}
