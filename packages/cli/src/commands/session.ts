import type { AgentnoteEntry } from "../core/entry.js";
import { readNote } from "../core/storage.js";
import { git } from "../git.js";

const MAX_COMMITS = 500;

interface SessionCommit {
  sha: string;
  shortInfo: string;
  entry: AgentnoteEntry | null;
}

/** Display all commits belonging to a given session. */
export async function session(sessionId: string): Promise<void> {
  if (!sessionId) {
    console.error("usage: agentnote session <session-id>");
    process.exit(1);
  }

  // Get recent commit SHAs (all branches, limited for sanity).
  const raw = await git([
    "log",
    "--all",
    `--max-count=${MAX_COMMITS}`,
    "--format=%H\t%h %s\t%(trailers:key=Agentnote-Session,valueonly)",
  ]);

  if (!raw) {
    console.log("no commits found");
    return;
  }

  const matches: SessionCommit[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const fullSha = parts[0];
    const shortInfo = parts[1];
    const trailer = parts[2]?.trim();

    if (!fullSha || !shortInfo) continue;

    // First check trailer match (fast path).
    if (trailer === sessionId) {
      const note = await readNote(fullSha);
      const entry = note as unknown as AgentnoteEntry | null;
      matches.push({ sha: fullSha, shortInfo, entry });
      continue;
    }

    // If no trailer match, check the note's session_id as fallback.
    if (!trailer) {
      const note = await readNote(fullSha);
      if (note && (note as Record<string, unknown>).session_id === sessionId) {
        const entry = note as unknown as AgentnoteEntry | null;
        matches.push({ sha: fullSha, shortInfo, entry });
      }
    }
  }

  if (matches.length === 0) {
    console.log(`no commits found for session ${sessionId}`);
    return;
  }

  // Reverse to chronological order (git log returns newest first).
  matches.reverse();

  console.log(`Session: ${sessionId}`);
  console.log(`Commits: ${matches.length}`);
  console.log();

  let totalPrompts = 0;
  let totalRatio = 0;
  let ratioCount = 0;

  for (const m of matches) {
    let suffix = "";
    if (m.entry) {
      const promptCount =
        m.entry.interactions?.length ??
        (m.entry as unknown as { prompts?: unknown[] }).prompts?.length ??
        0;
      totalPrompts += promptCount;
      totalRatio += m.entry.ai_ratio;
      ratioCount++;
      suffix = `  [🤖${m.entry.ai_ratio}% | ${promptCount}p]`;
    }
    console.log(`${m.shortInfo}${suffix}`);
  }

  console.log();
  if (ratioCount > 0) {
    const avgRatio = Math.round(totalRatio / ratioCount);
    console.log(`Total: ${totalPrompts} prompts, avg AI ratio ${avgRatio}%`);
  }
}
