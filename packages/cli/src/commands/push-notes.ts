import { NOTES_REF_FULL } from "../core/constants.js";
import { git, gitSafe } from "../git.js";

const NOTES_PUSH_TIMEOUT_MS = 10_000;
const ENV_AGENTNOTE_PUSHING = "AGENTNOTE_PUSHING";
const ENV_GIT_TERMINAL_PROMPT = "GIT_TERMINAL_PROMPT";
const ENV_TRUE = "1";
const ENV_FALSE = "0";

/**
 * Push the agentnote notes ref to the same remote as the main code push.
 * This command is intended for the git pre-push hook and must never block
 * the main push if notes are absent, the notes push fails, or the remote hangs.
 */
export async function pushNotes(args: string[]): Promise<void> {
  const remote = args[0]?.trim() || "origin";

  const { exitCode } = await gitSafe(["rev-parse", "--verify", NOTES_REF_FULL]);
  if (exitCode !== 0) return;

  try {
    await git(["push", remote, NOTES_REF_FULL], {
      timeout: NOTES_PUSH_TIMEOUT_MS,
      env: {
        ...process.env,
        [ENV_AGENTNOTE_PUSHING]: ENV_TRUE,
        [ENV_GIT_TERMINAL_PROMPT]: ENV_FALSE,
      },
    });
  } catch {
    // Never block the main code push on notes sync failures.
  }
}
