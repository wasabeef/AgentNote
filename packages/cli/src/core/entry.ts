import { SCHEMA_VERSION } from "./constants.js";

// ─── Interfaces ───

export interface FileEntry {
  path: string;
  by_ai: boolean;
}

export interface AttributionLines {
  ai_added: number;
  total_added: number;
  deleted: number;
}

export interface Attribution {
  ai_ratio: number;
  method: "line" | "file" | "none";
  lines?: AttributionLines;
}

export interface Interaction {
  prompt: string;
  response: string | null;
  files_touched?: string[];
  tools?: string[] | null;
}

export interface AgentnoteEntry {
  v: number;
  session_id: string;
  timestamp: string;
  model?: string | null;
  interactions: Interaction[];
  files: FileEntry[];
  attribution: Attribution;
}

// ─── Internal types ───

export interface LineCounts {
  aiAddedLines: number;
  totalAddedLines: number;
  deletedLines: number;
}

// ─── Functions ───

/**
 * Calculate AI ratio.
 * When line counts are available, uses line-level ratio (added lines only).
 * Falls back to file-count ratio when blob data is unavailable.
 */
export function calcAiRatio(files: FileEntry[], lineCounts?: LineCounts): number {
  if (lineCounts && lineCounts.totalAddedLines > 0) {
    return Math.round((lineCounts.aiAddedLines / lineCounts.totalAddedLines) * 100);
  }
  if (files.length === 0) return 0;
  const aiCount = files.filter((f) => f.by_ai).length;
  return Math.round((aiCount / files.length) * 100);
}

/** Determine attribution method from available data. */
function resolveMethod(lineCounts?: LineCounts): "line" | "file" | "none" {
  if (!lineCounts) return "file";
  if (lineCounts.totalAddedLines === 0) return "none";
  return "line";
}

/** Build an agentnote entry from collected data. */
export function buildEntry(opts: {
  sessionId: string;
  model?: string | null;
  interactions: Interaction[];
  commitFiles: string[];
  aiFiles: string[];
  lineCounts?: LineCounts;
  /** Per-interaction tools, keyed by interaction index. null = no data. */
  interactionTools?: Map<number, string[] | null>;
}): AgentnoteEntry {
  const files: FileEntry[] = opts.commitFiles.map((path) => ({
    path,
    by_ai: opts.aiFiles.includes(path),
  }));

  const method = resolveMethod(opts.lineCounts);
  const aiRatio = method === "none" ? 0 : calcAiRatio(files, opts.lineCounts);

  const attribution: Attribution = { ai_ratio: aiRatio, method };
  if (opts.lineCounts) {
    attribution.lines = {
      ai_added: opts.lineCounts.aiAddedLines,
      total_added: opts.lineCounts.totalAddedLines,
      deleted: opts.lineCounts.deletedLines,
    };
  }

  const interactions = opts.interactions.map((i, idx) => {
    const base: Interaction = { prompt: i.prompt, response: i.response };
    if (i.files_touched && i.files_touched.length > 0) {
      base.files_touched = i.files_touched;
    }
    // Attach tools from interactionTools map (preserving null), or inherit from interaction.
    if (opts.interactionTools?.has(idx)) {
      base.tools = opts.interactionTools.get(idx) ?? null;
    } else if (i.tools !== undefined) {
      base.tools = i.tools;
    }
    return base;
  });

  return {
    v: SCHEMA_VERSION,
    session_id: opts.sessionId,
    timestamp: new Date().toISOString(),
    model: opts.model ?? null,
    interactions,
    files,
    attribution,
  };
}
