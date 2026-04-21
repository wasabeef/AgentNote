import { MAX_COMMITS, TRAILER_KEY } from "../core/constants.js";
import type { AgentnoteEntry } from "../core/entry.js";
import { countAiRatioEligibleFiles } from "../core/entry.js";
import { readNote } from "../core/storage.js";
import { git } from "../git.js";
import { normalizeEntry } from "./normalize.js";

interface SessionCommit {
  sha: string;
  shortInfo: string;
  entry: AgentnoteEntry | null;
}

/** Display all commits belonging to a given session. */
export async function session(sessionId: string): Promise<void> {
  if (!sessionId) {
    console.error("usage: agent-note session <session-id>");
    process.exit(1);
  }

  // Get recent commit SHAs (all branches, limited for sanity).
  const raw = await git([
    "log",
    "--all",
    `--max-count=${MAX_COMMITS}`,
    `--format=%H\t%h %s\t%(trailers:key=${TRAILER_KEY},valueonly)`,
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
      const entry = note ? normalizeEntry(note) : null;
      matches.push({ sha: fullSha, shortInfo, entry });
      continue;
    }

    // If no trailer match, check the note's session_id as fallback.
    if (!trailer) {
      const note = await readNote(fullSha);
      if (note && (note as Record<string, unknown>).session_id === sessionId) {
        const entry = normalizeEntry(note);
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
  // Rollup: separate line-eligible and file-only commits.
  let lineAiAdded = 0;
  let lineTotalAdded = 0;
  let lineCount = 0;
  let fileFilesAi = 0;
  let fileFilesTotal = 0;
  let fileCount = 0;

  for (const m of matches) {
    let suffix = "";
    if (m.entry) {
      const promptCount = m.entry.interactions?.length ?? 0;
      totalPrompts += promptCount;

      const attr = m.entry.attribution;
      if (attr.method === "line" && attr.lines && attr.lines.total_added > 0) {
        lineAiAdded += attr.lines.ai_added;
        lineTotalAdded += attr.lines.total_added;
        lineCount++;
      } else if (attr.method === "file") {
        const eligibleCounts = countAiRatioEligibleFiles(m.entry.files);
        fileFilesAi += eligibleCounts.ai;
        fileFilesTotal += eligibleCounts.total;
        fileCount++;
      }
      // method: "none" — excluded from ratio

      suffix = `  [🤖${attr.ai_ratio}% | ${promptCount}p]`;
    }
    console.log(`${m.shortInfo}${suffix}`);
  }

  console.log();

  // Display rollup ratio — same partitioning as pr.ts.
  let _overallMethod: string;
  let overallRatio: number | null = null;
  let lineDetail = "";

  if (lineCount > 0 && fileCount === 0) {
    _overallMethod = "line";
    overallRatio = lineTotalAdded > 0 ? Math.round((lineAiAdded / lineTotalAdded) * 100) : 0;
    lineDetail = ` (${lineAiAdded}/${lineTotalAdded} lines)`;
  } else if (lineCount === 0 && fileCount > 0) {
    _overallMethod = "file";
    overallRatio = fileFilesTotal > 0 ? Math.round((fileFilesAi / fileFilesTotal) * 100) : 0;
  } else if (lineCount > 0 && fileCount > 0) {
    // Mixed: same formula as pr.ts — weighted average of ai_ratio by files count.
    _overallMethod = "mixed";
    let weightedSum = 0;
    let weightTotal = 0;
    for (const m of matches) {
      if (!m.entry) continue;
      const attr = m.entry.attribution;
      const isLineEligible = attr.method === "line" && attr.lines && attr.lines.total_added > 0;
      const isFileEligible = attr.method === "file";
      if (isLineEligible || isFileEligible) {
        const eligibleCounts = countAiRatioEligibleFiles(m.entry.files);
        weightedSum += attr.ai_ratio * eligibleCounts.total;
        weightTotal += eligibleCounts.total;
      }
    }
    overallRatio = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  } else {
    _overallMethod = "none";
  }

  if (overallRatio !== null) {
    console.log(`Total: ${totalPrompts} prompts, AI ratio ${overallRatio}%${lineDetail}`);
  } else if (totalPrompts > 0) {
    console.log(`Total: ${totalPrompts} prompts`);
  }
}
