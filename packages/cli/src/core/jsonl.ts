import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/** Read a specific field from each line of a JSONL file. Deduplicates values. */
export async function readJsonlField(
  filePath: string,
  field: string,
): Promise<string[]> {
  if (!existsSync(filePath)) return [];
  const content = await readFile(filePath, "utf-8");
  const seen = new Set<string>();
  const values: string[] = [];
  for (const line of content.trim().split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      const val = entry[field];
      if (val && !seen.has(val)) {
        seen.add(val);
        values.push(val);
      }
    } catch {
      // skip malformed lines
    }
  }
  return values;
}

/** Append a JSON object as a single line to a JSONL file. */
export async function appendJsonl(
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  await appendFile(filePath, JSON.stringify(data) + "\n");
}
