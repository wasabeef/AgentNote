import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AgentAdapter, HookInput, NormalizedEvent, TranscriptInteraction } from "./types.js";

const HOOK_COMMAND = "npx --yes agentnote hook";
const CLAUDE_HOOK_COMMAND = `${HOOK_COMMAND} --agent claude`;

const HOOKS_CONFIG = {
  SessionStart: [{ hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] }],
  Stop: [{ hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] }],
  UserPromptSubmit: [{ hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] }],
  PreToolUse: [
    {
      matcher: "Edit|Write|MultiEdit|NotebookEdit",
      hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }],
    },
    {
      matcher: "Bash",
      hooks: [{ type: "command", if: "Bash(*git commit*)", command: CLAUDE_HOOK_COMMAND }],
    },
  ],
  PostToolUse: [
    {
      matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash",
      hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }],
    },
  ],
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve the Claude data directory (defaults to ~/.claude/). */
function claudeHome(): string {
  return process.env.AGENTNOTE_CLAUDE_HOME ?? join(homedir(), ".claude");
}

/** Validate that a session ID looks like a UUID. */
function isValidSessionId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

/** Validate that a transcript path is under the Claude data directory. */
function isValidTranscriptPath(p: string): boolean {
  const base = resolve(claudeHome());
  const normalized = resolve(p);
  return normalized === base || normalized.startsWith(`${base}${sep}`);
}

interface ClaudeEvent {
  hook_event_name?: string;
  session_id?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; command?: string };
  /** Stable identifier for a PreToolUse/PostToolUse pair. Used to correlate pre/post blob snapshots. */
  tool_use_id?: string;
  model?: string;
  transcript_path?: string;
}

/** Known system-injected message prefixes. Match `<tag>` or `<tag ` (with attributes). */
const SYSTEM_PROMPT_PREFIXES = ["<task-notification", "<system-reminder", "<teammate-message"];

function isSystemInjectedPrompt(prompt: string): boolean {
  for (const prefix of SYSTEM_PROMPT_PREFIXES) {
    if (prompt.startsWith(prefix)) {
      const next = prompt[prefix.length];
      // Must be followed by '>' or ' ' (attributes) to be a real tag.
      if (next === ">" || next === " " || next === "\n" || next === undefined) {
        return true;
      }
    }
  }
  return false;
}

function isGitCommit(cmd: string): boolean {
  // Support chained commands like "git add ... && git commit ..."
  return cmd.includes("git commit") && !cmd.includes("--amend");
}

export const claude: AgentAdapter = {
  name: "claude",
  settingsRelPath: ".claude/settings.json",

  async managedPaths(): Promise<string[]> {
    return [this.settingsRelPath];
  },

  async installHooks(repoRoot: string): Promise<void> {
    const settingsPath = join(repoRoot, this.settingsRelPath);
    const { dirname } = await import("node:path");
    await mkdir(dirname(settingsPath), { recursive: true });

    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      } catch {
        settings = {};
      }
    }

    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

    for (const [event, entries] of Object.entries(hooks)) {
      hooks[event] = entries.filter((entry) => {
        const text = JSON.stringify(entry);
        return !text.includes("agentnote hook") && !text.includes("cli.js hook");
      });
      if (hooks[event].length === 0) delete hooks[event];
    }

    for (const [event, entries] of Object.entries(HOOKS_CONFIG)) {
      hooks[event] = [...(hooks[event] ?? []), ...entries];
    }
    settings.hooks = hooks;
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  },

  async removeHooks(repoRoot: string): Promise<void> {
    const settingsPath = join(repoRoot, this.settingsRelPath);
    if (!existsSync(settingsPath)) return;

    try {
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      if (!settings.hooks) return;

      for (const [event, entries] of Object.entries(settings.hooks)) {
        settings.hooks[event] = (entries as unknown[]).filter((e) => {
          const text = JSON.stringify(e);
          return !text.includes("agentnote hook") && !text.includes("cli.js hook");
        });
        if (settings.hooks[event].length === 0) delete settings.hooks[event];
      }
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    } catch {
      // corrupted settings.json — leave it alone
    }
  },

  async isEnabled(repoRoot: string): Promise<boolean> {
    const settingsPath = join(repoRoot, this.settingsRelPath);
    if (!existsSync(settingsPath)) return false;
    try {
      const content = await readFile(settingsPath, "utf-8");
      return (
        content.includes(CLAUDE_HOOK_COMMAND) ||
        content.includes("agentnote hook --agent claude-code") ||
        content.includes("cli.js hook --agent claude-code")
      );
    } catch {
      return false;
    }
  },

  parseEvent(input: HookInput): NormalizedEvent | null {
    let e: ClaudeEvent;
    try {
      e = JSON.parse(input.raw);
    } catch {
      return null;
    }

    const sid = e.session_id;
    const ts = new Date().toISOString();
    if (!sid || !isValidSessionId(sid)) return null;

    // Validate transcript path if present.
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
      case "Stop":
        return { kind: "stop", sessionId: sid, timestamp: ts, transcriptPath: tp };
      case "UserPromptSubmit":
        // Claude Code fires UserPromptSubmit for system-injected messages
        // (task notifications, reminders, teammate messages) that are not
        // real user prompts. Skip them to keep turn attribution correct.
        // Heartbeat is still refreshed by hook.ts's null-event path.
        if (!e.prompt || isSystemInjectedPrompt(e.prompt)) {
          return null;
        }
        return { kind: "prompt", sessionId: sid, timestamp: ts, prompt: e.prompt };
      case "PreToolUse": {
        const tool = e.tool_name;
        const cmd = e.tool_input?.command ?? "";
        if (
          (tool === "Edit" ||
            tool === "Write" ||
            tool === "MultiEdit" ||
            tool === "NotebookEdit") &&
          e.tool_input?.file_path
        ) {
          return {
            kind: "pre_edit",
            sessionId: sid,
            timestamp: ts,
            tool,
            file: e.tool_input.file_path,
            toolUseId: e.tool_use_id,
          };
        }
        if (tool === "Bash" && isGitCommit(cmd)) {
          return { kind: "pre_commit", sessionId: sid, timestamp: ts, commitCommand: cmd };
        }
        return null;
      }
      case "PostToolUse": {
        const tool = e.tool_name;
        if (
          (tool === "Edit" ||
            tool === "Write" ||
            tool === "MultiEdit" ||
            tool === "NotebookEdit") &&
          e.tool_input?.file_path
        ) {
          return {
            kind: "file_change",
            sessionId: sid,
            timestamp: ts,
            tool,
            file: e.tool_input.file_path,
            toolUseId: e.tool_use_id,
          };
        }
        if (tool === "Bash" && isGitCommit(e.tool_input?.command ?? "")) {
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
    const claudeDir = join(claudeHome(), "projects");
    if (!existsSync(claudeDir)) return null;

    // Walk project dirs to find the transcript (compatible with Node 18+).
    try {
      for (const project of readdirSync(claudeDir)) {
        const sessionsDir = join(claudeDir, project, "sessions");
        if (!existsSync(sessionsDir)) continue;
        const candidate = join(sessionsDir, `${sessionId}.jsonl`);
        if (existsSync(candidate) && isValidTranscriptPath(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Permission error or unreadable directory.
    }
    return null;
  },

  async extractInteractions(transcriptPath: string): Promise<TranscriptInteraction[]> {
    if (!isValidTranscriptPath(transcriptPath) || !existsSync(transcriptPath)) return [];

    try {
      const content = await readFile(transcriptPath, "utf-8");
      const lines = content.trim().split("\n");
      const interactions: Array<{ prompt: string; response: string | null }> = [];
      let pendingPrompt: string | null = null;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (entry.type === "user" && entry.message?.content) {
            for (const block of entry.message.content) {
              if (block.type === "text" && block.text) {
                if (pendingPrompt !== null) {
                  interactions.push({ prompt: pendingPrompt, response: null });
                }
                pendingPrompt = block.text;
              }
            }
          }

          if (entry.type === "assistant" && entry.message?.content && pendingPrompt !== null) {
            const texts: string[] = [];
            for (const block of entry.message.content) {
              if (block.type === "text" && block.text) texts.push(block.text);
            }
            if (texts.length > 0) {
              interactions.push({ prompt: pendingPrompt, response: texts.join("\n") });
              pendingPrompt = null;
            }
          }
        } catch {
          // skip malformed lines
        }
      }

      if (pendingPrompt !== null) {
        interactions.push({ prompt: pendingPrompt, response: null });
      }

      return interactions;
    } catch {
      return [];
    }
  },
};
