import { gitSafe } from "../git.js";
import { NOTES_REF } from "./constants.js";

/** Write an Agent Note entry as a git note on a commit. */
export async function writeNote(commitSha: string, data: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  const result = await gitSafe(["notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", body, commitSha]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "failed to write Agent Note git note");
  }
}

/** Read an Agent Note entry from a git note, returning null when none exists. */
export async function readNote(commitSha: string): Promise<Record<string, unknown> | null> {
  const { stdout, exitCode } = await gitSafe(["notes", `--ref=${NOTES_REF}`, "show", commitSha]);
  if (exitCode !== 0 || !stdout.trim()) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
