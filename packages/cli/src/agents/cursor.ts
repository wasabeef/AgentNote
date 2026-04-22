import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AgentAdapter, HookInput, NormalizedEvent, TranscriptInteraction } from "./types.js";

const HOOKS_REL_PATH = ".cursor/hooks.json";
const HOOK_COMMAND = "npx --yes agent-note hook --agent cursor";
const CURSOR_PROJECTS_DIR = join(homedir(), ".cursor", "projects");
const CURSOR_TRANSCRIPTS_DIR_ENV = "AGENTNOTE_CURSOR_TRANSCRIPTS_DIR";
const TRANSCRIPT_WAIT_MS = 1_500;
const TRANSCRIPT_POLL_MS = 50;

type CursorHookEntry = {
  command: string;
};

type CursorHooksConfig = {
  version?: number;
  hooks?: Record<string, CursorHookEntry[]>;
};

type CursorHookPayload = {
  hook_event_name?: string;
  conversation_id?: string;
  conversationId?: string;
  session_id?: string;
  sessionId?: string;
  model?: string;
  prompt?: string;
  text?: string;
  response?: string;
  content?: unknown;
  message?: unknown;
  output?: unknown;
  command?: string;
  file_path?: string;
  filePath?: string;
  edits?: unknown;
};

type CursorEditStats = {
  added: number;
  deleted: number;
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

  const texts: string[] = [];
  const seenStrings = new Set<string>();

  for (const candidate of [
    value.text,
    value.content,
    value.parts,
    value.message,
    value.payload,
    value.input,
    value.output,
    value.value,
  ]) {
    for (const text of collectMessageText(candidate, seen)) {
      appendUnique(texts, seenStrings, text);
    }
  }

  return texts;
}

function extractRole(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const directRole = value.role;
  if (typeof directRole === "string" && directRole.trim()) {
    return directRole.trim().toLowerCase();
  }

  return extractRole(value.message) ?? extractRole(value.payload);
}

function sanitizePathForCursor(path: string): string {
  return path.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]/g, "-");
}

function countTextLines(value: string): number {
  if (!value) return 0;
  const normalized = value.replace(/\r\n/g, "\n");
  if (normalized === "\n") return 1;
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed ? trimmed.split("\n").length : 0;
}

function extractEditStats(value: unknown): CursorEditStats | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  let added = 0;
  let deleted = 0;
  let sawEdit = false;

  for (const item of value) {
    if (!isRecord(item)) continue;
    const oldString =
      typeof item.old_string === "string"
        ? item.old_string
        : typeof item.oldString === "string"
          ? item.oldString
          : "";
    const newString =
      typeof item.new_string === "string"
        ? item.new_string
        : typeof item.newString === "string"
          ? item.newString
          : "";
    if (!oldString && !newString) continue;
    sawEdit = true;
    deleted += countTextLines(oldString);
    added += countTextLines(newString);
  }

  return sawEdit ? { added, deleted } : null;
}

function repoRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    }).trim();
  } catch {
    return resolve(process.cwd());
  }
}

function cursorTranscriptDir(): string {
  const override = process.env[CURSOR_TRANSCRIPTS_DIR_ENV]?.trim();
  if (override) return resolve(override);
  return join(CURSOR_PROJECTS_DIR, sanitizePathForCursor(repoRoot()), "agent-transcripts");
}

function isValidTranscriptPath(transcriptPath: string): boolean {
  const normalized = resolve(transcriptPath);
  const roots = [resolve(CURSOR_PROJECTS_DIR)];
  const override = process.env[CURSOR_TRANSCRIPTS_DIR_ENV]?.trim();
  if (override) {
    roots.unshift(resolve(override));
  }

  return roots.some((root) => normalized === root || normalized.startsWith(`${root}${sep}`));
}

function resolveTranscriptPath(sessionDir: string, sessionId: string): string | null {
  const nestedDir = join(sessionDir, sessionId);
  const nestedPath = join(nestedDir, `${sessionId}.jsonl`);
  try {
    if (existsSync(nestedPath)) return nestedPath;
    if (existsSync(nestedDir) && statSync(nestedDir).isDirectory()) return nestedPath;
  } catch {
    // fall through to flat layout
  }

  const flatPath = join(sessionDir, `${sessionId}.jsonl`);
  return existsSync(flatPath) ? flatPath : null;
}

function extractPlainTextInteractions(content: string): TranscriptInteraction[] {
  const lines = content.split("\n");
  const interactions: TranscriptInteraction[] = [];
  let currentPrompt: string | null = null;
  let currentResponse: string[] = [];
  let activeRole: "user" | "assistant" | null = null;

  const flush = () => {
    if (!currentPrompt?.trim()) return;
    interactions.push({
      prompt: currentPrompt.trim(),
      response: currentResponse.length > 0 ? currentResponse.join("\n").trim() : null,
    });
  };

  for (const line of lines) {
    const userMatch = line.match(/^(?:user|human):\s*(.*)$/i);
    if (userMatch) {
      flush();
      currentPrompt = userMatch[1] ?? "";
      currentResponse = [];
      activeRole = "user";
      continue;
    }

    const assistantMatch = line.match(/^(?:assistant|ai):\s*(.*)$/i);
    if (assistantMatch) {
      if (!currentPrompt) continue;
      currentResponse = assistantMatch[1] ? [assistantMatch[1]] : [];
      activeRole = "assistant";
      continue;
    }

    if (activeRole === "user" && currentPrompt !== null) {
      currentPrompt = `${currentPrompt}\n${line}`.trim();
    } else if (activeRole === "assistant" && currentPrompt) {
      currentResponse.push(line);
    }
  }

  flush();
  return interactions;
}

async function waitForTranscriptReady(transcriptPath: string): Promise<boolean> {
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS;

  while (Date.now() <= deadline) {
    try {
      if (existsSync(transcriptPath) && statSync(transcriptPath).size > 0) {
        return true;
      }
    } catch {
      // keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, TRANSCRIPT_POLL_MS));
  }

  return false;
}

function extractJsonlInteractions(content: string): TranscriptInteraction[] {
  const interactions: TranscriptInteraction[] = [];
  let pendingPrompt: string | null = null;
  let pendingResponse: string[] = [];

  const flush = () => {
    if (!pendingPrompt?.trim()) return;
    interactions.push({
      prompt: pendingPrompt.trim(),
      response: pendingResponse.length > 0 ? pendingResponse.join("\n").trim() : null,
    });
  };

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }

    const role = extractRole(parsed);
    if (!role) continue;

    const text = collectMessageText(parsed).join("\n").trim();
    if (!text) continue;

    if (role === "user" || role === "human") {
      flush();
      pendingPrompt = text;
      pendingResponse = [];
      continue;
    }

    if ((role === "assistant" || role === "model") && pendingPrompt) {
      pendingResponse.push(text);
    }
  }

  flush();
  return interactions;
}

function sessionIdFromPayload(payload: CursorHookPayload): string | null {
  const value =
    payload.conversation_id ??
    payload.conversationId ??
    payload.session_id ??
    payload.sessionId ??
    null;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildHooksConfig(): CursorHooksConfig {
  return {
    version: 1,
    hooks: {
      beforeSubmitPrompt: [{ command: HOOK_COMMAND }],
      beforeShellExecution: [{ command: HOOK_COMMAND }],
      afterAgentResponse: [{ command: HOOK_COMMAND }],
      afterFileEdit: [{ command: HOOK_COMMAND }],
      afterTabFileEdit: [{ command: HOOK_COMMAND }],
      afterShellExecution: [{ command: HOOK_COMMAND }],
      stop: [{ command: HOOK_COMMAND }],
    },
  };
}

function isGitCommit(command: string): boolean {
  return command.includes("git commit") && !command.includes("--amend");
}

function stripAgentnoteHooks(config: CursorHooksConfig): CursorHooksConfig {
  if (!config.hooks) {
    return { version: config.version ?? 1, hooks: {} };
  }

  const hooks = Object.fromEntries(
    Object.entries(config.hooks)
      .map(([event, entries]) => [
        event,
        entries.filter(
          (entry) => !entry.command.includes("agent-note hook"),
        ),
      ])
      .filter(([, entries]) => entries.length > 0),
  );

  return { version: config.version ?? 1, hooks };
}

function mergeHooksConfig(existing: CursorHooksConfig): CursorHooksConfig {
  const clean = stripAgentnoteHooks(existing);
  const next = buildHooksConfig();
  const mergedHooks = { ...(clean.hooks ?? {}) };

  for (const [event, entries] of Object.entries(next.hooks ?? {})) {
    mergedHooks[event] = [...(mergedHooks[event] ?? []), ...entries];
  }

  return {
    version: 1,
    hooks: mergedHooks,
  };
}

export const cursor: AgentAdapter = {
  name: "cursor",
  settingsRelPath: HOOKS_REL_PATH,

  async managedPaths(): Promise<string[]> {
    return [HOOKS_REL_PATH];
  },

  async installHooks(repoRoot: string): Promise<void> {
    const cursorDir = join(repoRoot, ".cursor");
    const hooksPath = join(repoRoot, HOOKS_REL_PATH);
    await mkdir(cursorDir, { recursive: true });

    let hooksConfig: CursorHooksConfig = {};
    if (existsSync(hooksPath)) {
      try {
        hooksConfig = JSON.parse(await readFile(hooksPath, "utf-8")) as CursorHooksConfig;
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
      const parsed = JSON.parse(await readFile(hooksPath, "utf-8")) as CursorHooksConfig;
      await writeFile(hooksPath, `${JSON.stringify(stripAgentnoteHooks(parsed), null, 2)}\n`);
    } catch {
      // leave malformed config untouched
    }
  },

  async isEnabled(repoRoot: string): Promise<boolean> {
    const hooksPath = join(repoRoot, HOOKS_REL_PATH);
    if (!existsSync(hooksPath)) return false;

    try {
      const content = await readFile(hooksPath, "utf-8");
      return content.includes(HOOK_COMMAND);
    } catch {
      return false;
    }
  },

  parseEvent(input: HookInput): NormalizedEvent | null {
    let payload: CursorHookPayload;
    try {
      payload = JSON.parse(input.raw) as CursorHookPayload;
    } catch {
      return null;
    }

    const sessionId = sessionIdFromPayload(payload);
    if (!sessionId) return null;

    const timestamp = new Date().toISOString();

    switch (payload.hook_event_name) {
      case "beforeSubmitPrompt":
        return payload.prompt
          ? {
              kind: "prompt",
              sessionId,
              timestamp,
              prompt: payload.prompt,
              model: payload.model,
            }
          : null;

      case "afterAgentResponse": {
        const response = collectMessageText(
          payload.response ?? payload.text ?? payload.content ?? payload.message ?? payload.output,
        )
          .join("\n")
          .trim();
        return response
          ? {
              kind: "response",
              sessionId,
              timestamp,
              response,
            }
          : null;
      }

      case "beforeShellExecution":
        return payload.command && isGitCommit(payload.command)
          ? {
              kind: "pre_commit",
              sessionId,
              timestamp,
              commitCommand: payload.command,
            }
          : null;

      case "afterFileEdit":
      case "afterTabFileEdit": {
        const filePath = payload.file_path ?? payload.filePath;
        const editStats = extractEditStats(payload.edits);
        return filePath
          ? {
              kind: "file_change",
              sessionId,
              timestamp,
              file: filePath,
              tool: payload.hook_event_name,
              ...(editStats ? { editStats } : {}),
            }
          : null;
      }

      case "afterShellExecution":
        return payload.command && isGitCommit(payload.command)
          ? {
              kind: "post_commit",
              sessionId,
              timestamp,
            }
          : null;

      case "stop": {
        const response = collectMessageText(
          payload.response ?? payload.text ?? payload.content ?? payload.message ?? payload.output,
        )
          .join("\n")
          .trim();
        return {
          kind: "stop",
          sessionId,
          timestamp,
          response: response || undefined,
        };
      }

      default:
        return null;
    }
  },

  findTranscript(sessionId: string): string | null {
    return resolveTranscriptPath(cursorTranscriptDir(), sessionId);
  },

  async extractInteractions(transcriptPath: string): Promise<TranscriptInteraction[]> {
    if (!isValidTranscriptPath(transcriptPath)) return [];

    const ready = await waitForTranscriptReady(transcriptPath);
    if (!ready) return [];

    let content = "";
    try {
      content = await readFile(transcriptPath, "utf-8");
    } catch {
      return [];
    }

    if (!content.trim()) return [];
    const trimmed = content.trimStart();
    return trimmed.startsWith("{")
      ? extractJsonlInteractions(content)
      : extractPlainTextInteractions(content);
  },
};
