import { rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Rotate JSONL log files after a commit by renaming with the commit SHA prefix. */
export async function rotateLogs(
  sessionDir: string,
  commitSha: string,
  fileNames: string[] = ["prompts.jsonl", "changes.jsonl"],
): Promise<void> {
  for (const name of fileNames) {
    const src = join(sessionDir, name);
    if (existsSync(src)) {
      const base = name.replace(".jsonl", "");
      await rename(
        src,
        join(sessionDir, `${base}-${commitSha.slice(0, 8)}.jsonl`),
      );
    }
  }
}
