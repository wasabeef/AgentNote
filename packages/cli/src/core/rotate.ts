import { existsSync } from "node:fs";
import { readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { CHANGES_FILE, PROMPTS_FILE } from "./constants.js";

/** Rotate JSONL log files after a commit by renaming with the commit SHA prefix. */
export async function rotateLogs(
  sessionDir: string,
  commitSha: string,
  fileNames: string[] = [PROMPTS_FILE, CHANGES_FILE],
): Promise<void> {
  // Purge previously rotated archives first so that all commits in the current
  // turn share access to them (split-commit support). Archives are only safe to
  // delete once we begin a new prompt turn.
  await purgeRotatedArchives(sessionDir, fileNames);

  for (const name of fileNames) {
    const src = join(sessionDir, name);
    if (existsSync(src)) {
      const base = name.replace(".jsonl", "");
      await rename(src, join(sessionDir, `${base}-${commitSha.slice(0, 8)}.jsonl`));
    }
  }
}

/** Delete rotated archive files (stem-*.jsonl) from previous turns. */
async function purgeRotatedArchives(sessionDir: string, fileNames: string[]): Promise<void> {
  const files = await readdir(sessionDir).catch(() => [] as string[]);
  for (const name of fileNames) {
    const stem = name.replace(".jsonl", "");
    const rotated = files.filter((f) => f.startsWith(`${stem}-`) && f.endsWith(".jsonl"));
    await Promise.all(rotated.map((f) => unlink(join(sessionDir, f)).catch(() => {})));
  }
}
