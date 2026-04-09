import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ───

export interface PrConfig {
  output: "comment" | "description";
  format: "chat" | "table";
}

export interface AgentnoteConfig {
  pr: PrConfig;
}

// ─── Defaults ───

const DEFAULTS: AgentnoteConfig = {
  pr: {
    output: "description",
    format: "chat",
  },
};

// ─── Config file names (checked in order) ───

const CONFIG_FILES = ["agentnote.yml", ".agentnote.yml"];

// ─── Loader ───

/** Load agentnote config from the repo root. Returns defaults if no config file found. */
export async function loadConfig(repoRoot: string): Promise<AgentnoteConfig> {
  for (const name of CONFIG_FILES) {
    const filePath = join(repoRoot, name);
    if (!existsSync(filePath)) continue;

    try {
      const content = await readFile(filePath, "utf-8");
      const raw = parseSimpleYaml(content);
      if (!raw || typeof raw !== "object") return DEFAULTS;
      return mergeConfig(raw);
    } catch {
      return DEFAULTS;
    }
  }

  return DEFAULTS;
}

/**
 * Minimal YAML parser for our config schema.
 * Handles flat keys and one level of nesting. No anchors, multi-doc, or complex types.
 *
 * Supports:
 *   key: value
 *   parent:
 *     child: value
 *   # comments
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection = "";

  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trimEnd(); // strip comments
    if (!line.trim()) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent === 0 && trimmed.includes(":")) {
      const [key, ...valueParts] = trimmed.split(":");
      const value = valueParts.join(":").trim();
      if (value) {
        // Top-level scalar (not used in our schema but handle gracefully).
        (result as Record<string, unknown>)[key.trim()] = value;
        currentSection = "";
      } else {
        // Section header.
        currentSection = key.trim();
        result[currentSection] = result[currentSection] ?? {};
      }
    } else if (indent > 0 && currentSection && trimmed.includes(":")) {
      const [key, ...valueParts] = trimmed.split(":");
      const value = valueParts.join(":").trim();
      result[currentSection][key.trim()] = value;
    }
  }

  return result;
}

/** Merge raw parsed config with defaults. Unknown keys are ignored. */
function mergeConfig(raw: Record<string, unknown>): AgentnoteConfig {
  const pr =
    typeof raw.pr === "object" && raw.pr !== null ? (raw.pr as Record<string, unknown>) : {};

  return {
    pr: {
      output: validateEnum(pr.output, ["comment", "description"], DEFAULTS.pr.output),
      format: validateEnum(pr.format, ["chat", "table"], DEFAULTS.pr.format),
    },
  };
}

/** Validate a value is one of the allowed options, return default if not. */
function validateEnum<T extends string>(value: unknown, allowed: T[], defaultValue: T): T {
  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T;
  }
  return defaultValue;
}
