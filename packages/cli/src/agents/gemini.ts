import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { AgentAdapter, HookInput, NormalizedEvent, TranscriptInteraction } from "./types.js";

const HOOK_COMMAND = "npx --yes @wasabeef/agentnote hook --agent gemini";
const SETTINGS_REL_PATH = ".gemini/settings.json";

const EDIT_TOOLS = new Set(["write_file", "replace"]);
const SHELL_TOOLS = new Set(["shell", "bash", "run_command", "execute_command"]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GeminiEvent {
  hook_event_name?: string;
  session_id?: string;
  timestamp?: string;
  cwd?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    command?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
  };
  tool_response?: unknown;
  prompt?: string;
  prompt_response?: string;
  source?: string;
  reason?: string;
  model?: string;
}

type GeminiHookEntry = {
  name: string;
  type: string;
  command: string;
  timeout?: number;
};

type GeminiHookGroup = {
  matcher: string;
  hooks: GeminiHookEntry[];
};

type GeminiSettingsConfig = Record<string, unknown> & {
  hooks?: Record<string, GeminiHookGroup[]>;
};

const HOOKS_CONFIG: Record<string, GeminiHookGroup[]> = {
  SessionStart: [
    {
      matcher: "*",
      hooks: [
        {
          name: "agentnote-session-start",
          type: "command",
          command: HOOK_COMMAND,
          timeout: 10000,
        },
      ],
    },
  ],
  SessionEnd: [
    {
      matcher: "*",
      hooks: [
        {
          name: "agentnote-session-end",
          type: "command",
          command: HOOK_COMMAND,
          timeout: 10000,
        },
      ],
    },
  ],
  BeforeAgent: [
    {
      matcher: "*",
      hooks: [
        {
          name: "agentnote-before-agent",
          type: "command",
          command: HOOK_COMMAND,
          timeout: 10000,
        },
      ],
    },
  ],
  AfterAgent: [
    {
      matcher: "*",
      hooks: [
        {
          name: "agentnote-after-agent",
          type: "command",
          command: HOOK_COMMAND,
          timeout: 10000,
        },
      ],
    },
  ],
  BeforeTool: [
    {
      matcher: "write_file|replace",
      hooks: [
        {
          name: "agentnote-before-edit",
          type: "command",
          command: HOOK_COMMAND,
          timeout: 10000,
        },
      ],
    },
    {
      matcher: "shell|bash|run_command|execute_command",
      hooks: [
        {
          name: "agentnote-before-shell",
          type: "command",
          command: HOOK_COMMAND,
          timeout: 10000,
        },
      ],
    },
  ],
  AfterTool: [
    {
      matcher: "write_file|replace",
      hooks: [
        {
          name: "agentnote-after-edit",
          type: "command",
          command: HOOK_COMMAND,
          timeout: 10000,
        },
      ],
    },
    {
      matcher: "shell|bash|run_command|execute_command",
      hooks: [
        {
          name: "agentnote-after-shell",
          type: "command",
          command: HOOK_COMMAND,
          timeout: 10000,
        },
      ],
    },
  ],
};

function geminiHome(): string {
  return process.env.GEMINI_HOME ?? join(homedir(), ".gemini");
}

function isValidSessionId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

function isValidTranscriptPath(p: string): boolean {
  const base = resolve(geminiHome());
  const normalized = resolve(p);
  return normalized === base || normalized.startsWith(`${base}${sep}`);
}

function isGitCommit(cmd: string): boolean {
  return cmd.includes("git commit") && !cmd.includes("--amend");
}

function stripAgentnoteGroups(groups: GeminiHookGroup[]): GeminiHookGroup[] {
  return groups
    .map((group) => ({
      ...group,
      hooks: group.hooks.filter((hook) => !hook.command.includes("agentnote hook")),
    }))
    .filter((group) => group.hooks.length > 0);
}

function readTranscriptSessionId(candidate: string): string | null {
  try {
    const preview = readFileSync(candidate, "utf-8").slice(0, 4096);
    const match = preview.match(/"session_id"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

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

      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      scanned += 1;

      if (readTranscriptSessionId(candidate) === sessionId) {
        return candidate;
      }
    }
  }

  return null;
}

export const gemini: AgentAdapter = {
  name: "gemini",
  settingsRelPath: SETTINGS_REL_PATH,

  async managedPaths(): Promise<string[]> {
    return [SETTINGS_REL_PATH];
  },

  async installHooks(repoRoot: string): Promise<void> {
    const settingsPath = join(repoRoot, SETTINGS_REL_PATH);
    await mkdir(dirname(settingsPath), { recursive: true });

    let settings: GeminiSettingsConfig = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(await readFile(settingsPath, "utf-8")) as GeminiSettingsConfig;
      } catch {
        settings = {};
      }
    }

    const hooks = (settings.hooks ?? {}) as Record<string, GeminiHookGroup[]>;

    // Strip existing agentnote hooks to ensure idempotency.
    for (const [event, groups] of Object.entries(hooks)) {
      hooks[event] = stripAgentnoteGroups(groups);
      if (hooks[event].length === 0) delete hooks[event];
    }

    // Merge new hooks config.
    for (const [event, groups] of Object.entries(HOOKS_CONFIG)) {
      hooks[event] = [...(hooks[event] ?? []), ...groups];
    }

    settings.hooks = hooks;
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  },

  async removeHooks(repoRoot: string): Promise<void> {
    const settingsPath = join(repoRoot, SETTINGS_REL_PATH);
    if (!existsSync(settingsPath)) return;

    try {
      const settings = JSON.parse(await readFile(settingsPath, "utf-8")) as GeminiSettingsConfig;
      if (!settings.hooks) return;

      for (const [event, groups] of Object.entries(settings.hooks)) {
        settings.hooks[event] = stripAgentnoteGroups(groups);
        if (settings.hooks[event].length === 0) delete settings.hooks[event];
      }
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    } catch {
      // corrupted settings.json — leave it alone
    }
  },

  async isEnabled(repoRoot: string): Promise<boolean> {
    const settingsPath = join(repoRoot, SETTINGS_REL_PATH);
    if (!existsSync(settingsPath)) return false;
    try {
      const content = await readFile(settingsPath, "utf-8");
      return content.includes(HOOK_COMMAND);
    } catch {
      return false;
    }
  },

  parseEvent(input: HookInput): NormalizedEvent | null {
    let e: GeminiEvent;
    try {
      e = JSON.parse(input.raw) as GeminiEvent;
    } catch {
      return null;
    }

    const sid = e.session_id?.trim();
    const ts = new Date().toISOString();
    if (!sid || !isValidSessionId(sid)) return null;

    const tp =
      e.transcript_path && isValidTranscriptPath(e.transcript_path) ? e.transcript_path : undefined;

    switch (e.hook_event_name) {
      case "SessionStart":
        return {
          kind: "session_start",
          sessionId: sid,
          timestamp: ts,
          model: e.model,
          transcriptPath: tp,
        };

      case "SessionEnd":
        return { kind: "stop", sessionId: sid, timestamp: ts, transcriptPath: tp };

      case "BeforeAgent":
        return e.prompt
          ? { kind: "prompt", sessionId: sid, timestamp: ts, prompt: e.prompt, model: e.model }
          : null;

      case "AfterAgent":
        return e.prompt_response
          ? { kind: "response", sessionId: sid, timestamp: ts, response: e.prompt_response }
          : null;

      case "BeforeTool": {
        const toolName = e.tool_name?.toLowerCase() ?? "";
        const filePath = e.tool_input?.file_path;
        const cmd = e.tool_input?.command ?? "";

        if (EDIT_TOOLS.has(toolName) && filePath) {
          return {
            kind: "pre_edit",
            sessionId: sid,
            timestamp: ts,
            tool: e.tool_name,
            file: filePath,
          };
        }
        if (SHELL_TOOLS.has(toolName) && isGitCommit(cmd)) {
          return { kind: "pre_commit", sessionId: sid, timestamp: ts, commitCommand: cmd };
        }
        return null;
      }

      case "AfterTool": {
        const toolName = e.tool_name?.toLowerCase() ?? "";
        const filePath = e.tool_input?.file_path;
        const cmd = e.tool_input?.command ?? "";

        if (EDIT_TOOLS.has(toolName) && filePath) {
          return {
            kind: "file_change",
            sessionId: sid,
            timestamp: ts,
            tool: e.tool_name,
            file: filePath,
          };
        }
        if (SHELL_TOOLS.has(toolName) && isGitCommit(cmd)) {
          return { kind: "post_commit", sessionId: sid, timestamp: ts, transcriptPath: tp };
        }
        return null;
      }

      default:
        return null;
    }
  },

  findTranscript(sessionId: string): string | null {
    if (!isValidSessionId(sessionId)) return null;
    const tmpDir = join(geminiHome(), "tmp");
    if (!existsSync(tmpDir)) return null;

    return findTranscriptCandidate(tmpDir, sessionId);
  },

  async extractInteractions(_transcriptPath: string): Promise<TranscriptInteraction[]> {
    // Gemini transcript JSON schema is unconfirmed. Return empty as safe fallback.
    // Will be implemented once actual transcript files are available for inspection.
    return [];
  },
};
