const SCHEMA_VERSION = 1;

interface Interaction {
  prompt: string;
  response: string | null;
}

export interface AgentnoteEntry {
  v: number;
  session_id: string;
  timestamp: string;
  interactions: Interaction[];
  files_in_commit: string[];
  files_by_ai: string[];
  ai_ratio: number;
}

/** Calculate the ratio of files in the commit that were touched by AI. */
export function calcAiRatio(
  commitFiles: string[],
  aiFiles: string[],
): number {
  if(commitFiles.length === 0)return 0;
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
}): AgentnoteEntry {
  return {
    v: SCHEMA_VERSION,
    session_id: opts.sessionId,
    timestamp: new Date().toISOString(),
    interactions: opts.interactions,
    files_in_commit: opts.commitFiles,
    files_by_ai: opts.aiFiles,
    ai_ratio: calcAiRatio(opts.commitFiles, opts.aiFiles),
  };
}
