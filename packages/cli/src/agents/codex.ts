import { createReadStream, type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { TEXT_ENCODING } from "../core/constants.js";
import { isAgentNoteHookCommand } from "./hook-command.js";
import {
  AGENT_NAMES,
  type AgentAdapter,
  type HookInput,
  NORMALIZED_EVENT_KINDS,
  type NormalizedEvent,
  type TranscriptInteraction,
} from "./types.js";

const CONFIG_REL_PATH = ".codex/config.toml";
const ENV_CODEX_HOME = "CODEX_HOME";
const HOOKS_REL_PATH = ".codex/hooks.json";
const HOOK_COMMAND = `npx --yes agent-note hook --agent ${AGENT_NAMES.codex}`;
const TRANSCRIPT_PREVIEW_CHARS = 4096;
const CODEX_HOOK_EVENTS = {
  sessionStart: "SessionStart",
  userPromptSubmit: "UserPromptSubmit",
  stop: "Stop",
} as const;

type CodexHookPayload = {
  session_id?: string;
  transcript_path?: string | null;
  hook_event_name?: string;
  model?: string;
  prompt?: string;
  last_assistant_message?: string | null;
};

type CodexHooksFile = {
  hooks?: Record<
    string,
    Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>
  >;
};

type RolloutLine = {
  type?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendUnique(values: string[], seen: Set<string>, next: string): void {
  const trimmed = next.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  values.push(trimmed);
}

function collectMessageText(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (!value || seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMessageText(item, seen));
  }

  if (!isRecord(value)) return [];

  if (typeof value.text === "string") {
    return value.text.trim() ? [value.text.trim()] : [];
  }

  if (typeof value.value === "string") {
    return value.value.trim() ? [value.value.trim()] : [];
  }

  return [
    ...collectMessageText(value.text, seen),
    ...collectMessageText(value.content, seen),
    ...collectMessageText(value.input, seen),
    ...collectMessageText(value.output, seen),
    ...collectMessageText(value.value, seen),
  ];
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function collectPatchStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const parsed = parseJsonString(value);
      if (parsed !== value) return collectPatchStrings(parsed, seen);
    }
    if (value.includes("*** Begin Patch")) return [value];
    return [];
  }

  if (!value || seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPatchStrings(item, seen));
  }

  if (!isRecord(value)) return [];

  return [
    ...collectPatchStrings(value.patch, seen),
    ...collectPatchStrings(value.input, seen),
    ...collectPatchStrings(value.arguments, seen),
    ...collectPatchStrings(value.content, seen),
    ...collectPatchStrings(value.text, seen),
  ];
}

/**
 * Identify the Agent Note session inside a Codex transcript candidate.
 *
 * Transcript files can grow quickly during long sessions, so discovery reads a
 * bounded prefix and accepts both parsed JSONL metadata and raw-text fallback
 * matches for partially written files.
 */
function readTranscriptSessionId(candidate: string): string | null {
  try {
    const preview = readFileSync(candidate, TEXT_ENCODING).slice(0, TRANSCRIPT_PREVIEW_CHARS);
    for (const rawLine of preview.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const entry = JSON.parse(line) as RolloutLine;
        const sessionId = entry.type === "session_meta" ? entry.payload?.id : undefined;
        if (typeof sessionId === "string" && sessionId.trim()) {
          return sessionId;
        }
      } catch {
        const match = line.match(/"type"\s*:\s*"session_meta"[\s\S]*?"id"\s*:\s*"([^"]+)"/);
        if (match?.[1]) return match[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Find the Codex transcript that belongs to the current Agent Note session.
 *
 * Codex has used both flat and nested transcript layouts, so the search is
 * breadth-first and bounded to avoid expensive scans in large history dirs.
 */
function findTranscriptCandidate(rootDir: string, sessionId: string): string | null {
  const queue: string[] = [rootDir];
  let scanned = 0;

  while (queue.length > 0 && scanned < 256) {
    const current = queue.shift();
    if (!current) break;

    let entries: Dirent<string>[];
    try {
      entries = readdirSync(current, { withFileTypes: true }) as Dirent<string>[];
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const candidate = join(current, entry.name);
      if (!isValidTranscriptPath(candidate)) continue;

      if (entry.isDirectory()) {
        queue.push(candidate);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      scanned += 1;

      if (entry.name === `${sessionId}.jsonl`) {
        return candidate;
      }

      if (readTranscriptSessionId(candidate) === sessionId) {
        return candidate;
      }
    }
  }

  return null;
}

function codexHome(): string {
  return process.env[ENV_CODEX_HOME] ?? join(homedir(), ".codex");
}

function isValidTranscriptPath(transcriptPath: string): boolean {
  const base = resolve(codexHome());
  const normalized = resolve(transcriptPath);
  return normalized === base || normalized.startsWith(`${base}${sep}`);
}

function normalizeTranscriptPath(value?: string | null): string | undefined {
  if (!value) return undefined;
  return isValidTranscriptPath(value) ? value : undefined;
}

function normalizeConfigToml(content: string): string {
  if (content.match(/^\s*features\.codex_hooks\s*=\s*(true|false)\s*$/m)) {
    return content.replace(
      /^\s*features\.codex_hooks\s*=\s*(true|false)\s*$/m,
      "features.codex_hooks = true",
    );
  }

  if (content.match(/^\s*\[features\]\s*$/m)) {
    if (content.match(/^\s*codex_hooks\s*=\s*(true|false)\s*$/m)) {
      return content.replace(/^\s*codex_hooks\s*=\s*(true|false)\s*$/m, "codex_hooks = true");
    }

    return content.replace(/^\s*\[features\]\s*$/m, "[features]\ncodex_hooks = true");
  }

  const trimmed = content.trimEnd();
  return trimmed.length > 0
    ? `${trimmed}\n\n[features]\ncodex_hooks = true\n`
    : "[features]\ncodex_hooks = true\n";
}

function buildHooksConfig(): CodexHooksFile {
  const hookEntry = { type: "command", command: HOOK_COMMAND };
  const groups = [{ hooks: [hookEntry] }];
  return {
    hooks: {
      SessionStart: groups,
      UserPromptSubmit: groups,
      Stop: groups,
    },
  };
}

function stripAgentnoteHooks(config: CodexHooksFile): CodexHooksFile {
  if (!config.hooks) return { hooks: {} };
  const hooks = Object.fromEntries(
    Object.entries(config.hooks)
      .map(([event, groups]) => {
        const filteredGroups = groups
          .map((group) => ({
            ...group,
            hooks: group.hooks.filter(
              (hook) =>
                !isAgentNoteHookCommand(hook.command, AGENT_NAMES.codex, {
                  allowMissingAgent: true,
                }),
            ),
          }))
          .filter((group) => group.hooks.length > 0);
        return [event, filteredGroups];
      })
      .filter(([, groups]) => groups.length > 0),
  );
  return { hooks };
}

function mergeHooksConfig(existing: CodexHooksFile): CodexHooksFile {
  const clean = stripAgentnoteHooks(existing);
  const next = buildHooksConfig();
  return {
    hooks: {
      ...(clean.hooks ?? {}),
      ...(next.hooks ?? {}),
    },
  };
}

function extractFilesFromApplyPatch(input: string): string[] {
  const regex = /^\*\*\* (?:Add|Update|Delete) File: ([^\n]+)$/gm;
  const files: string[] = [];
  const seen = new Set<string>();
  for (const match of input.matchAll(regex)) {
    const file = match[1]?.trim();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    files.push(file);
  }
  return files;
}

function extractLineStatsFromApplyPatch(
  input: string,
): Record<string, { added: number; deleted: number }> {
  const stats: Record<string, { added: number; deleted: number }> = {};
  let currentFile: string | null = null;

  for (const rawLine of input.split("\n")) {
    const line = rawLine.trimEnd();
    const header = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (header) {
      currentFile = header[1]?.trim() || null;
      if (currentFile && !stats[currentFile]) {
        stats[currentFile] = { added: 0, deleted: 0 };
      }
      continue;
    }

    if (!currentFile) continue;
    if (line.startsWith("*** End") || line.startsWith("*** Begin") || line.startsWith("@@"))
      continue;
    if (line.startsWith("+")) {
      stats[currentFile].added += 1;
      continue;
    }
    if (line.startsWith("-")) {
      stats[currentFile].deleted += 1;
    }
  }

  return stats;
}

function normalizeInteractionFilePath(filePath: string, sessionCwd?: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.includes("\r")) return null;

  if (!isAbsolute(trimmed)) {
    return trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  }

  const normalized = resolve(trimmed);
  if (!sessionCwd) return normalized;

  const base = resolve(sessionCwd);
  if (normalized === base) return ".";
  if (normalized.startsWith(`${base}${sep}`)) {
    return relative(base, normalized).split(sep).join("/");
  }

  return normalized;
}

function appendInteractionTool(
  interaction: TranscriptInteraction,
  toolName: string | undefined,
): void {
  if (!toolName) return;
  const tools = interaction.tools ?? [];
  if (tools.includes(toolName)) return;
  interaction.tools = [...tools, toolName];
}

/** Codex CLI adapter for transcript-driven prompt, patch, and attribution recovery. */
export const codex: AgentAdapter = {
  name: AGENT_NAMES.codex,
  settingsRelPath: CONFIG_REL_PATH,

  async managedPaths(): Promise<string[]> {
    return [CONFIG_REL_PATH, HOOKS_REL_PATH];
  },

  async installHooks(repoRoot: string): Promise<void> {
    const codexDir = join(repoRoot, ".codex");
    const configPath = join(repoRoot, CONFIG_REL_PATH);
    const hooksPath = join(repoRoot, HOOKS_REL_PATH);
    await mkdir(codexDir, { recursive: true });

    const configContent = existsSync(configPath) ? await readFile(configPath, TEXT_ENCODING) : "";
    await writeFile(configPath, normalizeConfigToml(configContent));

    let hooksConfig: CodexHooksFile = {};
    if (existsSync(hooksPath)) {
      try {
        hooksConfig = JSON.parse(await readFile(hooksPath, TEXT_ENCODING)) as CodexHooksFile;
      } catch {
        hooksConfig = {};
      }
    }

    await writeFile(hooksPath, `${JSON.stringify(mergeHooksConfig(hooksConfig), null, 2)}\n`);
  },

  async removeHooks(repoRoot: string): Promise<void> {
    const hooksPath = join(repoRoot, HOOKS_REL_PATH);
    if (!existsSync(hooksPath)) return;

    try {
      const parsed = JSON.parse(await readFile(hooksPath, TEXT_ENCODING)) as CodexHooksFile;
      await writeFile(hooksPath, `${JSON.stringify(stripAgentnoteHooks(parsed), null, 2)}\n`);
    } catch {
      // leave malformed config untouched
    }
  },

  async isEnabled(repoRoot: string): Promise<boolean> {
    const configPath = join(repoRoot, CONFIG_REL_PATH);
    const hooksPath = join(repoRoot, HOOKS_REL_PATH);
    if (!existsSync(configPath) || !existsSync(hooksPath)) return false;

    try {
      const [configContent, hooksContent] = await Promise.all([
        readFile(configPath, TEXT_ENCODING),
        readFile(hooksPath, TEXT_ENCODING),
      ]);
      const configOk =
        configContent.includes("features.codex_hooks = true") ||
        (configContent.includes("[features]") &&
          configContent.match(/^\s*codex_hooks\s*=\s*true\s*$/m) !== null);
      const parsed = JSON.parse(hooksContent) as CodexHooksFile;
      const hasHook = Object.values(parsed.hooks ?? {}).some((groups) =>
        groups.some((group) =>
          group.hooks.some((hook) => isAgentNoteHookCommand(hook.command, AGENT_NAMES.codex)),
        ),
      );
      return configOk && hasHook;
    } catch {
      return false;
    }
  },

  parseEvent(input: HookInput): NormalizedEvent | null {
    let payload: CodexHookPayload;
    try {
      payload = JSON.parse(input.raw) as CodexHookPayload;
    } catch {
      return null;
    }

    const sessionId = payload.session_id?.trim();
    if (!sessionId) return null;
    const timestamp = new Date().toISOString();
    const transcriptPath = normalizeTranscriptPath(payload.transcript_path);

    switch (payload.hook_event_name) {
      case CODEX_HOOK_EVENTS.sessionStart:
        return {
          kind: NORMALIZED_EVENT_KINDS.sessionStart,
          sessionId,
          timestamp,
          model: payload.model,
          transcriptPath,
        };
      case CODEX_HOOK_EVENTS.userPromptSubmit:
        return payload.prompt
          ? {
              kind: NORMALIZED_EVENT_KINDS.prompt,
              sessionId,
              timestamp,
              prompt: payload.prompt,
              transcriptPath,
              model: payload.model,
            }
          : null;
      case CODEX_HOOK_EVENTS.stop:
        return {
          kind: NORMALIZED_EVENT_KINDS.stop,
          sessionId,
          timestamp,
          response: payload.last_assistant_message ?? undefined,
          transcriptPath,
          model: payload.model,
        };
      default:
        return null;
    }
  },

  findTranscript(sessionId: string): string | null {
    const sessionsDir = join(codexHome(), "sessions");
    if (!existsSync(sessionsDir)) return null;

    return findTranscriptCandidate(sessionsDir, sessionId);
  },

  async extractInteractions(transcriptPath: string): Promise<TranscriptInteraction[]> {
    if (!isValidTranscriptPath(transcriptPath)) {
      throw new Error(`Invalid Codex transcript path: ${transcriptPath}`);
    }
    if (!existsSync(transcriptPath)) {
      throw new Error(`Codex transcript not found: ${transcriptPath}`);
    }

    const interactions: TranscriptInteraction[] = [];
    let current: TranscriptInteraction | null = null;
    let sessionCwd: string | undefined;

    const lines = createInterface({
      input: createReadStream(transcriptPath, { encoding: TEXT_ENCODING }),
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    try {
      for await (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        let entry: RolloutLine;
        try {
          entry = JSON.parse(line) as RolloutLine;
        } catch {
          continue;
        }

        if (entry.type === "session_meta" && typeof entry.payload?.cwd === "string") {
          sessionCwd = entry.payload.cwd;
          continue;
        }

        if (entry.type !== "response_item" || !entry.payload) continue;
        const payload = entry.payload;
        const payloadType = typeof payload.type === "string" ? payload.type : undefined;
        const payloadRole = typeof payload.role === "string" ? payload.role : undefined;

        if (payloadType === "message" && payloadRole === "user") {
          const prompt = collectMessageText(payload.content).join("\n");
          if (!prompt) continue;
          if (current) interactions.push(current);
          current = { prompt, response: null };
          if (typeof entry.timestamp === "string") current.timestamp = entry.timestamp;
          continue;
        }

        if (!current) continue;

        if (payloadType === "message" && payloadRole === "assistant") {
          const response = collectMessageText(payload.content).join("\n");
          if (response) {
            current.response = current.response ? `${current.response}\n${response}` : response;
          }
          continue;
        }

        const toolName =
          typeof payload.name === "string"
            ? payload.name
            : typeof payload.call_name === "string"
              ? payload.call_name
              : undefined;

        if (
          (payloadType === "custom_tool_call" ||
            payloadType === "function_call" ||
            payloadType === "tool_use") &&
          toolName
        ) {
          appendInteractionTool(current, toolName);
        }

        if (
          (payloadType === "custom_tool_call" || payloadType === "function_call") &&
          toolName === "apply_patch"
        ) {
          const patchInputs = [
            ...collectPatchStrings(payload.input),
            ...collectPatchStrings(payload.arguments),
          ];
          const files: string[] = [];
          const fileSeen = new Set<string>();
          current.line_stats = current.line_stats ?? {};

          for (const patchInput of patchInputs) {
            for (const file of extractFilesFromApplyPatch(patchInput)) {
              const normalized = normalizeInteractionFilePath(file, sessionCwd);
              if (!normalized) continue;
              appendUnique(files, fileSeen, normalized);
            }

            const lineStats = extractLineStatsFromApplyPatch(patchInput);
            for (const [file, stats] of Object.entries(lineStats)) {
              const normalized = normalizeInteractionFilePath(file, sessionCwd);
              if (!normalized) continue;
              const previous = current.line_stats[normalized] ?? { added: 0, deleted: 0 };
              current.line_stats[normalized] = {
                added: previous.added + stats.added,
                deleted: previous.deleted + stats.deleted,
              };
            }
          }

          if (files.length > 0) {
            current.files_touched = [...new Set([...(current.files_touched ?? []), ...files])];
          }

          if (Object.keys(current.line_stats).length === 0) {
            delete current.line_stats;
          }
        }
      }
    } catch {
      throw new Error(`Failed to read Codex transcript: ${transcriptPath}`);
    }

    if (current) interactions.push(current);
    return interactions;
  },
};
