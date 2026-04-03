import { git } from "../git.js";
import { readNote } from "../core/storage.js";

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

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const fullSha = parts[0];
    const commitPart = parts[1];
    const sid = parts[2]?.trim();

    if (!fullSha || !commitPart) continue;

    if (!sid) {
      console.log(commitPart);
      continue;
    }

    let ratioStr = "";
    let promptCount = "";
    const note = await readNote(fullSha);
    if (note) {
      const entry = note as any;
      ratioStr = `${entry.ai_ratio}%`;
      promptCount = `${entry.interactions?.length ?? entry.prompts?.length ?? 0}p`;
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
