import type { AgentnoteEntry } from "../core/entry.js";

function isStructuredEntry(raw: unknown): raw is AgentnoteEntry {
  if (!raw || typeof raw !== "object") return false;
  const entry = raw as {
    interactions?: unknown;
    files?: unknown;
    attribution?: unknown;
  };
  return Array.isArray(entry.interactions) && Array.isArray(entry.files) && !!entry.attribution;
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
