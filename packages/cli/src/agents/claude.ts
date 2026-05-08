import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { AGENTNOTE_HOOK_COMMAND, CLI_JS_HOOK_COMMAND, TEXT_ENCODING } from "../core/constants.js";
import { findGitCommitCommand } from "../git.js";
import {
  AGENT_NAMES,
  type AgentAdapter,
  type HookInput,
  NORMALIZED_EVENT_KINDS,
  type NormalizedEvent,
  type TranscriptInteraction,
} from "./types.js";

const HOOK_COMMAND = "npx --yes agent-note hook";
const CLAUDE_HOOK_COMMAND = `${HOOK_COMMAND} --agent ${AGENT_NAMES.claude}`;
const ENV_AGENTNOTE_CLAUDE_HOME = "AGENTNOTE_CLAUDE_HOME";
const CLAUDE_HOOK_EVENTS = {
  sessionStart: "SessionStart",
  stop: "Stop",
  userPromptSubmit: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
} as const;
const CLAUDE_TOOLS = {
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  multiEdit: "MultiEdit",
  notebookEdit: "NotebookEdit",
} as const;
const CLAUDE_EDIT_TOOLS = new Set<string>([
  CLAUDE_TOOLS.edit,
  CLAUDE_TOOLS.write,
  CLAUDE_TOOLS.multiEdit,
  CLAUDE_TOOLS.notebookEdit,
]);
const CLAUDE_EDIT_TOOL_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";
const CLAUDE_POST_TOOL_MATCHER = `${CLAUDE_EDIT_TOOL_MATCHER}|${CLAUDE_TOOLS.bash}`;
const CLAUDE_GIT_COMMIT_FILTER = "Bash(*git commit*)";

const HOOKS_CONFIG = {
  [CLAUDE_HOOK_EVENTS.sessionStart]: [
    { hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] },
  ],
  [CLAUDE_HOOK_EVENTS.stop]: [
    { hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] },
  ],
  [CLAUDE_HOOK_EVENTS.userPromptSubmit]: [
    { hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] },
  ],
  [CLAUDE_HOOK_EVENTS.preToolUse]: [
    {
      matcher: CLAUDE_EDIT_TOOL_MATCHER,
      hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }],
    },
    {
      matcher: CLAUDE_TOOLS.bash,
      hooks: [{ type: "command", if: CLAUDE_GIT_COMMIT_FILTER, command: CLAUDE_HOOK_COMMAND }],
    },
  ],
  [CLAUDE_HOOK_EVENTS.postToolUse]: [
    {
      matcher: CLAUDE_POST_TOOL_MATCHER,
      hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }],
    },
  ],
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve the Claude data directory (defaults to ~/.claude/). */
function claudeHome(): string {
  return process.env[ENV_AGENTNOTE_CLAUDE_HOME] ?? join(homedir(), ".claude");
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
  return findGitCommitCommand(cmd) !== null;
}

/** Claude Code adapter for hook installation, event parsing, and transcript recovery. */
export const claude: AgentAdapter = {
  name: AGENT_NAMES.claude,
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
        settings = JSON.parse(await readFile(settingsPath, TEXT_ENCODING));
      } catch {
        settings = {};
      }
    }

    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

    for (const [event, entries] of Object.entries(hooks)) {
      hooks[event] = entries.filter((entry) => {
        const text = JSON.stringify(entry);
        return !text.includes(AGENTNOTE_HOOK_COMMAND) && !text.includes(CLI_JS_HOOK_COMMAND);
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
      const settings = JSON.parse(await readFile(settingsPath, TEXT_ENCODING));
      if (!settings.hooks) return;

      for (const [event, entries] of Object.entries(settings.hooks)) {
        settings.hooks[event] = (entries as unknown[]).filter((e) => {
          const text = JSON.stringify(e);
          return !text.includes(AGENTNOTE_HOOK_COMMAND) && !text.includes(CLI_JS_HOOK_COMMAND);
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
      const content = await readFile(settingsPath, TEXT_ENCODING);
      return content.includes(CLAUDE_HOOK_COMMAND);
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
      case CLAUDE_HOOK_EVENTS.sessionStart:
        return {
          kind: NORMALIZED_EVENT_KINDS.sessionStart,
          sessionId: sid,
          timestamp: ts,
          model: e.model,
          transcriptPath: tp,
        };
      case CLAUDE_HOOK_EVENTS.stop:
        return {
          kind: NORMALIZED_EVENT_KINDS.stop,
          sessionId: sid,
          timestamp: ts,
          transcriptPath: tp,
        };
      case CLAUDE_HOOK_EVENTS.userPromptSubmit:
        // Claude Code fires UserPromptSubmit for system-injected messages
        // (task notifications, reminders, teammate messages) that are not
        // real user prompts. Skip them to keep turn attribution correct.
        // Heartbeat is still refreshed by hook.ts's null-event path.
        if (!e.prompt || isSystemInjectedPrompt(e.prompt)) {
          return null;
        }
        return {
          kind: NORMALIZED_EVENT_KINDS.prompt,
          sessionId: sid,
          timestamp: ts,
          prompt: e.prompt,
        };
      case CLAUDE_HOOK_EVENTS.preToolUse: {
        const tool = e.tool_name;
        const cmd = e.tool_input?.command ?? "";
        if (tool && CLAUDE_EDIT_TOOLS.has(tool) && e.tool_input?.file_path) {
          return {
            kind: NORMALIZED_EVENT_KINDS.preEdit,
            sessionId: sid,
            timestamp: ts,
            tool,
            file: e.tool_input.file_path,
            toolUseId: e.tool_use_id,
          };
        }
        if (tool === CLAUDE_TOOLS.bash && isGitCommit(cmd)) {
          return {
            kind: NORMALIZED_EVENT_KINDS.preCommit,
            sessionId: sid,
            timestamp: ts,
            commitCommand: cmd,
          };
        }
        return null;
      }
      case CLAUDE_HOOK_EVENTS.postToolUse: {
        const tool = e.tool_name;
        if (tool && CLAUDE_EDIT_TOOLS.has(tool) && e.tool_input?.file_path) {
          return {
            kind: NORMALIZED_EVENT_KINDS.fileChange,
            sessionId: sid,
            timestamp: ts,
            tool,
            file: e.tool_input.file_path,
            toolUseId: e.tool_use_id,
          };
        }
        if (tool === CLAUDE_TOOLS.bash && isGitCommit(e.tool_input?.command ?? "")) {
          return {
            kind: NORMALIZED_EVENT_KINDS.postCommit,
            sessionId: sid,
            timestamp: ts,
            transcriptPath: tp,
          };
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
      const content = await readFile(transcriptPath, TEXT_ENCODING);
      const lines = content.trim().split("\n");
      const interactions: TranscriptInteraction[] = [];
      let pendingPrompt: string | null = null;
      let pendingPromptTimestamp: string | undefined;
      let pendingResponseTexts: string[] = [];

      const flush = () => {
        if (pendingPrompt === null) return;
        const response = pendingResponseTexts.length > 0 ? pendingResponseTexts.join("\n") : null;
        const interaction: TranscriptInteraction = { prompt: pendingPrompt, response };
        if (pendingPromptTimestamp) interaction.timestamp = pendingPromptTimestamp;
        interactions.push(interaction);
        pendingPrompt = null;
        pendingPromptTimestamp = undefined;
        pendingResponseTexts = [];
      };

      const extractUserText = (content: unknown): string | null => {
        // Claude transcripts store user text as content blocks.
        // Join all text blocks when multiple are present (user messages can contain
        // several text chunks, e.g. pasted content + question).
        if (!Array.isArray(content)) return null;
        const texts: string[] = [];
        for (const block of content) {
          if (block && typeof block === "object" && block.type === "text" && block.text) {
            texts.push(block.text);
          }
        }
        return texts.length > 0 ? texts.join("\n") : null;
      };

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (entry.type === "user" && entry.message?.content) {
            // Skip tool_result-only user messages (no actual text prompt).
            const userText = extractUserText(entry.message.content);
            if (userText) {
              // New user prompt: flush previous pair first.
              flush();
              pendingPrompt = userText;
              pendingPromptTimestamp =
                typeof entry.timestamp === "string" ? entry.timestamp : undefined;
            }
          }

          if (entry.type === "assistant" && entry.message?.content && pendingPrompt !== null) {
            // Accumulate text blocks across multiple assistant messages until next user prompt.
            // Skip thinking and tool_use blocks.
            for (const block of entry.message.content) {
              if (block?.type === "text" && block.text) {
                pendingResponseTexts.push(block.text);
              }
            }
          }
        } catch {
          // skip malformed lines
        }
      }

      flush();

      return interactions;
    } catch {
      return [];
    }
  },
};
