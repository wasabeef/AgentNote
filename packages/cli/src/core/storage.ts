import { gitSafe } from "../git.js";

const NOTES_REF = "agentnote";

/** Write a agentnote entry as a git note on a commit. */
export async function writeNote(
  commitSha: string,
  data: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  await gitSafe(["notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", body, commitSha]);
}

/** Read a agentnote entry from a git note. Returns null if no note exists. */
export async function readNote(
  commitSha: string,
): Promise<Record<string, unknown> | null> {
  const { stdout, exitCode } = await gitSafe([
    "notes",
    `--ref=${NOTES_REF}`,
    "show",
    commitSha,
  ]);
  if (exitCode !== 0 || !stdout.trim()) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
