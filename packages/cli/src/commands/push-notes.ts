import { execFileSync } from "node:child_process";
import { gitSafe } from "../git.js";

const NOTES_PUSH_TIMEOUT_MS = 10_000;

/**
 * Push the agentnote notes ref to the same remote as the main code push.
 * This command is intended for the git pre-push hook and must never block
 * the main push if notes are absent, the notes push fails, or the remote hangs.
 */
export async function pushNotes(args: string[]): Promise<void> {
  const remote = args[0]?.trim() || "origin";

  const { exitCode } = await gitSafe(["rev-parse", "--verify", "refs/notes/agentnote"]);
  if (exitCode !== 0) return;

  try {
    execFileSync("git", ["push", remote, "refs/notes/agentnote"], {
      stdio: "ignore",
      timeout: NOTES_PUSH_TIMEOUT_MS,
      env: {
        ...process.env,
        AGENTNOTE_PUSHING: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
  } catch {
    // Never block the main code push on notes sync failures.
  }
}
