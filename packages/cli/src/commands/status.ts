import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isAgentNoteHookCommand } from "../agents/hook-command.js";
import { getAgent, listAgents } from "../agents/index.js";
import { AGENT_NAMES, type AgentName } from "../agents/types.js";
import {
  AGENTNOTE_HOOK_MARKER,
  GIT_HOOK_NAMES,
  HEARTBEAT_FILE,
  HEARTBEAT_TTL_SECONDS,
  MILLISECONDS_PER_SECOND,
  RECENT_STATUS_COMMIT_LIMIT,
  SESSIONS_DIR,
  TEXT_ENCODING,
  TRAILER_KEY,
} from "../core/constants.js";
import { readSessionAgent } from "../core/session.js";
import { readNote } from "../core/storage.js";
import { gitSafe } from "../git.js";
import { agentnoteDir, root, sessionFile } from "../paths.js";
import { resolveHookDir } from "./init.js";
import { normalizeEntry } from "./normalize.js";

declare const __VERSION__: string;
const VERSION = __VERSION__;
const CAPABILITY_LABELS = {
  edits: "edits",
  prompt: "prompt",
  response: "response",
  shell: "shell",
  transcript: "transcript",
} as const;
const CODEX_STATUS_HOOK_EVENTS = {
  sessionStart: "SessionStart",
  stop: "Stop",
  userPromptSubmit: "UserPromptSubmit",
} as const;
const CURSOR_STATUS_HOOK_EVENTS = {
  beforeSubmitPrompt: "beforeSubmitPrompt",
  afterAgentResponse: "afterAgentResponse",
  afterFileEdit: "afterFileEdit",
  afterTabFileEdit: "afterTabFileEdit",
  beforeShellExecution: "beforeShellExecution",
  afterShellExecution: "afterShellExecution",
  stop: "stop",
} as const;
const GEMINI_STATUS_HOOK_EVENTS = {
  beforeAgent: "BeforeAgent",
  afterAgent: "AfterAgent",
  beforeTool: "BeforeTool",
  afterTool: "AfterTool",
} as const;

/**
 * Print a compact health summary for Agent Note in the current repository.
 *
 * The command checks configured agents, managed git hooks, active sessions, and
 * recent note linkage without mutating repository state.
 */
export async function status(): Promise<void> {
  console.log(`agent-note v${VERSION}`);
  console.log();

  const repoRoot = await root();
  const enabledAgents: AgentName[] = [];
  for (const agentName of listAgents()) {
    if (await getAgent(agentName).isEnabled(repoRoot)) {
      enabledAgents.push(agentName);
    }
  }

  if (enabledAgents.length > 0) {
    console.log(`agent:   active (${enabledAgents.join(", ")})`);
  } else {
    console.log("agent:   not configured (run 'agent-note init')");
  }

  const captureDetails = await readAgentCaptureDetails(repoRoot, enabledAgents);
  if (captureDetails.length > 0) {
    console.log(`capture: ${captureDetails.join("; ")}`);
  }

  const activeGitHooks = await readManagedGitHooks(repoRoot);
  if (activeGitHooks.length > 0) {
    console.log(`git:     active (${activeGitHooks.join(", ")})`);
    console.log("commit:  tracked via git hooks");
  } else if (enabledAgents.includes(AGENT_NAMES.cursor)) {
    console.log("git:     not configured");
    console.log(
      "commit:  fallback mode (`agent-note commit` recommended; Cursor shell hooks may still attach notes)",
    );
  } else if (enabledAgents.length > 0) {
    console.log("git:     not configured");
    console.log("commit:  fallback mode (use `agent-note commit`)");
  } else {
    console.log("git:     not configured");
    console.log("commit:  not configured");
  }

  const sessionPath = await sessionFile();
  let sessionActive = false;
  if (existsSync(sessionPath)) {
    const sid = (await readFile(sessionPath, TEXT_ENCODING)).trim();
    if (sid) {
      const dir = await agentnoteDir();
      const sessionDir = join(dir, SESSIONS_DIR, sid);
      const hbPath = join(sessionDir, HEARTBEAT_FILE);
      // Check heartbeat freshness (< 1 hour, matching prepare-commit-msg).
      if (existsSync(hbPath)) {
        try {
          const hb = Number.parseInt((await readFile(hbPath, TEXT_ENCODING)).trim(), 10);
          const ageSeconds =
            Math.floor(Date.now() / MILLISECONDS_PER_SECOND) -
            Math.floor(hb / MILLISECONDS_PER_SECOND);
          if (hb > 0 && ageSeconds <= HEARTBEAT_TTL_SECONDS) {
            sessionActive = true;
            console.log(`session: ${sid.slice(0, 8)}…`);
            const agent = await readSessionAgent(sessionDir);
            if (agent) {
              console.log(`agent:   ${agent}`);
            }
          }
        } catch {
          // unreadable heartbeat — treat as inactive
        }
      }
    }
  }
  if (!sessionActive) {
    console.log("session: none");
  }

  const { stdout } = await gitSafe([
    "log",
    `-${RECENT_STATUS_COMMIT_LIMIT}`,
    `--format=%H\t%(trailers:key=${TRAILER_KEY},valueonly)`,
  ]);

  let linked = 0;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const [sha, trailer] = line.split("\t");
    if (trailer?.trim()) {
      linked += 1;
      continue;
    }
    if (!sha) continue;
    const note = await readNote(sha);
    if (note && normalizeEntry(note).session_id) {
      linked += 1;
    }
  }
  console.log(`linked:  ${linked}/${RECENT_STATUS_COMMIT_LIMIT} recent commits`);
}

/**
 * Summarize capture capabilities for each enabled agent adapter.
 *
 * These labels are intentionally derived from configuration files rather than
 * live processes so `agent-note status` remains deterministic and cheap.
 */
async function readAgentCaptureDetails(
  repoRoot: string,
  enabledAgents: AgentName[],
): Promise<string[]> {
  const details: string[] = [];

  if (enabledAgents.includes(AGENT_NAMES.codex)) {
    const codexCapabilities = await readCodexCaptureCapabilities(repoRoot);
    if (codexCapabilities.length > 0) {
      details.push(`${AGENT_NAMES.codex}(${codexCapabilities.join(", ")})`);
    }
  }

  if (enabledAgents.includes(AGENT_NAMES.cursor)) {
    const cursorCapabilities = await readCursorCaptureCapabilities(repoRoot);
    if (cursorCapabilities.length > 0) {
      details.push(`${AGENT_NAMES.cursor}(${cursorCapabilities.join(", ")})`);
    }
  }

  if (enabledAgents.includes(AGENT_NAMES.gemini)) {
    const geminiCapabilities = await readGeminiCaptureCapabilities(repoRoot);
    if (geminiCapabilities.length > 0) {
      details.push(`${AGENT_NAMES.gemini}(${geminiCapabilities.join(", ")})`);
    }
  }

  return details;
}

type CodexHooksConfig = {
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
};

/**
 * Describe Codex capture coverage from `.codex/hooks.json`.
 */
async function readCodexCaptureCapabilities(repoRoot: string): Promise<string[]> {
  const hooksPath = join(repoRoot, ".codex", "hooks.json");
  if (!existsSync(hooksPath)) return [];

  try {
    const content = await readFile(hooksPath, TEXT_ENCODING);
    const parsed = JSON.parse(content) as CodexHooksConfig;
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName: string): boolean =>
      (hooks[eventName] ?? []).some((group) =>
        (group.hooks ?? []).some(
          (hook) =>
            typeof hook.command === "string" &&
            isAgentNoteHookCommand(hook.command, AGENT_NAMES.codex),
        ),
      );

    const capabilities: string[] = [];
    if (hasAgentnoteHook(CODEX_STATUS_HOOK_EVENTS.userPromptSubmit)) {
      capabilities.push(CAPABILITY_LABELS.prompt);
    }
    if (hasAgentnoteHook(CODEX_STATUS_HOOK_EVENTS.stop)) {
      capabilities.push(CAPABILITY_LABELS.response);
    }
    if (hasAgentnoteHook(CODEX_STATUS_HOOK_EVENTS.sessionStart)) {
      capabilities.push(CAPABILITY_LABELS.transcript);
    }
    return capabilities;
  } catch {
    return [];
  }
}

type CursorHooksConfig = {
  hooks?: Record<string, Array<{ command?: string }>>;
};

async function readCursorCaptureCapabilities(repoRoot: string): Promise<string[]> {
  const hooksPath = join(repoRoot, ".cursor", "hooks.json");
  if (!existsSync(hooksPath)) return [];

  try {
    const content = await readFile(hooksPath, TEXT_ENCODING);
    const parsed = JSON.parse(content) as CursorHooksConfig;
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName: string): boolean =>
      (hooks[eventName] ?? []).some(
        (entry) =>
          typeof entry.command === "string" &&
          isAgentNoteHookCommand(entry.command, AGENT_NAMES.cursor),
      );

    const capabilities: string[] = [];
    if (hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.beforeSubmitPrompt)) {
      capabilities.push(CAPABILITY_LABELS.prompt);
    }
    if (
      hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.afterAgentResponse) ||
      hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.stop)
    ) {
      capabilities.push(CAPABILITY_LABELS.response);
    }
    if (
      hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.afterFileEdit) ||
      hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.afterTabFileEdit)
    ) {
      capabilities.push(CAPABILITY_LABELS.edits);
    }
    if (
      hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.beforeShellExecution) ||
      hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.afterShellExecution)
    ) {
      capabilities.push(CAPABILITY_LABELS.shell);
    }
    return capabilities;
  } catch {
    return [];
  }
}

type GeminiHooksConfig = {
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
};

async function readGeminiCaptureCapabilities(repoRoot: string): Promise<string[]> {
  const settingsPath = join(repoRoot, ".gemini", "settings.json");
  if (!existsSync(settingsPath)) return [];

  try {
    const content = await readFile(settingsPath, TEXT_ENCODING);
    const parsed = JSON.parse(content) as GeminiHooksConfig;
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName: string): boolean =>
      (hooks[eventName] ?? []).some((group) =>
        (group.hooks ?? []).some(
          (h) =>
            typeof h.command === "string" && isAgentNoteHookCommand(h.command, AGENT_NAMES.gemini),
        ),
      );

    const capabilities: string[] = [];
    if (hasAgentnoteHook(GEMINI_STATUS_HOOK_EVENTS.beforeAgent)) {
      capabilities.push(CAPABILITY_LABELS.prompt);
    }
    if (hasAgentnoteHook(GEMINI_STATUS_HOOK_EVENTS.afterAgent)) {
      capabilities.push(CAPABILITY_LABELS.response);
    }
    if (
      hasAgentnoteHook(GEMINI_STATUS_HOOK_EVENTS.beforeTool) ||
      hasAgentnoteHook(GEMINI_STATUS_HOOK_EVENTS.afterTool)
    ) {
      capabilities.push(CAPABILITY_LABELS.edits, CAPABILITY_LABELS.shell);
    }
    return capabilities;
  } catch {
    return [];
  }
}

/**
 * Identify git hooks currently managed by Agent Note.
 *
 * Existing user hooks are ignored unless they contain the Agent Note marker, so
 * the status output does not claim ownership of unrelated hook scripts.
 */
async function readManagedGitHooks(repoRoot: string): Promise<string[]> {
  const hookDir = await resolveHookDir(repoRoot);
  const active: string[] = [];

  for (const name of GIT_HOOK_NAMES) {
    const hookPath = join(hookDir, name);
    if (!existsSync(hookPath)) continue;
    try {
      const content = await readFile(hookPath, TEXT_ENCODING);
      if (content.includes(AGENTNOTE_HOOK_MARKER)) {
        active.push(name);
      }
    } catch {
      // ignore unreadable hook files
    }
  }

  return active;
}
