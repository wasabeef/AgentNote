import { SCHEMA_VERSION } from "./constants.js";

export interface Interaction {
  prompt: string;
  response: string | null;
  files_touched?: string[];
}

export interface AgentnoteEntry {
  v: number;
  session_id: string;
  timestamp: string;
  interactions: Interaction[];
  files_in_commit: string[];
  files_by_ai: string[];
  ai_ratio: number;
  /** Lines added by AI (present only when line-level attribution is available). */
  ai_added_lines?: number;
  /** Total lines added in this commit (present only when line-level attribution is available). */
  total_added_lines?: number;
  /** Total lines deleted in this commit (present only when line-level attribution is available). */
  deleted_lines?: number;
}

export interface LineCounts {
  aiAddedLines: number;
  totalAddedLines: number;
  deletedLines: number;
}

/**
 * Calculate AI ratio.
 * When line counts are available, uses line-level ratio (added lines only).
 * Falls back to file-level ratio for legacy notes without blob data.
 */
export function calcAiRatio(
  commitFiles: string[],
  aiFiles: string[],
  lineCounts?: LineCounts,
): number {
  if (lineCounts && lineCounts.totalAddedLines > 0) {
    return Math.round((lineCounts.aiAddedLines / lineCounts.totalAddedLines) * 100);
  }
  if (commitFiles.length === 0) return 0;
  const aiSet = new Set(aiFiles);
  const matched = commitFiles.filter((f) => aiSet.has(f));
  return Math.round((matched.length / commitFiles.length) * 100);
}

/** Build an agentnote entry from collected data. */
export function buildEntry(opts: {
  sessionId: string;
  interactions: Interaction[];
  commitFiles: string[];
  aiFiles: string[];
  lineCounts?: LineCounts;
}): AgentnoteEntry {
  const entry: AgentnoteEntry = {
    v: SCHEMA_VERSION,
    session_id: opts.sessionId,
    timestamp: new Date().toISOString(),
    interactions: opts.interactions.map((i) => {
      const base: Interaction = { prompt: i.prompt, response: i.response };
      if (i.files_touched && i.files_touched.length > 0) {
        base.files_touched = i.files_touched;
      }
      return base;
    }),
    files_in_commit: opts.commitFiles,
    files_by_ai: opts.aiFiles,
    ai_ratio: calcAiRatio(opts.commitFiles, opts.aiFiles, opts.lineCounts),
  };
  if (opts.lineCounts) {
    entry.ai_added_lines = opts.lineCounts.aiAddedLines;
    entry.total_added_lines = opts.lineCounts.totalAddedLines;
    entry.deleted_lines = opts.lineCounts.deletedLines;
  }
  return entry;
}
