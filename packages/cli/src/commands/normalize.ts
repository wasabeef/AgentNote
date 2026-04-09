import type { AgentnoteEntry, Attribution, FileEntry, Interaction } from "../core/entry.js";

/**
 * Normalize a raw git note (v1 flat or new structured) into AgentnoteEntry.
 * Handles both old flat fields and new structured fields gracefully.
 */
export function normalizeEntry(raw: Record<string, unknown>): AgentnoteEntry {
  // New structured format: has `files` array and `attribution` object.
  if (raw.files && raw.attribution) {
    return raw as unknown as AgentnoteEntry;
  }

  // Legacy flat format: convert to structured.
  const filesInCommit = (raw.files_in_commit as string[]) ?? [];
  const filesByAi = new Set((raw.files_by_ai as string[]) ?? []);
  const files: FileEntry[] = filesInCommit.map((path) => ({
    path,
    by_ai: filesByAi.has(path),
  }));

  const aiRatio = (raw.ai_ratio as number) ?? 0;
  const aiAddedLines = raw.ai_added_lines as number | undefined;
  const totalAddedLines = raw.total_added_lines as number | undefined;
  const deletedLines = raw.deleted_lines as number | undefined;

  let attribution: Attribution;
  if (aiAddedLines !== undefined && totalAddedLines !== undefined) {
    attribution = {
      ai_ratio: aiRatio,
      method: totalAddedLines > 0 ? "line" : "none",
      lines: {
        ai_added: aiAddedLines,
        total_added: totalAddedLines,
        deleted: deletedLines ?? 0,
      },
    };
  } else {
    attribution = { ai_ratio: aiRatio, method: "file" };
  }

  // Legacy interactions (may have `prompts` instead of `interactions`).
  const legacyPrompts = raw.prompts as string[] | undefined;
  const interactions: Interaction[] =
    (raw.interactions as Interaction[]) ??
    (legacyPrompts ?? []).map((p: string) => ({ prompt: p, response: null }));

  return {
    v: (raw.v as number) ?? 1,
    session_id: (raw.session_id as string) ?? "",
    timestamp: (raw.timestamp as string) ?? "",
    model: (raw.model as string) ?? null,
    interactions,
    files,
    attribution,
  };
}
