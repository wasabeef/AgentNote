import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { git } from "../git.js";
import { loreDir } from "../paths.js";

export async function log(count: number = 10): Promise<void> {
  const raw = await git([
    "log",
    `-${count}`,
    "--format=%H\t%h %s\t%(trailers:key=Lore-Session,valueonly)",
  ]);

  if (!raw) {
    console.log("no commits found");
    return;
  }

  const loreDirPath = await loreDir();

  for (const line of raw.split("\n")) {
    const [fullSha, commitPart, sessionId] = line.split("\t");
    const sid = sessionId?.trim();

    if (!sid) {
      console.log(commitPart);
      continue;
    }

    // entry ファイルから AI 比率を読む
    const entryFile = join(
      loreDirPath,
      "entries",
      `${fullSha.slice(0, 12)}.json`,
    );

    let ratioStr = "";
    let promptCount = "";
    if (existsSync(entryFile)) {
      try {
        const entry = JSON.parse(await readFile(entryFile, "utf-8"));
        ratioStr = `${entry.ai_ratio}%`;
        promptCount = `${entry.prompts?.length ?? 0}p`;
      } catch {
        // skip
      }
    }

    if (ratioStr) {
      console.log(
        `${commitPart}  [${sid.slice(0, 8)}… | 🤖${ratioStr} | ${promptCount}]`,
      );
    } else {
      console.log(`${commitPart}  [${sid.slice(0, 8)}…]`);
    }
  }
}
