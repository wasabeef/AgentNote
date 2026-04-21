import { gitSafe } from "../git.js";
import { EMPTY_BLOB } from "./constants.js";

/** Parsed hunk from unified diff --unified=0 output. */
export interface DiffHunk {
  /** Line number in old file (1-based). 0 for pure additions. */
  oldStart: number;
  oldCount: number;
  /** Line number in new file (1-based). 0 for pure deletions. */
  newStart: number;
  newCount: number;
}

export interface AttributionTurnPair {
  preBlob: string;
  postBlob: string;
  turn?: number;
}

/** Parse @@ hunk headers from `git diff --unified=0` output. */
export function parseUnifiedHunks(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const line of diffOutput.split("\n")) {
    // Format: @@ -oldStart[,oldCount] +newStart[,newCount] @@
    const m = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (m) {
      hunks.push({
        oldStart: Number(m[1]),
        oldCount: m[2] != null ? Number(m[2]) : 1,
        newStart: Number(m[3]),
        newCount: m[4] != null ? Number(m[4]) : 1,
      });
    }
  }
  return hunks;
}

/** Expand hunks to a Set of new-side line positions (1-based). */
export function expandNewPositions(hunks: DiffHunk[]): Set<number> {
  const positions = new Set<number>();
  for (const h of hunks) {
    for (let i = 0; i < h.newCount; i++) {
      positions.add(h.newStart + i);
    }
  }
  return positions;
}

/** Count total added lines (new-side) and deleted lines (old-side) from hunks. */
export function countLines(hunks: DiffHunk[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const h of hunks) {
    added += h.newCount;
    deleted += h.oldCount;
  }
  return { added, deleted };
}

/**
 * Compute position-based AI attribution for a single file.
 *
 * Uses 3 diffs per AI turn, all targeting the committed blob as the new-side
 * endpoint. Positions in the committed file are directly comparable across diffs.
 *
 * @param parentBlob  - Blob hash of the file in the parent commit (HEAD~1).
 *                      Empty blob for new files or root commits.
 * @param committedBlob - Blob hash of the file in the new commit.
 * @param turnPairs   - Array of {preBlob, postBlob} from each AI turn's
 *                      PreToolUse/PostToolUse captured hashes.
 * @returns AI-attributed added lines, human added lines, total added, deleted.
 */
export async function computePositionAttribution(
  parentBlob: string,
  committedBlob: string,
  turnPairs: AttributionTurnPair[],
): Promise<{
  aiAddedLines: number;
  humanAddedLines: number;
  totalAddedLines: number;
  deletedLines: number;
  contributingTurns: Set<number>;
}> {
  // diff1: all changes in this commit (parent → committed)
  const diff1Output = await gitDiffUnified0(parentBlob, committedBlob);
  const diff1Hunks = parseUnifiedHunks(diff1Output);
  const diff1Added = expandNewPositions(diff1Hunks);
  const { added: totalAddedLines, deleted: deletedLines } = countLines(diff1Hunks);

  if (turnPairs.length === 0 || totalAddedLines === 0) {
    return {
      aiAddedLines: 0,
      humanAddedLines: totalAddedLines,
      totalAddedLines,
      deletedLines,
      contributingTurns: new Set<number>(),
    };
  }

  // Per-turn: compute AI positions and union them.
  const aiPositions = new Set<number>();
  const contributingTurns = new Set<number>();

  for (const { preBlob, postBlob, turn } of turnPairs) {
    // diff2_T: changes from pre_T to committed (AI + human-after)
    const diff2Output = await gitDiffUnified0(preBlob, committedBlob);
    const diff2Positions = expandNewPositions(parseUnifiedHunks(diff2Output));

    // diff3_T: changes from post_T to committed (human-after only)
    const diff3Output = await gitDiffUnified0(postBlob, committedBlob);
    const diff3Positions = expandNewPositions(parseUnifiedHunks(diff3Output));

    // AI_T = positions in diff2 but NOT in diff3
    for (const pos of diff2Positions) {
      if (!diff3Positions.has(pos)) {
        aiPositions.add(pos);
      }
    }

    if (turn !== undefined && turn > 0) {
      for (const pos of diff1Added) {
        if (diff2Positions.has(pos) && !diff3Positions.has(pos)) {
          contributingTurns.add(turn);
          break;
        }
      }
    }
  }

  // Attribute each added line in diff1
  let aiAddedLines = 0;
  let humanAddedLines = 0;

  for (const pos of diff1Added) {
    if (aiPositions.has(pos)) {
      aiAddedLines++;
    } else {
      humanAddedLines++;
    }
  }

  return { aiAddedLines, humanAddedLines, totalAddedLines, deletedLines, contributingTurns };
}

/** Run `git diff --unified=0` between two blob hashes. */
async function gitDiffUnified0(blobA: string, blobB: string): Promise<string> {
  // Guard: empty string means "no blob" (file didn't exist). Treat as no diff.
  if (!blobA || !blobB || blobA === blobB) return "";
  // git diff exits with code 1 when there are differences — not an error.
  // Any other non-zero exit (e.g. missing blob object) is a hard failure.
  const { stdout, exitCode } = await gitSafe(["diff", "--unified=0", "--no-color", blobA, blobB]);
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`git diff failed with exit code ${exitCode}`);
  }
  return stdout;
}

// Re-export EMPTY_BLOB so callers don't need a separate import.
export { EMPTY_BLOB };
