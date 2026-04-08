import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { CHANGES_FILE, PROMPTS_FILE } from "./constants.js";

/** Rotate JSONL log files by renaming with a rotation ID (Base36 timestamp). */
export async function rotateLogs(
  sessionDir: string,
  rotateId: string,
  fileNames: string[] = [PROMPTS_FILE, CHANGES_FILE],
): Promise<void> {
  for (const name of fileNames) {
    const src = join(sessionDir, name);
    if (existsSync(src)) {
      const base = name.replace(".jsonl", "");
      await rename(src, join(sessionDir, `${base}-${rotateId}.jsonl`));
    }
  }
}
