import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, globSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentAdapter, HookInput, NormalizedEvent } from "./types.js";

// Resolution order: local node_modules binary → global PATH → npx fetch from registry.
const HOOK_COMMAND =
  "$(npm bin 2>/dev/null)/agentnote hook 2>/dev/null || agentnote hook 2>/dev/null || npx --yes @wasabeef/agentnote hook";

const HOOKS_CONFIG = {
  SessionStart: [
    { hooks: [{ type: "command", command: HOOK_COMMAND, async: true }] },
  ],
  Stop: [
    { hooks: [{ type: "command", command: HOOK_COMMAND, async: true }] },
  ],
  UserPromptSubmit: [
    { hooks: [{ type: "command", command: HOOK_COMMAND, async: true }] },
  ],
  PreToolUse: [
    {
      matcher: "Bash",
      hooks: [{ type: "command", if: "Bash(git commit *)", command: HOOK_COMMAND }],
    },
  ],
  PostToolUse: [
    {
      matcher: "Edit|Write|NotebookEdit|Bash",
      hooks: [{ type: "command", command: HOOK_COMMAND, async: true }],
    },
  ],
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate that a session ID looks like a UUID. */
function isValidSessionId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

/** Validate that a transcript path is under ~/.claude/. */
function isValidTranscriptPath(p: string): boolean {
  const claudeBase = join(homedir(), ".claude");
  return p.startsWith(claudeBase);
}

interface ClaudeEvent {
  hook_event_name?: string;
  session_id?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; command?: string };
  model?: string;
  transcript_path?: string;
}

function isGitCommit(cmd: string): boolean {
  const trimmed = cmd.trim();
  return (
    (trimmed.startsWith("git commit") || trimmed.startsWith("git -c ")) &&
    trimmed.includes("commit") &&
    !trimmed.includes("--amend")
  );
}

export const claudeCode: AgentAdapter = {
  name: "claude-code",
  settingsRelPath: ".claude/settings.json",

  async installHooks(repoRoot: string): Promise<void> {
    const settingsPath = join(repoRoot, this.settingsRelPath);
    const { dirname } = await import("node:path");
    await mkdir(dirname(settingsPath), { recursive: true });

    let settings: any = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      } catch {
        settings = {};
      }
    }

    const hooks = settings.hooks ?? {};
    const raw = JSON.stringify(hooks);

    if (raw.includes("@wasabeef/agentnote")) return;

    for (const [event, entries] of Object.entries(HOOKS_CONFIG)) {
      hooks[event] = [...(hooks[event] ?? []), ...entries];
    }
    settings.hooks = hooks;
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  },

  async removeHooks(repoRoot: string): Promise<void> {
    const settingsPath = join(repoRoot, this.settingsRelPath);
    if (!existsSync(settingsPath)) return;

    try {
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      if (!settings.hooks) return;

      for (const [event, entries] of Object.entries(settings.hooks)) {
        settings.hooks[event] = (entries as any[]).filter((e) => {
          const text = JSON.stringify(e);
          return !text.includes("@wasabeef/agentnote");
        });
        if (settings.hooks[event].length === 0) delete settings.hooks[event];
      }
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    } catch {
      // corrupted settings.json — leave it alone
    }
  },

  async isEnabled(repoRoot: string): Promise<boolean> {
    const settingsPath = join(repoRoot, this.settingsRelPath);
    if (!existsSync(settingsPath)) return false;
    try {
      const content = await readFile(settingsPath, "utf-8");
      return content.includes("@wasabeef/agentnote");
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
    const tp = e.transcript_path && isValidTranscriptPath(e.transcript_path)
      ? e.transcript_path
      : undefined;

    switch (e.hook_event_name) {
      case "SessionStart":
        return { kind: "session_start", sessionId: sid, timestamp: ts, model: e.model, transcriptPath: tp };
      case "Stop":
        return { kind: "stop", sessionId: sid, timestamp: ts, transcriptPath: tp };
      case "UserPromptSubmit":
        return e.prompt ? { kind: "prompt", sessionId: sid, timestamp: ts, prompt: e.prompt } : null;
      case "PreToolUse": {
        const cmd = e.tool_input?.command ?? "";
        if (e.tool_name === "Bash" && isGitCommit(cmd)) {
          return { kind: "pre_commit", sessionId: sid, timestamp: ts, commitCommand: cmd };
        }
        return null;
      }
      case "PostToolUse": {
        const tool = e.tool_name;
        if ((tool === "Edit" || tool === "Write" || tool === "NotebookEdit") && e.tool_input?.file_path) {
          return { kind: "file_change", sessionId: sid, timestamp: ts, tool, file: e.tool_input.file_path };
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
    const claudeDir = join(homedir(), ".claude", "projects");
    const pattern = join(claudeDir, "**", "sessions", `${sessionId}.jsonl`);
    const matches = globSync(pattern);
    if (matches.length === 0) return null;
    // Extra safety: verify the match is under ~/.claude/.
    const match = matches[0];
    return isValidTranscriptPath(match) ? match : null;
  },

  async extractInteractions(
    transcriptPath: string,
  ): Promise<Array<{ prompt: string; response: string | null }>> {
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
