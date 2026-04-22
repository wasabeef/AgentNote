import type { AgentnoteEntry } from "../core/entry.js";

function isStructuredEntry(raw: Record<string, unknown>): raw is AgentnoteEntry {
  return Array.isArray(raw.interactions) && Array.isArray(raw.files) && !!raw.attribution;
}

/**
 * Normalize a raw git note into the current structured AgentnoteEntry schema.
 * Older flat note formats are no longer supported.
 */
export function normalizeEntry(raw: Record<string, unknown>): AgentnoteEntry {
  if (!isStructuredEntry(raw)) {
    throw new Error("unsupported agent-note entry format");
  }
  return raw;
}
