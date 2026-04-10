import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AgentAdapter, HookInput, NormalizedEvent } from "./types.js";

const CONFIG_REL_PATH = ".codex/config.toml";
const HOOKS_REL_PATH = ".codex/hooks.json";
const HOOK_COMMAND = "npx --yes @wasabeef/agentnote hook --agent codex";

type CodexHookPayload = {
  session_id?: string;
  transcript_path?: string | null;
  hook_event_name?: string;
  model?: string;
  prompt?: string;
  last_assistant_message?: string | null;
};

type CodexHooksFile = {
  hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
};

type RolloutLine = {
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    name?: string;
    input?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
};

function codexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

function isValidTranscriptPath(transcriptPath: string): boolean {
  return transcriptPath.startsWith(codexHome());
}

function normalizeTranscriptPath(value?: string | null): string | undefined {
  if (!value) return undefined;
  return isValidTranscriptPath(value) ? value : undefined;
}

function normalizeConfigToml(content: string): string {
  if (content.match(/^\s*features\.codex_hooks\s*=\s*(true|false)\s*$/m)) {
    return content.replace(/^\s*features\.codex_hooks\s*=\s*(true|false)\s*$/m, "features.codex_hooks = true");
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
            hooks: group.hooks.filter((hook) => !hook.command.includes("agentnote hook")),
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
  const regex = /\*\*\* (?:Add|Update|Delete) File: (.+)/g;
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

export const codex: AgentAdapter = {
  name: "codex",
  settingsRelPath: CONFIG_REL_PATH,

  async managedPaths(): Promise<string[]> {
    return [CONFIG_REL_PATH, HOOKS_REL_PATH];
  },

  async installHooks(repoRoot: string): Promise<void> {
    const codexDir = join(repoRoot, ".codex");
    const configPath = join(repoRoot, CONFIG_REL_PATH);
    const hooksPath = join(repoRoot, HOOKS_REL_PATH);
    await mkdir(codexDir, { recursive: true });

    const configContent = existsSync(configPath) ? await readFile(configPath, "utf-8") : "";
    await writeFile(configPath, normalizeConfigToml(configContent));

    let hooksConfig: CodexHooksFile = {};
    if (existsSync(hooksPath)) {
      try {
        hooksConfig = JSON.parse(await readFile(hooksPath, "utf-8")) as CodexHooksFile;
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
      const parsed = JSON.parse(await readFile(hooksPath, "utf-8")) as CodexHooksFile;
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
        readFile(configPath, "utf-8"),
        readFile(hooksPath, "utf-8"),
      ]);
      const configOk =
        configContent.includes("features.codex_hooks = true") ||
        (configContent.includes("[features]") &&
          configContent.match(/^\s*codex_hooks\s*=\s*true\s*$/m) !== null);
      return configOk && hooksContent.includes(HOOK_COMMAND);
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
      case "SessionStart":
        return {
          kind: "session_start",
          sessionId,
          timestamp,
          model: payload.model,
          transcriptPath,
        };
      case "UserPromptSubmit":
        return payload.prompt
          ? {
              kind: "prompt",
              sessionId,
              timestamp,
              prompt: payload.prompt,
              transcriptPath,
              model: payload.model,
            }
          : null;
      case "Stop":
        return {
          kind: "stop",
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

    try {
      for (const entry of readdirSync(sessionsDir)) {
        const candidate = join(sessionsDir, entry);
        if (
          basename(candidate) === `${sessionId}.jsonl` &&
          existsSync(candidate) &&
          isValidTranscriptPath(candidate)
        ) {
          return candidate;
        }
      }
    } catch {
      // ignore unreadable dirs
    }

    return null;
  },

  async extractInteractions(
    transcriptPath: string,
  ): Promise<Array<{ prompt: string; response: string | null; files_touched?: string[] }>> {
    if (!isValidTranscriptPath(transcriptPath) || !existsSync(transcriptPath)) return [];

    let content: string;
    try {
      content = await readFile(transcriptPath, "utf-8");
    } catch {
      return [];
    }

    const interactions: Array<{ prompt: string; response: string | null; files_touched?: string[] }> =
      [];
    let current: { prompt: string; response: string | null; files_touched?: string[] } | null = null;

    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;

      let entry: RolloutLine;
      try {
        entry = JSON.parse(line) as RolloutLine;
      } catch {
        continue;
      }

      if (entry.type !== "response_item" || !entry.payload) continue;
      const payload = entry.payload;

      if (payload.type === "message" && payload.role === "user") {
        const prompt = (payload.content ?? [])
          .filter((item) => item.type === "input_text" && item.text)
          .map((item) => item.text?.trim())
          .filter((text): text is string => Boolean(text))
          .join("\n");
        if (!prompt) continue;
        if (current) interactions.push(current);
        current = { prompt, response: null };
        continue;
      }

      if (!current) continue;

      if (payload.type === "message" && payload.role === "assistant") {
        const response = (payload.content ?? [])
          .filter((item) => item.type === "output_text" && item.text)
          .map((item) => item.text?.trim())
          .filter((text): text is string => Boolean(text))
          .join("\n");
        if (response) {
          current.response = current.response ? `${current.response}\n${response}` : response;
        }
        continue;
      }

      if (payload.type === "custom_tool_call" && payload.name === "apply_patch" && payload.input) {
        const files = extractFilesFromApplyPatch(payload.input);
        if (files.length > 0) {
          current.files_touched = [...new Set([...(current.files_touched ?? []), ...files])];
        }
      }
    }

    if (current) interactions.push(current);
    return interactions;
  },
};
