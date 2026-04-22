import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { getAgent, listAgents } from "../agents/index.js";
import { AGENTNOTE_HOOK_MARKER, HEARTBEAT_FILE, TRAILER_KEY } from "../core/constants.js";
import { readSessionAgent } from "../core/session.js";
import { readNote } from "../core/storage.js";
import { gitSafe } from "../git.js";
import { agentnoteDir, root, sessionFile } from "../paths.js";
import { normalizeEntry } from "./normalize.js";

declare const __VERSION__: string;
const VERSION = __VERSION__;

export async function status(): Promise<void> {
  console.log(`agent-note v${VERSION}`);
  console.log();

  const repoRoot = await root();
  const enabledAgents: string[] = [];
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
  } else if (enabledAgents.includes("cursor")) {
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
    const sid = (await readFile(sessionPath, "utf-8")).trim();
    if (sid) {
      const dir = await agentnoteDir();
      const sessionDir = join(dir, "sessions", sid);
      const hbPath = join(sessionDir, HEARTBEAT_FILE);
      // Check heartbeat freshness (< 1 hour, matching prepare-commit-msg).
      if (existsSync(hbPath)) {
        try {
          const hb = Number.parseInt((await readFile(hbPath, "utf-8")).trim(), 10);
          const ageSeconds = Math.floor(Date.now() / 1000) - Math.floor(hb / 1000);
          if (hb > 0 && ageSeconds <= 3600) {
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
    "-20",
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
  console.log(`linked:  ${linked}/20 recent commits`);
}

async function readAgentCaptureDetails(
  repoRoot: string,
  enabledAgents: string[],
): Promise<string[]> {
  const details: string[] = [];

  if (enabledAgents.includes("codex")) {
    const codexCapabilities = await readCodexCaptureCapabilities(repoRoot);
    if (codexCapabilities.length > 0) {
      details.push(`codex(${codexCapabilities.join(", ")})`);
    }
  }

  if (enabledAgents.includes("cursor")) {
    const cursorCapabilities = await readCursorCaptureCapabilities(repoRoot);
    if (cursorCapabilities.length > 0) {
      details.push(`cursor(${cursorCapabilities.join(", ")})`);
    }
  }

  if (enabledAgents.includes("gemini")) {
    const geminiCapabilities = await readGeminiCaptureCapabilities(repoRoot);
    if (geminiCapabilities.length > 0) {
      details.push(`gemini(${geminiCapabilities.join(", ")})`);
    }
  }

  return details;
}

type CodexHooksConfig = {
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
};

async function readCodexCaptureCapabilities(repoRoot: string): Promise<string[]> {
  const hooksPath = join(repoRoot, ".codex", "hooks.json");
  if (!existsSync(hooksPath)) return [];

  try {
    const content = await readFile(hooksPath, "utf-8");
    const parsed = JSON.parse(content) as CodexHooksConfig;
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName: string): boolean =>
      (hooks[eventName] ?? []).some((group) =>
        (group.hooks ?? []).some((hook) => hook.command?.includes("agent-note hook")),
      );

    const capabilities: string[] = [];
    if (hasAgentnoteHook("UserPromptSubmit")) capabilities.push("prompt");
    if (hasAgentnoteHook("Stop")) capabilities.push("response");
    if (hasAgentnoteHook("SessionStart")) capabilities.push("transcript");
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
    const content = await readFile(hooksPath, "utf-8");
    const parsed = JSON.parse(content) as CursorHooksConfig;
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName: string): boolean =>
      (hooks[eventName] ?? []).some((entry) => entry.command?.includes("agent-note hook"));

    const capabilities: string[] = [];
    if (hasAgentnoteHook("beforeSubmitPrompt")) capabilities.push("prompt");
    if (hasAgentnoteHook("afterAgentResponse") || hasAgentnoteHook("stop")) {
      capabilities.push("response");
    }
    if (hasAgentnoteHook("afterFileEdit") || hasAgentnoteHook("afterTabFileEdit")) {
      capabilities.push("edits");
    }
    if (hasAgentnoteHook("beforeShellExecution") || hasAgentnoteHook("afterShellExecution")) {
      capabilities.push("shell");
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
    const content = await readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(content) as GeminiHooksConfig;
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName: string): boolean =>
      (hooks[eventName] ?? []).some((group) =>
        (group.hooks ?? []).some((h) => h.command?.includes("agent-note hook")),
      );

    const capabilities: string[] = [];
    if (hasAgentnoteHook("BeforeAgent")) capabilities.push("prompt");
    if (hasAgentnoteHook("AfterAgent")) capabilities.push("response");
    if (hasAgentnoteHook("BeforeTool") || hasAgentnoteHook("AfterTool")) {
      capabilities.push("edits", "shell");
    }
    return capabilities;
  } catch {
    return [];
  }
}

async function readManagedGitHooks(repoRoot: string): Promise<string[]> {
  const hookDir = await resolveHookDir(repoRoot);
  const active: string[] = [];

  for (const name of ["prepare-commit-msg", "post-commit", "pre-push"]) {
    const hookPath = join(hookDir, name);
    if (!existsSync(hookPath)) continue;
    try {
      const content = await readFile(hookPath, "utf-8");
      if (content.includes(AGENTNOTE_HOOK_MARKER)) {
        active.push(name);
      }
    } catch {
      // ignore unreadable hook files
    }
  }

  return active;
}

async function resolveHookDir(repoRoot: string): Promise<string> {
  const hooksPathConfig = (await gitSafe(["config", "--get", "core.hooksPath"])).stdout.trim();
  if (hooksPathConfig) {
    return isAbsolute(hooksPathConfig) ? hooksPathConfig : join(repoRoot, hooksPathConfig);
  }

  const gitDir = (await gitSafe(["rev-parse", "--git-dir"])).stdout.trim();
  const resolvedGitDir = isAbsolute(gitDir) ? gitDir : join(repoRoot, gitDir);
  return join(resolvedGitDir, "hooks");
}
