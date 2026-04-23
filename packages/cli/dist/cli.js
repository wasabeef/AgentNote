#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/constants.ts
var TRAILER_KEY, AGENTNOTE_HOOK_MARKER, NOTES_REF, NOTES_REF_FULL, NOTES_FETCH_REFSPEC, AGENTNOTE_DIR, SESSIONS_DIR, PROMPTS_FILE, CHANGES_FILE, EVENTS_FILE, TRANSCRIPT_PATH_FILE, TURN_FILE, PROMPT_ID_FILE, SESSION_FILE, SESSION_AGENT_FILE, PENDING_COMMIT_FILE, MAX_COMMITS, BAR_WIDTH_FULL, TRUNCATE_PROMPT, TRUNCATE_PROMPT_PR, TRUNCATE_RESPONSE_SHOW, TRUNCATE_RESPONSE_PR, ARCHIVE_ID_RE, HEARTBEAT_FILE, PRE_BLOBS_FILE, COMMITTED_PAIRS_FILE, EMPTY_BLOB, SCHEMA_VERSION, DEBUG;
var init_constants = __esm({
  "src/core/constants.ts"() {
    "use strict";
    TRAILER_KEY = "Agentnote-Session";
    AGENTNOTE_HOOK_MARKER = "# agentnote-managed";
    NOTES_REF = "agentnote";
    NOTES_REF_FULL = `refs/notes/${NOTES_REF}`;
    NOTES_FETCH_REFSPEC = `+${NOTES_REF_FULL}:${NOTES_REF_FULL}`;
    AGENTNOTE_DIR = "agentnote";
    SESSIONS_DIR = "sessions";
    PROMPTS_FILE = "prompts.jsonl";
    CHANGES_FILE = "changes.jsonl";
    EVENTS_FILE = "events.jsonl";
    TRANSCRIPT_PATH_FILE = "transcript_path";
    TURN_FILE = "turn";
    PROMPT_ID_FILE = "prompt_id";
    SESSION_FILE = "session";
    SESSION_AGENT_FILE = "agent";
    PENDING_COMMIT_FILE = "pending_commit.json";
    MAX_COMMITS = 500;
    BAR_WIDTH_FULL = 20;
    TRUNCATE_PROMPT = 120;
    TRUNCATE_PROMPT_PR = 500;
    TRUNCATE_RESPONSE_SHOW = 200;
    TRUNCATE_RESPONSE_PR = 500;
    ARCHIVE_ID_RE = /^[0-9a-z]{6,}$/;
    HEARTBEAT_FILE = "heartbeat";
    PRE_BLOBS_FILE = "pre_blobs.jsonl";
    COMMITTED_PAIRS_FILE = "committed_pairs.jsonl";
    EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
    SCHEMA_VERSION = 1;
    DEBUG = !!process.env.AGENTNOTE_DEBUG;
  }
});

// src/agents/claude.ts
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
function claudeHome() {
  return process.env.AGENTNOTE_CLAUDE_HOME ?? join(homedir(), ".claude");
}
function isValidSessionId(id) {
  return UUID_PATTERN.test(id);
}
function isValidTranscriptPath(p) {
  const base = resolve(claudeHome());
  const normalized = resolve(p);
  return normalized === base || normalized.startsWith(`${base}${sep}`);
}
function isSystemInjectedPrompt(prompt) {
  for (const prefix of SYSTEM_PROMPT_PREFIXES) {
    if (prompt.startsWith(prefix)) {
      const next = prompt[prefix.length];
      if (next === ">" || next === " " || next === "\n" || next === void 0) {
        return true;
      }
    }
  }
  return false;
}
function isGitCommit(cmd) {
  return cmd.includes("git commit") && !cmd.includes("--amend");
}
var HOOK_COMMAND, CLAUDE_HOOK_COMMAND, HOOKS_CONFIG, UUID_PATTERN, SYSTEM_PROMPT_PREFIXES, claude;
var init_claude = __esm({
  "src/agents/claude.ts"() {
    "use strict";
    HOOK_COMMAND = "npx --yes agent-note hook";
    CLAUDE_HOOK_COMMAND = `${HOOK_COMMAND} --agent claude`;
    HOOKS_CONFIG = {
      SessionStart: [{ hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] }],
      Stop: [{ hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] }],
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit|NotebookEdit",
          hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }]
        },
        {
          matcher: "Bash",
          hooks: [{ type: "command", if: "Bash(*git commit*)", command: CLAUDE_HOOK_COMMAND }]
        }
      ],
      PostToolUse: [
        {
          matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash",
          hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }]
        }
      ]
    };
    UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    SYSTEM_PROMPT_PREFIXES = ["<task-notification", "<system-reminder", "<teammate-message"];
    claude = {
      name: "claude",
      settingsRelPath: ".claude/settings.json",
      async managedPaths() {
        return [this.settingsRelPath];
      },
      async installHooks(repoRoot3) {
        const settingsPath = join(repoRoot3, this.settingsRelPath);
        const { dirname: dirname2 } = await import("node:path");
        await mkdir(dirname2(settingsPath), { recursive: true });
        let settings = {};
        if (existsSync(settingsPath)) {
          try {
            settings = JSON.parse(await readFile(settingsPath, "utf-8"));
          } catch {
            settings = {};
          }
        }
        const hooks = settings.hooks ?? {};
        for (const [event, entries] of Object.entries(hooks)) {
          hooks[event] = entries.filter((entry) => {
            const text = JSON.stringify(entry);
            return !text.includes("agent-note hook") && !text.includes("cli.js hook");
          });
          if (hooks[event].length === 0) delete hooks[event];
        }
        for (const [event, entries] of Object.entries(HOOKS_CONFIG)) {
          hooks[event] = [...hooks[event] ?? [], ...entries];
        }
        settings.hooks = hooks;
        await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}
`);
      },
      async removeHooks(repoRoot3) {
        const settingsPath = join(repoRoot3, this.settingsRelPath);
        if (!existsSync(settingsPath)) return;
        try {
          const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
          if (!settings.hooks) return;
          for (const [event, entries] of Object.entries(settings.hooks)) {
            settings.hooks[event] = entries.filter((e) => {
              const text = JSON.stringify(e);
              return !text.includes("agent-note hook") && !text.includes("cli.js hook");
            });
            if (settings.hooks[event].length === 0) delete settings.hooks[event];
          }
          if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
          await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}
`);
        } catch {
        }
      },
      async isEnabled(repoRoot3) {
        const settingsPath = join(repoRoot3, this.settingsRelPath);
        if (!existsSync(settingsPath)) return false;
        try {
          const content = await readFile(settingsPath, "utf-8");
          return content.includes(CLAUDE_HOOK_COMMAND);
        } catch {
          return false;
        }
      },
      parseEvent(input) {
        let e;
        try {
          e = JSON.parse(input.raw);
        } catch {
          return null;
        }
        const sid = e.session_id;
        const ts = (/* @__PURE__ */ new Date()).toISOString();
        if (!sid || !isValidSessionId(sid)) return null;
        const tp = e.transcript_path && isValidTranscriptPath(e.transcript_path) ? e.transcript_path : void 0;
        switch (e.hook_event_name) {
          case "SessionStart":
            return {
              kind: "session_start",
              sessionId: sid,
              timestamp: ts,
              model: e.model,
              transcriptPath: tp
            };
          case "Stop":
            return { kind: "stop", sessionId: sid, timestamp: ts, transcriptPath: tp };
          case "UserPromptSubmit":
            if (!e.prompt || isSystemInjectedPrompt(e.prompt)) {
              return null;
            }
            return { kind: "prompt", sessionId: sid, timestamp: ts, prompt: e.prompt };
          case "PreToolUse": {
            const tool = e.tool_name;
            const cmd = e.tool_input?.command ?? "";
            if ((tool === "Edit" || tool === "Write" || tool === "MultiEdit" || tool === "NotebookEdit") && e.tool_input?.file_path) {
              return {
                kind: "pre_edit",
                sessionId: sid,
                timestamp: ts,
                tool,
                file: e.tool_input.file_path,
                toolUseId: e.tool_use_id
              };
            }
            if (tool === "Bash" && isGitCommit(cmd)) {
              return { kind: "pre_commit", sessionId: sid, timestamp: ts, commitCommand: cmd };
            }
            return null;
          }
          case "PostToolUse": {
            const tool = e.tool_name;
            if ((tool === "Edit" || tool === "Write" || tool === "MultiEdit" || tool === "NotebookEdit") && e.tool_input?.file_path) {
              return {
                kind: "file_change",
                sessionId: sid,
                timestamp: ts,
                tool,
                file: e.tool_input.file_path,
                toolUseId: e.tool_use_id
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
      findTranscript(sessionId) {
        if (!isValidSessionId(sessionId)) return null;
        const claudeDir = join(claudeHome(), "projects");
        if (!existsSync(claudeDir)) return null;
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
        }
        return null;
      },
      async extractInteractions(transcriptPath) {
        if (!isValidTranscriptPath(transcriptPath) || !existsSync(transcriptPath)) return [];
        try {
          const content = await readFile(transcriptPath, "utf-8");
          const lines = content.trim().split("\n");
          const interactions = [];
          let pendingPrompt = null;
          let pendingResponseTexts = [];
          const flush = () => {
            if (pendingPrompt === null) return;
            const response = pendingResponseTexts.length > 0 ? pendingResponseTexts.join("\n") : null;
            interactions.push({ prompt: pendingPrompt, response });
            pendingPrompt = null;
            pendingResponseTexts = [];
          };
          const extractUserText = (content2) => {
            if (!Array.isArray(content2)) return null;
            const texts = [];
            for (const block of content2) {
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
                const userText = extractUserText(entry.message.content);
                if (userText) {
                  flush();
                  pendingPrompt = userText;
                }
              }
              if (entry.type === "assistant" && entry.message?.content && pendingPrompt !== null) {
                for (const block of entry.message.content) {
                  if (block?.type === "text" && block.text) {
                    pendingResponseTexts.push(block.text);
                  }
                }
              }
            } catch {
            }
          }
          flush();
          return interactions;
        } catch {
          return [];
        }
      }
    };
  }
});

// src/agents/codex.ts
import { existsSync as existsSync2, readdirSync as readdirSync2, readFileSync } from "node:fs";
import { mkdir as mkdir2, readFile as readFile2, writeFile as writeFile2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { isAbsolute, join as join2, relative, resolve as resolve2, sep as sep2 } from "node:path";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function appendUnique(values, seen, next) {
  const trimmed = next.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  values.push(trimmed);
}
function collectMessageText(value, seen = /* @__PURE__ */ new Set()) {
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
    ...collectMessageText(value.value, seen)
  ];
}
function parseJsonString(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function collectPatchStrings(value, seen = /* @__PURE__ */ new Set()) {
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
    ...collectPatchStrings(value.text, seen)
  ];
}
function readTranscriptSessionId(candidate) {
  try {
    const preview = readFileSync(candidate, "utf-8").slice(0, 4096);
    for (const rawLine of preview.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        const sessionId = entry.type === "session_meta" ? entry.payload?.id : void 0;
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
function findTranscriptCandidate(rootDir, sessionId) {
  const queue = [rootDir];
  let scanned = 0;
  while (queue.length > 0 && scanned < 256) {
    const current = queue.shift();
    if (!current) break;
    let entries;
    try {
      entries = readdirSync2(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const candidate = join2(current, entry.name);
      if (!isValidTranscriptPath2(candidate)) continue;
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
function codexHome() {
  return process.env.CODEX_HOME ?? join2(homedir2(), ".codex");
}
function isValidTranscriptPath2(transcriptPath) {
  const base = resolve2(codexHome());
  const normalized = resolve2(transcriptPath);
  return normalized === base || normalized.startsWith(`${base}${sep2}`);
}
function normalizeTranscriptPath(value) {
  if (!value) return void 0;
  return isValidTranscriptPath2(value) ? value : void 0;
}
function normalizeConfigToml(content) {
  if (content.match(/^\s*features\.codex_hooks\s*=\s*(true|false)\s*$/m)) {
    return content.replace(
      /^\s*features\.codex_hooks\s*=\s*(true|false)\s*$/m,
      "features.codex_hooks = true"
    );
  }
  if (content.match(/^\s*\[features\]\s*$/m)) {
    if (content.match(/^\s*codex_hooks\s*=\s*(true|false)\s*$/m)) {
      return content.replace(/^\s*codex_hooks\s*=\s*(true|false)\s*$/m, "codex_hooks = true");
    }
    return content.replace(/^\s*\[features\]\s*$/m, "[features]\ncodex_hooks = true");
  }
  const trimmed = content.trimEnd();
  return trimmed.length > 0 ? `${trimmed}

[features]
codex_hooks = true
` : "[features]\ncodex_hooks = true\n";
}
function buildHooksConfig() {
  const hookEntry = { type: "command", command: HOOK_COMMAND2 };
  const groups = [{ hooks: [hookEntry] }];
  return {
    hooks: {
      SessionStart: groups,
      UserPromptSubmit: groups,
      Stop: groups
    }
  };
}
function stripAgentnoteHooks(config) {
  if (!config.hooks) return { hooks: {} };
  const hooks = Object.fromEntries(
    Object.entries(config.hooks).map(([event, groups]) => {
      const filteredGroups = groups.map((group) => ({
        ...group,
        hooks: group.hooks.filter((hook2) => !hook2.command.includes("agent-note hook"))
      })).filter((group) => group.hooks.length > 0);
      return [event, filteredGroups];
    }).filter(([, groups]) => groups.length > 0)
  );
  return { hooks };
}
function mergeHooksConfig(existing) {
  const clean = stripAgentnoteHooks(existing);
  const next = buildHooksConfig();
  return {
    hooks: {
      ...clean.hooks ?? {},
      ...next.hooks ?? {}
    }
  };
}
function extractFilesFromApplyPatch(input) {
  const regex = /^\*\*\* (?:Add|Update|Delete) File: ([^\n]+)$/gm;
  const files = [];
  const seen = /* @__PURE__ */ new Set();
  for (const match of input.matchAll(regex)) {
    const file = match[1]?.trim();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    files.push(file);
  }
  return files;
}
function extractLineStatsFromApplyPatch(input) {
  const stats = {};
  let currentFile = null;
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
function normalizeInteractionFilePath(filePath, sessionCwd) {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.includes("\r")) return null;
  if (!isAbsolute(trimmed)) {
    return trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  }
  const normalized = resolve2(trimmed);
  if (!sessionCwd) return normalized;
  const base = resolve2(sessionCwd);
  if (normalized === base) return ".";
  if (normalized.startsWith(`${base}${sep2}`)) {
    return relative(base, normalized).split(sep2).join("/");
  }
  return normalized;
}
function appendInteractionTool(interaction, toolName) {
  if (!toolName) return;
  const tools = interaction.tools ?? [];
  if (tools.includes(toolName)) return;
  interaction.tools = [...tools, toolName];
}
var CONFIG_REL_PATH, HOOKS_REL_PATH, HOOK_COMMAND2, codex;
var init_codex = __esm({
  "src/agents/codex.ts"() {
    "use strict";
    CONFIG_REL_PATH = ".codex/config.toml";
    HOOKS_REL_PATH = ".codex/hooks.json";
    HOOK_COMMAND2 = "npx --yes agent-note hook --agent codex";
    codex = {
      name: "codex",
      settingsRelPath: CONFIG_REL_PATH,
      async managedPaths() {
        return [CONFIG_REL_PATH, HOOKS_REL_PATH];
      },
      async installHooks(repoRoot3) {
        const codexDir = join2(repoRoot3, ".codex");
        const configPath = join2(repoRoot3, CONFIG_REL_PATH);
        const hooksPath = join2(repoRoot3, HOOKS_REL_PATH);
        await mkdir2(codexDir, { recursive: true });
        const configContent = existsSync2(configPath) ? await readFile2(configPath, "utf-8") : "";
        await writeFile2(configPath, normalizeConfigToml(configContent));
        let hooksConfig = {};
        if (existsSync2(hooksPath)) {
          try {
            hooksConfig = JSON.parse(await readFile2(hooksPath, "utf-8"));
          } catch {
            hooksConfig = {};
          }
        }
        await writeFile2(hooksPath, `${JSON.stringify(mergeHooksConfig(hooksConfig), null, 2)}
`);
      },
      async removeHooks(repoRoot3) {
        const hooksPath = join2(repoRoot3, HOOKS_REL_PATH);
        if (!existsSync2(hooksPath)) return;
        try {
          const parsed = JSON.parse(await readFile2(hooksPath, "utf-8"));
          await writeFile2(hooksPath, `${JSON.stringify(stripAgentnoteHooks(parsed), null, 2)}
`);
        } catch {
        }
      },
      async isEnabled(repoRoot3) {
        const configPath = join2(repoRoot3, CONFIG_REL_PATH);
        const hooksPath = join2(repoRoot3, HOOKS_REL_PATH);
        if (!existsSync2(configPath) || !existsSync2(hooksPath)) return false;
        try {
          const [configContent, hooksContent] = await Promise.all([
            readFile2(configPath, "utf-8"),
            readFile2(hooksPath, "utf-8")
          ]);
          const configOk = configContent.includes("features.codex_hooks = true") || configContent.includes("[features]") && configContent.match(/^\s*codex_hooks\s*=\s*true\s*$/m) !== null;
          const hasHook = hooksContent.includes(HOOK_COMMAND2);
          return configOk && hasHook;
        } catch {
          return false;
        }
      },
      parseEvent(input) {
        let payload;
        try {
          payload = JSON.parse(input.raw);
        } catch {
          return null;
        }
        const sessionId = payload.session_id?.trim();
        if (!sessionId) return null;
        const timestamp = (/* @__PURE__ */ new Date()).toISOString();
        const transcriptPath = normalizeTranscriptPath(payload.transcript_path);
        switch (payload.hook_event_name) {
          case "SessionStart":
            return {
              kind: "session_start",
              sessionId,
              timestamp,
              model: payload.model,
              transcriptPath
            };
          case "UserPromptSubmit":
            return payload.prompt ? {
              kind: "prompt",
              sessionId,
              timestamp,
              prompt: payload.prompt,
              transcriptPath,
              model: payload.model
            } : null;
          case "Stop":
            return {
              kind: "stop",
              sessionId,
              timestamp,
              response: payload.last_assistant_message ?? void 0,
              transcriptPath,
              model: payload.model
            };
          default:
            return null;
        }
      },
      findTranscript(sessionId) {
        const sessionsDir = join2(codexHome(), "sessions");
        if (!existsSync2(sessionsDir)) return null;
        return findTranscriptCandidate(sessionsDir, sessionId);
      },
      async extractInteractions(transcriptPath) {
        if (!isValidTranscriptPath2(transcriptPath)) {
          throw new Error(`Invalid Codex transcript path: ${transcriptPath}`);
        }
        if (!existsSync2(transcriptPath)) {
          throw new Error(`Codex transcript not found: ${transcriptPath}`);
        }
        let content;
        try {
          content = await readFile2(transcriptPath, "utf-8");
        } catch {
          throw new Error(`Failed to read Codex transcript: ${transcriptPath}`);
        }
        const interactions = [];
        let current = null;
        let sessionCwd;
        for (const rawLine of content.split("\n")) {
          const line = rawLine.trim();
          if (!line) continue;
          let entry;
          try {
            entry = JSON.parse(line);
          } catch {
            continue;
          }
          if (entry.type === "session_meta" && typeof entry.payload?.cwd === "string") {
            sessionCwd = entry.payload.cwd;
            continue;
          }
          if (entry.type !== "response_item" || !entry.payload) continue;
          const payload = entry.payload;
          const payloadType = typeof payload.type === "string" ? payload.type : void 0;
          const payloadRole = typeof payload.role === "string" ? payload.role : void 0;
          if (payloadType === "message" && payloadRole === "user") {
            const prompt = collectMessageText(payload.content).join("\n");
            if (!prompt) continue;
            if (current) interactions.push(current);
            current = { prompt, response: null };
            continue;
          }
          if (!current) continue;
          if (payloadType === "message" && payloadRole === "assistant") {
            const response = collectMessageText(payload.content).join("\n");
            if (response) {
              current.response = current.response ? `${current.response}
${response}` : response;
            }
            continue;
          }
          const toolName = typeof payload.name === "string" ? payload.name : typeof payload.call_name === "string" ? payload.call_name : void 0;
          if ((payloadType === "custom_tool_call" || payloadType === "function_call" || payloadType === "tool_use") && toolName) {
            appendInteractionTool(current, toolName);
          }
          if ((payloadType === "custom_tool_call" || payloadType === "function_call") && toolName === "apply_patch") {
            const patchInputs = [
              ...collectPatchStrings(payload.input),
              ...collectPatchStrings(payload.arguments)
            ];
            const files = [];
            const fileSeen = /* @__PURE__ */ new Set();
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
                  deleted: previous.deleted + stats.deleted
                };
              }
            }
            if (files.length > 0) {
              current.files_touched = [.../* @__PURE__ */ new Set([...current.files_touched ?? [], ...files])];
            }
            if (Object.keys(current.line_stats).length === 0) {
              delete current.line_stats;
            }
          }
        }
        if (current) interactions.push(current);
        return interactions;
      }
    };
  }
});

// src/agents/cursor.ts
import { execFileSync } from "node:child_process";
import { existsSync as existsSync3, statSync } from "node:fs";
import { mkdir as mkdir3, readFile as readFile3, writeFile as writeFile3 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { join as join3, resolve as resolve3, sep as sep3 } from "node:path";
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function appendUnique2(values, seen, next) {
  const trimmed = next.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  values.push(trimmed);
}
function collectMessageText2(value, seen = /* @__PURE__ */ new Set()) {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (!value || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMessageText2(item, seen));
  }
  if (!isRecord2(value)) return [];
  const texts = [];
  const seenStrings = /* @__PURE__ */ new Set();
  for (const candidate of [
    value.text,
    value.content,
    value.parts,
    value.message,
    value.payload,
    value.input,
    value.output,
    value.value
  ]) {
    for (const text of collectMessageText2(candidate, seen)) {
      appendUnique2(texts, seenStrings, text);
    }
  }
  return texts;
}
function extractRole(value) {
  if (!isRecord2(value)) return null;
  const directRole = value.role;
  if (typeof directRole === "string" && directRole.trim()) {
    return directRole.trim().toLowerCase();
  }
  return extractRole(value.message) ?? extractRole(value.payload);
}
function sanitizePathForCursor(path) {
  return path.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]/g, "-");
}
function countTextLines(value) {
  if (!value) return 0;
  const normalized = value.replace(/\r\n/g, "\n");
  if (normalized === "\n") return 1;
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed ? trimmed.split("\n").length : 0;
}
function extractEditStats(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  let added = 0;
  let deleted = 0;
  let sawEdit = false;
  for (const item of value) {
    if (!isRecord2(item)) continue;
    const oldString = typeof item.old_string === "string" ? item.old_string : typeof item.oldString === "string" ? item.oldString : "";
    const newString = typeof item.new_string === "string" ? item.new_string : typeof item.newString === "string" ? item.newString : "";
    if (!oldString && !newString) continue;
    sawEdit = true;
    deleted += countTextLines(oldString);
    added += countTextLines(newString);
  }
  return sawEdit ? { added, deleted } : null;
}
function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf-8"
    }).trim();
  } catch {
    return resolve3(process.cwd());
  }
}
function cursorTranscriptDir() {
  const override = process.env[CURSOR_TRANSCRIPTS_DIR_ENV]?.trim();
  if (override) return resolve3(override);
  return join3(CURSOR_PROJECTS_DIR, sanitizePathForCursor(repoRoot()), "agent-transcripts");
}
function isValidTranscriptPath3(transcriptPath) {
  const normalized = resolve3(transcriptPath);
  const roots = [resolve3(CURSOR_PROJECTS_DIR)];
  const override = process.env[CURSOR_TRANSCRIPTS_DIR_ENV]?.trim();
  if (override) {
    roots.unshift(resolve3(override));
  }
  return roots.some((root2) => normalized === root2 || normalized.startsWith(`${root2}${sep3}`));
}
function resolveTranscriptPath(sessionDir, sessionId) {
  const nestedDir = join3(sessionDir, sessionId);
  const nestedPath = join3(nestedDir, `${sessionId}.jsonl`);
  try {
    if (existsSync3(nestedPath)) return nestedPath;
    if (existsSync3(nestedDir) && statSync(nestedDir).isDirectory()) return nestedPath;
  } catch {
  }
  const flatPath = join3(sessionDir, `${sessionId}.jsonl`);
  return existsSync3(flatPath) ? flatPath : null;
}
function extractPlainTextInteractions(content) {
  const lines = content.split("\n");
  const interactions = [];
  let currentPrompt = null;
  let currentResponse = [];
  let activeRole = null;
  const flush = () => {
    if (!currentPrompt?.trim()) return;
    interactions.push({
      prompt: currentPrompt.trim(),
      response: currentResponse.length > 0 ? currentResponse.join("\n").trim() : null
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
      currentPrompt = `${currentPrompt}
${line}`.trim();
    } else if (activeRole === "assistant" && currentPrompt) {
      currentResponse.push(line);
    }
  }
  flush();
  return interactions;
}
async function waitForTranscriptReady(transcriptPath) {
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
  while (Date.now() <= deadline) {
    try {
      if (existsSync3(transcriptPath) && statSync(transcriptPath).size > 0) {
        return true;
      }
    } catch {
    }
    await new Promise((resolve6) => setTimeout(resolve6, TRANSCRIPT_POLL_MS));
  }
  return false;
}
function extractJsonlInteractions(content) {
  const interactions = [];
  let pendingPrompt = null;
  let pendingResponse = [];
  const flush = () => {
    if (!pendingPrompt?.trim()) return;
    interactions.push({
      prompt: pendingPrompt.trim(),
      response: pendingResponse.length > 0 ? pendingResponse.join("\n").trim() : null
    });
  };
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const role = extractRole(parsed);
    if (!role) continue;
    const text = collectMessageText2(parsed).join("\n").trim();
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
function sessionIdFromPayload(payload) {
  const value = payload.conversation_id ?? payload.conversationId ?? payload.session_id ?? payload.sessionId ?? null;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
function buildHooksConfig2() {
  return {
    version: 1,
    hooks: {
      beforeSubmitPrompt: [{ command: HOOK_COMMAND3 }],
      beforeShellExecution: [{ command: HOOK_COMMAND3 }],
      afterAgentResponse: [{ command: HOOK_COMMAND3 }],
      afterFileEdit: [{ command: HOOK_COMMAND3 }],
      afterTabFileEdit: [{ command: HOOK_COMMAND3 }],
      afterShellExecution: [{ command: HOOK_COMMAND3 }],
      stop: [{ command: HOOK_COMMAND3 }]
    }
  };
}
function isGitCommit2(command2) {
  return command2.includes("git commit") && !command2.includes("--amend");
}
function stripAgentnoteHooks2(config) {
  if (!config.hooks) {
    return { version: config.version ?? 1, hooks: {} };
  }
  const hooks = Object.fromEntries(
    Object.entries(config.hooks).map(([event, entries]) => [
      event,
      entries.filter((entry) => !entry.command.includes("agent-note hook"))
    ]).filter(([, entries]) => entries.length > 0)
  );
  return { version: config.version ?? 1, hooks };
}
function mergeHooksConfig2(existing) {
  const clean = stripAgentnoteHooks2(existing);
  const next = buildHooksConfig2();
  const mergedHooks = { ...clean.hooks ?? {} };
  for (const [event, entries] of Object.entries(next.hooks ?? {})) {
    mergedHooks[event] = [...mergedHooks[event] ?? [], ...entries];
  }
  return {
    version: 1,
    hooks: mergedHooks
  };
}
var HOOKS_REL_PATH2, HOOK_COMMAND3, CURSOR_PROJECTS_DIR, CURSOR_TRANSCRIPTS_DIR_ENV, TRANSCRIPT_WAIT_MS, TRANSCRIPT_POLL_MS, cursor;
var init_cursor = __esm({
  "src/agents/cursor.ts"() {
    "use strict";
    HOOKS_REL_PATH2 = ".cursor/hooks.json";
    HOOK_COMMAND3 = "npx --yes agent-note hook --agent cursor";
    CURSOR_PROJECTS_DIR = join3(homedir3(), ".cursor", "projects");
    CURSOR_TRANSCRIPTS_DIR_ENV = "AGENTNOTE_CURSOR_TRANSCRIPTS_DIR";
    TRANSCRIPT_WAIT_MS = 1500;
    TRANSCRIPT_POLL_MS = 50;
    cursor = {
      name: "cursor",
      settingsRelPath: HOOKS_REL_PATH2,
      async managedPaths() {
        return [HOOKS_REL_PATH2];
      },
      async installHooks(repoRoot3) {
        const cursorDir = join3(repoRoot3, ".cursor");
        const hooksPath = join3(repoRoot3, HOOKS_REL_PATH2);
        await mkdir3(cursorDir, { recursive: true });
        let hooksConfig = {};
        if (existsSync3(hooksPath)) {
          try {
            hooksConfig = JSON.parse(await readFile3(hooksPath, "utf-8"));
          } catch {
            hooksConfig = {};
          }
        }
        await writeFile3(hooksPath, `${JSON.stringify(mergeHooksConfig2(hooksConfig), null, 2)}
`);
      },
      async removeHooks(repoRoot3) {
        const hooksPath = join3(repoRoot3, HOOKS_REL_PATH2);
        if (!existsSync3(hooksPath)) return;
        try {
          const parsed = JSON.parse(await readFile3(hooksPath, "utf-8"));
          await writeFile3(hooksPath, `${JSON.stringify(stripAgentnoteHooks2(parsed), null, 2)}
`);
        } catch {
        }
      },
      async isEnabled(repoRoot3) {
        const hooksPath = join3(repoRoot3, HOOKS_REL_PATH2);
        if (!existsSync3(hooksPath)) return false;
        try {
          const content = await readFile3(hooksPath, "utf-8");
          return content.includes(HOOK_COMMAND3);
        } catch {
          return false;
        }
      },
      parseEvent(input) {
        let payload;
        try {
          payload = JSON.parse(input.raw);
        } catch {
          return null;
        }
        const sessionId = sessionIdFromPayload(payload);
        if (!sessionId) return null;
        const timestamp = (/* @__PURE__ */ new Date()).toISOString();
        switch (payload.hook_event_name) {
          case "beforeSubmitPrompt":
            return payload.prompt ? {
              kind: "prompt",
              sessionId,
              timestamp,
              prompt: payload.prompt,
              model: payload.model
            } : null;
          case "afterAgentResponse": {
            const response = collectMessageText2(
              payload.response ?? payload.text ?? payload.content ?? payload.message ?? payload.output
            ).join("\n").trim();
            return response ? {
              kind: "response",
              sessionId,
              timestamp,
              response
            } : null;
          }
          case "beforeShellExecution":
            return payload.command && isGitCommit2(payload.command) ? {
              kind: "pre_commit",
              sessionId,
              timestamp,
              commitCommand: payload.command
            } : null;
          case "afterFileEdit":
          case "afterTabFileEdit": {
            const filePath = payload.file_path ?? payload.filePath;
            const editStats = extractEditStats(payload.edits);
            return filePath ? {
              kind: "file_change",
              sessionId,
              timestamp,
              file: filePath,
              tool: payload.hook_event_name,
              ...editStats ? { editStats } : {}
            } : null;
          }
          case "afterShellExecution":
            return payload.command && isGitCommit2(payload.command) ? {
              kind: "post_commit",
              sessionId,
              timestamp
            } : null;
          case "stop": {
            const response = collectMessageText2(
              payload.response ?? payload.text ?? payload.content ?? payload.message ?? payload.output
            ).join("\n").trim();
            return {
              kind: "stop",
              sessionId,
              timestamp,
              response: response || void 0
            };
          }
          default:
            return null;
        }
      },
      findTranscript(sessionId) {
        return resolveTranscriptPath(cursorTranscriptDir(), sessionId);
      },
      async extractInteractions(transcriptPath) {
        if (!isValidTranscriptPath3(transcriptPath)) return [];
        const ready = await waitForTranscriptReady(transcriptPath);
        if (!ready) return [];
        let content = "";
        try {
          content = await readFile3(transcriptPath, "utf-8");
        } catch {
          return [];
        }
        if (!content.trim()) return [];
        const trimmed = content.trimStart();
        return trimmed.startsWith("{") ? extractJsonlInteractions(content) : extractPlainTextInteractions(content);
      }
    };
  }
});

// src/agents/gemini.ts
import { existsSync as existsSync4, readdirSync as readdirSync3, readFileSync as readFileSync2 } from "node:fs";
import { mkdir as mkdir4, readFile as readFile4, writeFile as writeFile4 } from "node:fs/promises";
import { homedir as homedir4 } from "node:os";
import { dirname, join as join4, resolve as resolve4, sep as sep4 } from "node:path";
function geminiHome() {
  return process.env.GEMINI_HOME ?? join4(homedir4(), ".gemini");
}
function isValidSessionId2(id) {
  return UUID_PATTERN2.test(id);
}
function isValidTranscriptPath4(p) {
  const base = resolve4(geminiHome());
  const normalized = resolve4(p);
  return normalized === base || normalized.startsWith(`${base}${sep4}`);
}
function isGitCommit3(cmd) {
  return cmd.includes("git commit") && !cmd.includes("--amend");
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function extractPartText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const texts = [];
  for (const part of content) {
    if (isRecord3(part) && typeof part.text === "string" && part.text.trim()) {
      texts.push(part.text.trim());
    }
  }
  return texts.join("\n");
}
function stripAgentnoteGroups(groups) {
  return groups.map((group) => ({
    ...group,
    hooks: group.hooks.filter((hook2) => !hook2.command.includes("agent-note hook"))
  })).filter((group) => group.hooks.length > 0);
}
function readTranscriptSessionId2(candidate) {
  try {
    const preview = readFileSync2(candidate, "utf-8").slice(0, 4096);
    const match = preview.match(/"sessionId"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
function findTranscriptCandidate2(rootDir, sessionId) {
  const queue = [rootDir];
  let scanned = 0;
  while (queue.length > 0 && scanned < 256) {
    const current = queue.shift();
    if (!current) break;
    let entries;
    try {
      entries = readdirSync3(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const candidate = join4(current, entry.name);
      if (!isValidTranscriptPath4(candidate)) continue;
      if (entry.isDirectory()) {
        queue.push(candidate);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      scanned += 1;
      if (readTranscriptSessionId2(candidate) === sessionId) {
        return candidate;
      }
    }
  }
  return null;
}
var HOOK_COMMAND4, SETTINGS_REL_PATH, EDIT_TOOLS, SHELL_TOOLS, UUID_PATTERN2, HOOKS_CONFIG2, gemini;
var init_gemini = __esm({
  "src/agents/gemini.ts"() {
    "use strict";
    HOOK_COMMAND4 = "npx --yes agent-note hook --agent gemini";
    SETTINGS_REL_PATH = ".gemini/settings.json";
    EDIT_TOOLS = /* @__PURE__ */ new Set(["write_file", "replace"]);
    SHELL_TOOLS = /* @__PURE__ */ new Set([
      "run_shell_command",
      "shell",
      "bash",
      "run_command",
      "execute_command"
    ]);
    UUID_PATTERN2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    HOOKS_CONFIG2 = {
      SessionStart: [
        {
          matcher: "*",
          hooks: [
            {
              name: "agentnote-session-start",
              type: "command",
              command: HOOK_COMMAND4,
              timeout: 1e4
            }
          ]
        }
      ],
      SessionEnd: [
        {
          matcher: "*",
          hooks: [
            {
              name: "agentnote-session-end",
              type: "command",
              command: HOOK_COMMAND4,
              timeout: 1e4
            }
          ]
        }
      ],
      BeforeAgent: [
        {
          matcher: "*",
          hooks: [
            {
              name: "agentnote-before-agent",
              type: "command",
              command: HOOK_COMMAND4,
              timeout: 1e4
            }
          ]
        }
      ],
      AfterAgent: [
        {
          matcher: "*",
          hooks: [
            {
              name: "agentnote-after-agent",
              type: "command",
              command: HOOK_COMMAND4,
              timeout: 1e4
            }
          ]
        }
      ],
      BeforeTool: [
        {
          matcher: "write_file|replace",
          hooks: [
            {
              name: "agentnote-before-edit",
              type: "command",
              command: HOOK_COMMAND4,
              timeout: 1e4
            }
          ]
        },
        {
          matcher: "run_shell_command|shell|bash|run_command|execute_command",
          hooks: [
            {
              name: "agentnote-before-shell",
              type: "command",
              command: HOOK_COMMAND4,
              timeout: 1e4
            }
          ]
        }
      ],
      AfterTool: [
        {
          matcher: "write_file|replace",
          hooks: [
            {
              name: "agentnote-after-edit",
              type: "command",
              command: HOOK_COMMAND4,
              timeout: 1e4
            }
          ]
        },
        {
          matcher: "run_shell_command|shell|bash|run_command|execute_command",
          hooks: [
            {
              name: "agentnote-after-shell",
              type: "command",
              command: HOOK_COMMAND4,
              timeout: 1e4
            }
          ]
        }
      ]
    };
    gemini = {
      name: "gemini",
      settingsRelPath: SETTINGS_REL_PATH,
      async managedPaths() {
        return [SETTINGS_REL_PATH];
      },
      async installHooks(repoRoot3) {
        const settingsPath = join4(repoRoot3, SETTINGS_REL_PATH);
        await mkdir4(dirname(settingsPath), { recursive: true });
        let settings = {};
        if (existsSync4(settingsPath)) {
          try {
            settings = JSON.parse(await readFile4(settingsPath, "utf-8"));
          } catch {
            settings = {};
          }
        }
        const hooks = settings.hooks ?? {};
        for (const [event, groups] of Object.entries(hooks)) {
          hooks[event] = stripAgentnoteGroups(groups);
          if (hooks[event].length === 0) delete hooks[event];
        }
        for (const [event, groups] of Object.entries(HOOKS_CONFIG2)) {
          hooks[event] = [...hooks[event] ?? [], ...groups];
        }
        settings.hooks = hooks;
        await writeFile4(settingsPath, `${JSON.stringify(settings, null, 2)}
`);
      },
      async removeHooks(repoRoot3) {
        const settingsPath = join4(repoRoot3, SETTINGS_REL_PATH);
        if (!existsSync4(settingsPath)) return;
        try {
          const settings = JSON.parse(await readFile4(settingsPath, "utf-8"));
          if (!settings.hooks) return;
          for (const [event, groups] of Object.entries(settings.hooks)) {
            settings.hooks[event] = stripAgentnoteGroups(groups);
            if (settings.hooks[event].length === 0) delete settings.hooks[event];
          }
          if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
          await writeFile4(settingsPath, `${JSON.stringify(settings, null, 2)}
`);
        } catch {
        }
      },
      async isEnabled(repoRoot3) {
        const settingsPath = join4(repoRoot3, SETTINGS_REL_PATH);
        if (!existsSync4(settingsPath)) return false;
        try {
          const content = await readFile4(settingsPath, "utf-8");
          return content.includes(HOOK_COMMAND4);
        } catch {
          return false;
        }
      },
      parseEvent(input) {
        let e;
        try {
          e = JSON.parse(input.raw);
        } catch {
          return null;
        }
        const sid = e.session_id?.trim();
        const ts = (/* @__PURE__ */ new Date()).toISOString();
        if (!sid || !isValidSessionId2(sid)) return null;
        const tp = e.transcript_path && isValidTranscriptPath4(e.transcript_path) ? e.transcript_path : void 0;
        switch (e.hook_event_name) {
          case "SessionStart":
            return {
              kind: "session_start",
              sessionId: sid,
              timestamp: ts,
              model: e.model,
              transcriptPath: tp
            };
          case "SessionEnd":
            return { kind: "stop", sessionId: sid, timestamp: ts, transcriptPath: tp };
          case "BeforeAgent":
            return e.prompt ? { kind: "prompt", sessionId: sid, timestamp: ts, prompt: e.prompt, model: e.model } : null;
          case "AfterAgent":
            return e.prompt_response ? { kind: "response", sessionId: sid, timestamp: ts, response: e.prompt_response } : null;
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
                file: filePath
              };
            }
            if (SHELL_TOOLS.has(toolName) && isGitCommit3(cmd)) {
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
                file: filePath
              };
            }
            if (SHELL_TOOLS.has(toolName) && isGitCommit3(cmd)) {
              return { kind: "post_commit", sessionId: sid, timestamp: ts, transcriptPath: tp };
            }
            return null;
          }
          default:
            return null;
        }
      },
      findTranscript(sessionId) {
        if (!isValidSessionId2(sessionId)) return null;
        const tmpDir = join4(geminiHome(), "tmp");
        if (!existsSync4(tmpDir)) return null;
        return findTranscriptCandidate2(tmpDir, sessionId);
      },
      async extractInteractions(transcriptPath) {
        if (!isValidTranscriptPath4(transcriptPath) || !existsSync4(transcriptPath)) return [];
        let content;
        try {
          content = await readFile4(transcriptPath, "utf-8");
        } catch {
          return [];
        }
        const interactions = [];
        let current = null;
        for (const rawLine of content.split("\n")) {
          const line = rawLine.trim();
          if (!line) continue;
          let record;
          try {
            record = JSON.parse(line);
          } catch {
            continue;
          }
          const type = typeof record.type === "string" ? record.type : void 0;
          if (!type) continue;
          if (type === "user") {
            const prompt = extractPartText(record.content);
            if (!prompt) continue;
            if (current) interactions.push(current);
            current = { prompt, response: null };
            continue;
          }
          if (type === "gemini" && current) {
            const response = extractPartText(record.content);
            if (response) {
              current.response = current.response ? `${current.response}
${response}` : response;
            }
            const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
            for (const call of toolCalls) {
              if (!isRecord3(call)) continue;
              const toolName = typeof call.name === "string" ? call.name : void 0;
              if (!toolName || !EDIT_TOOLS.has(toolName)) continue;
              const args2 = isRecord3(call.args) ? call.args : void 0;
              const filePath = typeof args2?.file_path === "string" ? args2.file_path : void 0;
              if (filePath) {
                current.files_touched = [.../* @__PURE__ */ new Set([...current.files_touched ?? [], filePath])];
              }
            }
          }
        }
        if (current) interactions.push(current);
        return interactions;
      }
    };
  }
});

// src/agents/index.ts
function getAgent(name) {
  const agent = AGENTS.get(name);
  if (!agent) {
    throw new Error(`unknown agent: ${name}`);
  }
  return agent;
}
function hasAgent(name) {
  return AGENTS.has(name);
}
function listAgents() {
  return [...AGENTS.keys()];
}
var AGENTS;
var init_agents = __esm({
  "src/agents/index.ts"() {
    "use strict";
    init_claude();
    init_codex();
    init_cursor();
    init_gemini();
    AGENTS = /* @__PURE__ */ new Map([
      [claude.name, claude],
      [codex.name, codex],
      [cursor.name, cursor],
      [gemini.name, gemini]
    ]);
  }
});

// src/git.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
async function git(args2, options) {
  const { stdout } = await execFileAsync("git", args2, {
    cwd: options?.cwd,
    encoding: "utf-8"
  });
  return stdout.trim();
}
async function gitSafe(args2, options) {
  try {
    const stdout = await git(args2, options);
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err;
    return {
      stdout: typeof e.stdout === "string" ? e.stdout.trim() : "",
      exitCode: typeof e.code === "number" ? e.code : 1
    };
  }
}
async function repoRoot2() {
  return git(["rev-parse", "--show-toplevel"]);
}
var execFileAsync;
var init_git = __esm({
  "src/git.ts"() {
    "use strict";
    execFileAsync = promisify(execFile);
  }
});

// src/core/attribution.ts
function parseUnifiedHunks(diffOutput) {
  const hunks = [];
  for (const line of diffOutput.split("\n")) {
    const m = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (m) {
      hunks.push({
        oldStart: Number(m[1]),
        oldCount: m[2] != null ? Number(m[2]) : 1,
        newStart: Number(m[3]),
        newCount: m[4] != null ? Number(m[4]) : 1
      });
    }
  }
  return hunks;
}
function expandNewPositions(hunks) {
  const positions = /* @__PURE__ */ new Set();
  for (const h of hunks) {
    for (let i = 0; i < h.newCount; i++) {
      positions.add(h.newStart + i);
    }
  }
  return positions;
}
function countLines(hunks) {
  let added = 0;
  let deleted = 0;
  for (const h of hunks) {
    added += h.newCount;
    deleted += h.oldCount;
  }
  return { added, deleted };
}
async function computePositionAttribution(parentBlob, committedBlob, turnPairs) {
  const diff1Output = await gitDiffUnified0(parentBlob, committedBlob);
  const diff1Hunks = parseUnifiedHunks(diff1Output);
  const diff1Added = expandNewPositions(diff1Hunks);
  const { added: totalAddedLines, deleted: deletedLines } = countLines(diff1Hunks);
  if (turnPairs.length === 0 || totalAddedLines === 0) {
    return {
      aiAddedLines: 0,
      humanAddedLines: totalAddedLines,
      totalAddedLines,
      deletedLines,
      contributingTurns: /* @__PURE__ */ new Set()
    };
  }
  const aiPositions = /* @__PURE__ */ new Set();
  const contributingTurns = /* @__PURE__ */ new Set();
  for (const { preBlob, postBlob, turn } of turnPairs) {
    const diff2Output = await gitDiffUnified0(preBlob, committedBlob);
    const diff2Positions = expandNewPositions(parseUnifiedHunks(diff2Output));
    const diff3Output = await gitDiffUnified0(postBlob, committedBlob);
    const diff3Positions = expandNewPositions(parseUnifiedHunks(diff3Output));
    for (const pos of diff2Positions) {
      if (!diff3Positions.has(pos)) {
        aiPositions.add(pos);
      }
    }
    if (turn !== void 0 && turn > 0) {
      for (const pos of diff1Added) {
        if (diff2Positions.has(pos) && !diff3Positions.has(pos)) {
          contributingTurns.add(turn);
          break;
        }
      }
    }
  }
  let aiAddedLines = 0;
  let humanAddedLines = 0;
  for (const pos of diff1Added) {
    if (aiPositions.has(pos)) {
      aiAddedLines++;
    } else {
      humanAddedLines++;
    }
  }
  return { aiAddedLines, humanAddedLines, totalAddedLines, deletedLines, contributingTurns };
}
async function gitDiffUnified0(blobA, blobB) {
  if (!blobA || !blobB || blobA === blobB) return "";
  const { stdout, exitCode } = await gitSafe(["diff", "--unified=0", "--no-color", blobA, blobB]);
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`git diff failed with exit code ${exitCode}`);
  }
  return stdout;
}
var init_attribution = __esm({
  "src/core/attribution.ts"() {
    "use strict";
    init_git();
    init_constants();
  }
});

// src/core/entry.ts
function isGeneratedArtifactPath(path) {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => GENERATED_DIR_SEGMENTS.has(segment))) {
    return true;
  }
  const basename2 = segments.at(-1) ?? normalized;
  if (GENERATED_FILE_NAMES.has(basename2)) return true;
  return GENERATED_FILE_SUFFIXES.some((suffix) => basename2.endsWith(suffix));
}
function hasGeneratedArtifactMarkers(content) {
  const header = content.slice(0, 2048).toLowerCase();
  return GENERATED_CONTENT_PATTERNS.some((pattern) => pattern.test(header));
}
function filterAiRatioEligibleFiles(files) {
  return files.filter((file) => !file.generated && !isGeneratedArtifactPath(file.path));
}
function countAiRatioEligibleFiles(files) {
  const eligible = filterAiRatioEligibleFiles(files);
  return {
    total: eligible.length,
    ai: eligible.filter((file) => file.by_ai).length
  };
}
function calcAiRatio(files, lineCounts) {
  if (lineCounts && lineCounts.totalAddedLines > 0) {
    return Math.round(lineCounts.aiAddedLines / lineCounts.totalAddedLines * 100);
  }
  const eligible = countAiRatioEligibleFiles(files);
  if (eligible.total === 0) return 0;
  return Math.round(eligible.ai / eligible.total * 100);
}
function resolveMethod(lineCounts) {
  if (!lineCounts) return "file";
  if (lineCounts.totalAddedLines === 0) return "none";
  return "line";
}
function buildEntry(opts) {
  const generatedFiles = new Set(opts.generatedFiles ?? []);
  const files = opts.commitFiles.map((path) => ({
    path,
    by_ai: opts.aiFiles.includes(path),
    ...generatedFiles.has(path) ? { generated: true } : {}
  }));
  const method = resolveMethod(opts.lineCounts);
  const aiRatio = method === "none" ? 0 : calcAiRatio(files, opts.lineCounts);
  const attribution = { ai_ratio: aiRatio, method };
  if (opts.lineCounts) {
    attribution.lines = {
      ai_added: opts.lineCounts.aiAddedLines,
      total_added: opts.lineCounts.totalAddedLines,
      deleted: opts.lineCounts.deletedLines
    };
  }
  const interactions = opts.interactions.map((i, idx) => {
    const base = { prompt: i.prompt, response: i.response };
    if (i.files_touched && i.files_touched.length > 0) {
      base.files_touched = i.files_touched;
    }
    if (opts.interactionTools?.has(idx)) {
      base.tools = opts.interactionTools.get(idx) ?? null;
    } else if (i.tools !== void 0) {
      base.tools = i.tools;
    }
    return base;
  });
  return {
    v: SCHEMA_VERSION,
    agent: opts.agent ?? null,
    session_id: opts.sessionId,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    model: opts.model ?? null,
    interactions,
    files,
    attribution
  };
}
var GENERATED_DIR_SEGMENTS, GENERATED_FILE_NAMES, GENERATED_FILE_SUFFIXES, GENERATED_CONTENT_PATTERNS;
var init_entry = __esm({
  "src/core/entry.ts"() {
    "use strict";
    init_constants();
    GENERATED_DIR_SEGMENTS = /* @__PURE__ */ new Set([
      // Web / JS / TS build outputs
      ".next",
      ".nuxt",
      "coverage",
      "dist",
      "out",
      // Monorepo / remote-cache build outputs
      ".turbo",
      ".yarn",
      "bazel-bin",
      "bazel-out",
      "bazel-testlogs",
      // Mobile / Flutter build caches
      ".dart_tool",
      "DerivedData",
      // Multi-language generic build directories (Android, Kotlin, Rust, Go, Dart)
      "build",
      "gen",
      "generated",
      "target"
    ]);
    GENERATED_FILE_NAMES = /* @__PURE__ */ new Set([
      // Flutter tool-managed dependency snapshot
      ".flutter-plugins-dependencies",
      // Flutter desktop / mobile plugin registrants
      "generated_plugin_registrant.dart",
      "GeneratedPluginRegistrant.java",
      "GeneratedPluginRegistrant.swift",
      "GeneratedPluginRegistrant.m",
      "GeneratedPluginRegistrant.h"
    ]);
    GENERATED_FILE_SUFFIXES = [
      // Web / TS / GraphQL / OpenAPI codegen
      ".gen.ts",
      ".gen.tsx",
      ".generated.js",
      ".generated.jsx",
      ".generated.ts",
      ".generated.tsx",
      // Dart / Flutter codegen
      ".chopper.dart",
      ".config.dart",
      ".freezed.dart",
      ".g.dart",
      ".gr.dart",
      ".mocks.dart",
      ".pb.dart",
      ".pbjson.dart",
      ".pbenum.dart",
      ".pbserver.dart",
      // Go codegen
      ".pb.go",
      ".pb.gw.go",
      ".twirp.go",
      ".gen.go",
      ".generated.go",
      "_gen.go",
      "_generated.go",
      "_string.go",
      // Rust codegen
      ".generated.rs",
      ".pb.rs",
      "_generated.rs",
      // Kotlin / Swift codegen
      ".g.kt",
      ".gen.kt",
      ".generated.kt",
      ".g.swift",
      ".generated.swift",
      // Web sourcemaps
      ".map"
    ];
    GENERATED_CONTENT_PATTERNS = [
      // Cross-language generator banners used by protoc, sqlc, stringer, bindgen, etc.
      /\bcode generated\b[\s\S]{0,160}\bdo not edit\b/i,
      /\bautomatically generated by\b/i,
      /\bthis file was generated by\b/i,
      // Annotation-style banners commonly used in Java / Kotlin / JS ecosystems.
      /\B@generated\b/i,
      // Named generators across Web, mobile, backend, and protobuf toolchains.
      /\bgenerated by (?:swiftgen|sourcery|protoc|buf|sqlc|openapi(?:-generator)?|openapitools|wire|freezed|build_runner|mockgen|rust-bindgen|apollo|drift|flutterfire|ksp)\b/i
    ];
  }
});

// src/core/jsonl.ts
import { existsSync as existsSync5 } from "node:fs";
import { appendFile, readFile as readFile5 } from "node:fs/promises";
async function readJsonlEntries(filePath) {
  if (!existsSync5(filePath)) return [];
  const content = await readFile5(filePath, "utf-8");
  const entries = [];
  for (const line of content.trim().split("\n")) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
    }
  }
  return entries;
}
async function appendJsonl(filePath, data) {
  await appendFile(filePath, `${JSON.stringify(data)}
`);
}
var init_jsonl = __esm({
  "src/core/jsonl.ts"() {
    "use strict";
  }
});

// src/core/session.ts
import { existsSync as existsSync6 } from "node:fs";
import { readFile as readFile6, writeFile as writeFile5 } from "node:fs/promises";
import { join as join5 } from "node:path";
async function writeSessionAgent(sessionDir, agentName) {
  await writeFile5(join5(sessionDir, SESSION_AGENT_FILE), `${agentName}
`);
}
async function readSessionAgent(sessionDir) {
  const agentPath = join5(sessionDir, SESSION_AGENT_FILE);
  if (!existsSync6(agentPath)) return null;
  const agent = (await readFile6(agentPath, "utf-8")).trim();
  return agent || null;
}
async function writeSessionTranscriptPath(sessionDir, transcriptPath) {
  await writeFile5(join5(sessionDir, TRANSCRIPT_PATH_FILE), `${transcriptPath}
`);
}
async function readSessionTranscriptPath(sessionDir) {
  const saved = join5(sessionDir, TRANSCRIPT_PATH_FILE);
  if (!existsSync6(saved)) return null;
  const transcriptPath = (await readFile6(saved, "utf-8")).trim();
  return transcriptPath || null;
}
var init_session = __esm({
  "src/core/session.ts"() {
    "use strict";
    init_constants();
  }
});

// src/core/storage.ts
async function writeNote(commitSha, data) {
  const body = JSON.stringify(data, null, 2);
  await gitSafe(["notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", body, commitSha]);
}
async function readNote(commitSha) {
  const { stdout, exitCode } = await gitSafe(["notes", `--ref=${NOTES_REF}`, "show", commitSha]);
  if (exitCode !== 0 || !stdout.trim()) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
var init_storage = __esm({
  "src/core/storage.ts"() {
    "use strict";
    init_git();
    init_constants();
  }
});

// src/core/record.ts
var record_exports = {};
__export(record_exports, {
  recordCommitEntry: () => recordCommitEntry
});
import { spawn } from "node:child_process";
import { existsSync as existsSync7 } from "node:fs";
import { readdir, readFile as readFile7, unlink, writeFile as writeFile6 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join6 } from "node:path";
async function recordCommitEntry(opts) {
  const sessionDir = join6(opts.agentnoteDirPath, "sessions", opts.sessionId);
  const sessionAgent = await readSessionAgent(sessionDir);
  const agentName = sessionAgent && hasAgent(sessionAgent) ? sessionAgent : "claude";
  const adapter = getAgent(agentName);
  const commitSha = await git(["rev-parse", "HEAD"]);
  const existingNote = await readNote(commitSha);
  if (existingNote) return { promptCount: 0, aiRatio: 0 };
  let commitFiles = [];
  try {
    const raw = await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    commitFiles = raw.split("\n").filter(Boolean);
  } catch {
  }
  const commitFileSet = new Set(commitFiles);
  const allChangeEntries = await readAllSessionJsonl(sessionDir, CHANGES_FILE);
  const promptEntries = await readAllSessionJsonl(sessionDir, PROMPTS_FILE);
  const allPreBlobEntries = await readAllSessionJsonl(sessionDir, PRE_BLOBS_FILE);
  const preBlobTurnById = /* @__PURE__ */ new Map();
  const preBlobPromptIdById = /* @__PURE__ */ new Map();
  for (const e of allPreBlobEntries) {
    const id = e.tool_use_id;
    if (!id) continue;
    if (typeof e.turn === "number") preBlobTurnById.set(id, e.turn);
    if (typeof e.prompt_id === "string" && e.prompt_id) preBlobPromptIdById.set(id, e.prompt_id);
  }
  for (const entry2 of allChangeEntries) {
    const id = entry2.tool_use_id;
    if (!id) continue;
    if (preBlobTurnById.has(id)) entry2.turn = preBlobTurnById.get(id);
    if (preBlobPromptIdById.has(id)) entry2.prompt_id = preBlobPromptIdById.get(id);
  }
  const consumedPairs = await readConsumedPairs(sessionDir);
  const changeEntries = allChangeEntries.filter((e) => !consumedPairs.has(consumedKey(e)));
  const preBlobEntriesForTurnFix = allPreBlobEntries.filter(
    (e) => !consumedPairs.has(consumedKey(e))
  );
  const maxConsumedTurn = await readMaxConsumedTurn(sessionDir);
  const hasTurnData = promptEntries.some((e) => typeof e.turn === "number" && e.turn > 0);
  const allSessionEditTurns = collectSessionEditTurns(allChangeEntries, allPreBlobEntries);
  const commitFileTurns = collectCommitFileTurns(
    changeEntries,
    preBlobEntriesForTurnFix,
    commitFileSet
  );
  let aiFiles;
  let prompts;
  let relevantPromptEntries;
  const relevantTurns = new Set(commitFileTurns.keys());
  let primaryTurns = /* @__PURE__ */ new Set();
  if (hasTurnData) {
    const aiFileSet = /* @__PURE__ */ new Set();
    for (const e of changeEntries) {
      const f = e.file;
      if (f && commitFileSet.has(f)) aiFileSet.add(f);
    }
    for (const e of preBlobEntriesForTurnFix) {
      const f = e.file;
      if (f && commitFileSet.has(f)) aiFileSet.add(f);
    }
    aiFiles = [...aiFileSet];
    relevantPromptEntries = [];
    prompts = [];
  } else {
    aiFiles = changeEntries.map((e) => e.file).filter(Boolean);
    prompts = promptEntries.map((e) => e.prompt);
    relevantPromptEntries = promptEntries;
  }
  const generatedFiles = await detectGeneratedFiles(commitSha, commitFiles);
  const attributionCommitFileSet = new Set(
    commitFiles.filter((file) => !generatedFiles.includes(file))
  );
  const lineAttribution = hasTurnData ? await computeLineAttribution({
    sessionDir,
    commitFileSet,
    aiFileSet: new Set(aiFiles),
    generatedFileSet: new Set(generatedFiles),
    relevantTurns,
    hasTurnData,
    changeEntries
  }) : { counts: null, contributingTurns: /* @__PURE__ */ new Set() };
  if (hasTurnData) {
    const fileFallbackTurns = selectFileFallbackPrimaryTurns(commitFileTurns);
    primaryTurns = lineAttribution.contributingTurns.size > 0 ? lineAttribution.contributingTurns : fileFallbackTurns.size > 0 ? fileFallbackTurns : new Set(relevantTurns);
    relevantPromptEntries = selectPromptWindowEntries(
      promptEntries,
      primaryTurns,
      allSessionEditTurns,
      maxConsumedTurn
    );
    prompts = relevantPromptEntries.map((e) => e.prompt);
  }
  const transcriptPath = opts.transcriptPath ?? await readSessionTranscriptPath(sessionDir) ?? adapter.findTranscript(opts.sessionId);
  let crossTurnCommit = false;
  if (hasTurnData && relevantTurns.size > 0) {
    const turnFilePath = join6(sessionDir, TURN_FILE);
    let currentTurn = 0;
    if (existsSync7(turnFilePath)) {
      currentTurn = Number.parseInt((await readFile7(turnFilePath, "utf-8")).trim(), 10) || 0;
    }
    const minRelevantTurn = Math.min(...relevantTurns);
    crossTurnCommit = minRelevantTurn < currentTurn;
  }
  let interactions;
  let transcriptLineCounts;
  let consumedPromptEntries = [];
  let allInteractions = [];
  if (transcriptPath) {
    try {
      allInteractions = await adapter.extractInteractions(transcriptPath);
    } catch (err) {
      if (!crossTurnCommit) throw err;
    }
  }
  correlatePromptIds(allInteractions, promptEntries);
  const interactionsById = /* @__PURE__ */ new Map();
  for (const i of allInteractions) {
    if (i.prompt_id) interactionsById.set(i.prompt_id, i);
  }
  const transcriptEditsCommit = allInteractions.some(
    (i) => (i.files_touched ?? []).some((f) => commitFileSet.has(f))
  );
  const transcriptEditsOthers = allInteractions.some((i) => {
    const touched = i.files_touched ?? [];
    return touched.length > 0 && !touched.some((f) => commitFileSet.has(f));
  });
  if (hasTurnData && prompts.length === 0 && aiFiles.length === 0 && !transcriptEditsCommit && transcriptEditsOthers) {
    interactions = [];
  } else if (relevantPromptEntries.length > 0) {
    interactions = relevantPromptEntries.map((entry2) => {
      const id = typeof entry2.prompt_id === "string" ? entry2.prompt_id : void 0;
      const matched = id ? interactionsById.get(id) : void 0;
      if (matched) return toRecordedInteraction(matched, commitFileSet);
      return { prompt: entry2.prompt ?? "", response: null };
    });
    consumedPromptEntries = relevantPromptEntries;
    const transcriptMatched = relevantPromptEntries.map((entry2) => {
      const id = typeof entry2.prompt_id === "string" ? entry2.prompt_id : void 0;
      return id ? interactionsById.get(id) : void 0;
    }).filter(
      (i) => !!i && (i.files_touched ?? []).some((f) => commitFileSet.has(f))
    );
    if (transcriptMatched.length > 0) {
      aiFiles = [
        ...new Set(
          transcriptMatched.flatMap(
            (i) => (i.files_touched ?? []).filter((f) => commitFileSet.has(f))
          )
        )
      ];
      transcriptLineCounts = await resolveTranscriptLineCounts(
        attributionCommitFileSet,
        transcriptMatched
      );
    }
  } else if (transcriptPath && allInteractions.length > 0) {
    const transcriptMatched = allInteractions.filter(
      (i) => (i.files_touched ?? []).some((f) => commitFileSet.has(f))
    );
    const transcriptEditTurns = collectTranscriptEditTurns(allInteractions, promptEntries);
    const transcriptPrimaryTurns = await selectTranscriptPrimaryTurns(
      transcriptMatched,
      promptEntries,
      attributionCommitFileSet
    );
    const windowEntries = selectPromptWindowEntries(
      promptEntries,
      transcriptPrimaryTurns,
      transcriptEditTurns,
      maxConsumedTurn
    );
    relevantPromptEntries = windowEntries;
    prompts = windowEntries.map((entry2) => entry2.prompt ?? "");
    if (windowEntries.length > 0) {
      interactions = windowEntries.map((entry2) => {
        const id = typeof entry2.prompt_id === "string" ? entry2.prompt_id : void 0;
        const matched = id ? interactionsById.get(id) : void 0;
        if (matched) return toRecordedInteraction(matched, commitFileSet);
        return { prompt: entry2.prompt ?? "", response: null };
      });
      consumedPromptEntries = windowEntries;
    } else if (transcriptMatched.length > 0) {
      interactions = transcriptMatched.map((i) => toRecordedInteraction(i, commitFileSet));
    } else if (!crossTurnCommit) {
      interactions = selectTranscriptFallbackInteractions(allInteractions, commitFileSet);
    } else {
      interactions = [];
    }
    if (transcriptMatched.length > 0) {
      aiFiles = [
        ...new Set(
          transcriptMatched.flatMap(
            (i) => (i.files_touched ?? []).filter((f) => commitFileSet.has(f))
          )
        )
      ];
      transcriptLineCounts = await resolveTranscriptLineCounts(
        attributionCommitFileSet,
        transcriptMatched
      );
    }
  } else {
    interactions = prompts.map((p) => ({ prompt: p, response: null }));
  }
  await fillInteractionResponsesFromEvents(sessionDir, relevantPromptEntries, interactions);
  if (hasTurnData) {
    attachFilesTouched(changeEntries, relevantPromptEntries, interactions, commitFileSet);
  }
  const model = await readSessionModel(sessionDir);
  const interactionTools = buildInteractionTools(
    changeEntries,
    relevantPromptEntries,
    commitFileSet
  );
  if (interactions.length === 0 && aiFiles.length === 0) {
    return { promptCount: 0, aiRatio: 0 };
  }
  const entry = buildEntry({
    agent: agentName,
    sessionId: opts.sessionId,
    model,
    interactions,
    commitFiles,
    aiFiles,
    generatedFiles,
    lineCounts: lineAttribution.counts ?? transcriptLineCounts,
    interactionTools
  });
  await writeNote(commitSha, entry);
  await recordConsumedPairs(
    sessionDir,
    changeEntries,
    preBlobEntriesForTurnFix,
    commitFileSet,
    consumedPromptEntries
  );
  return { promptCount: interactions.length, aiRatio: entry.attribution.ai_ratio };
}
function correlatePromptIds(interactions, sessionPromptEntries) {
  const sessionTextToIds = /* @__PURE__ */ new Map();
  for (const entry of sessionPromptEntries) {
    const text = typeof entry.prompt === "string" ? entry.prompt : void 0;
    const id = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
    if (!text || !id) continue;
    if (!sessionTextToIds.has(text)) sessionTextToIds.set(text, []);
    sessionTextToIds.get(text)?.push(id);
  }
  const txTextToIndices = /* @__PURE__ */ new Map();
  for (let idx = 0; idx < interactions.length; idx++) {
    const text = interactions[idx].prompt;
    if (!txTextToIndices.has(text)) txTextToIndices.set(text, []);
    txTextToIndices.get(text)?.push(idx);
  }
  for (const [text, ids] of sessionTextToIds) {
    const indices = txTextToIndices.get(text) ?? [];
    if (indices.length < ids.length) continue;
    for (let i = 0; i < ids.length; i++) {
      interactions[indices[i]].prompt_id = ids[i];
    }
  }
}
function toRecordedInteraction(interaction, commitFileSet) {
  const recorded = {
    prompt: interaction.prompt,
    response: interaction.response
  };
  const filesTouched = interaction.files_touched?.filter((file) => commitFileSet.has(file));
  if (filesTouched && filesTouched.length > 0) {
    recorded.files_touched = [...new Set(filesTouched)];
  }
  if (interaction.tools !== void 0) {
    recorded.tools = interaction.tools;
  }
  return recorded;
}
function selectTranscriptFallbackInteractions(interactions, commitFileSet) {
  const latestToolBacked = [...interactions].reverse().find((interaction) => (interaction.tools?.length ?? 0) > 0);
  return latestToolBacked ? [toRecordedInteraction(latestToolBacked, commitFileSet)] : [];
}
async function fillInteractionResponsesFromEvents(sessionDir, promptEntries, interactions) {
  if (interactions.length === 0 || promptEntries.length === 0) return;
  const responsesByTurn = await readResponsesByTurn(sessionDir);
  if (responsesByTurn.size === 0) return;
  for (let index = 0; index < interactions.length; index++) {
    const interaction = interactions[index];
    const promptEntry = promptEntries[index];
    if (!interaction || !promptEntry || interaction.response) continue;
    const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
    if (!turn) continue;
    const response = responsesByTurn.get(turn);
    if (response) {
      interaction.response = response;
    }
  }
}
async function resolveTranscriptLineCounts(commitFileSet, interactions) {
  const transcriptStats = /* @__PURE__ */ new Map();
  for (const interaction of interactions) {
    for (const [file, stats] of Object.entries(interaction.line_stats ?? {})) {
      if (!commitFileSet.has(file)) continue;
      const previous = transcriptStats.get(file) ?? { added: 0, deleted: 0 };
      transcriptStats.set(file, {
        added: previous.added + stats.added,
        deleted: previous.deleted + stats.deleted
      });
    }
  }
  if (transcriptStats.size === 0) return void 0;
  const committedDiffCounts = await readCommittedDiffCounts(commitFileSet);
  if (committedDiffCounts.size !== commitFileSet.size) return void 0;
  let aiAddedLines = 0;
  let totalAddedLines = 0;
  let deletedLines = 0;
  for (const file of commitFileSet) {
    const transcript = transcriptStats.get(file);
    const committed = committedDiffCounts.get(file);
    if (!transcript || !committed) return void 0;
    if (transcript.added !== committed.added || transcript.deleted !== committed.deleted) {
      return void 0;
    }
    aiAddedLines += transcript.added;
    totalAddedLines += committed.added;
    deletedLines += committed.deleted;
  }
  return { aiAddedLines, totalAddedLines, deletedLines };
}
async function readCommittedDiffCounts(commitFileSet) {
  const counts = /* @__PURE__ */ new Map();
  for (const file of commitFileSet) {
    const { stdout, exitCode } = await gitSafe([
      "diff-tree",
      "--patch",
      "--unified=0",
      "--root",
      "--no-commit-id",
      "-r",
      "HEAD",
      "--",
      file
    ]);
    if (exitCode !== 0 && exitCode !== 1) {
      return /* @__PURE__ */ new Map();
    }
    const diffCounts = countLines(parseUnifiedHunks(stdout));
    counts.set(file, diffCounts);
  }
  return counts;
}
function attachFilesTouched(changeEntries, promptEntries, interactions, commitFileSet) {
  const filesByTurn = /* @__PURE__ */ new Map();
  for (const entry of changeEntries) {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const file = entry.file;
    if (!file || !commitFileSet.has(file)) continue;
    if (!filesByTurn.has(turn)) filesByTurn.set(turn, /* @__PURE__ */ new Set());
    filesByTurn.get(turn)?.add(file);
  }
  for (let i = 0; i < interactions.length; i++) {
    const promptEntry = promptEntries[i];
    if (!promptEntry) continue;
    const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
    const files = filesByTurn.get(turn);
    if (files && files.size > 0) {
      interactions[i].files_touched = [...files];
    }
  }
}
function collectSessionEditTurns(changeEntries, preBlobEntries) {
  const turns = /* @__PURE__ */ new Set();
  for (const entry of [...changeEntries, ...preBlobEntries]) {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const file = entry.file;
    if (turn > 0 && file) turns.add(turn);
  }
  return turns;
}
function collectTranscriptEditTurns(interactions, promptEntries) {
  const promptTurnById = /* @__PURE__ */ new Map();
  for (const entry of promptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (promptId && turn > 0) promptTurnById.set(promptId, turn);
  }
  const turns = /* @__PURE__ */ new Set();
  for (const interaction of interactions) {
    if (!interaction.prompt_id || (interaction.files_touched?.length ?? 0) === 0) continue;
    const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
    if (turn > 0) turns.add(turn);
  }
  return turns;
}
function collectCommitFileTurns(changeEntries, preBlobEntries, commitFileSet) {
  const turns = /* @__PURE__ */ new Map();
  const addEntry = (entry) => {
    const file = entry.file;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (!file || !commitFileSet.has(file) || turn <= 0) return;
    if (!turns.has(turn)) turns.set(turn, /* @__PURE__ */ new Set());
    turns.get(turn)?.add(file);
  };
  for (const entry of changeEntries) addEntry(entry);
  for (const entry of preBlobEntries) addEntry(entry);
  return turns;
}
function selectFileFallbackPrimaryTurns(commitFileTurns) {
  if (commitFileTurns.size === 0) return /* @__PURE__ */ new Set();
  const latestTurnByFile = /* @__PURE__ */ new Map();
  for (const [turn, files] of commitFileTurns) {
    for (const file of files) {
      const previous = latestTurnByFile.get(file) ?? 0;
      if (turn > previous) latestTurnByFile.set(file, turn);
    }
  }
  return new Set(latestTurnByFile.values());
}
function selectPromptWindowEntries(promptEntries, primaryTurns, editTurns, maxConsumedTurn) {
  if (primaryTurns.size === 0) return [];
  const orderedPrimaryTurns = [...primaryTurns].filter((turn) => turn > 0).sort((a, b) => a - b);
  if (orderedPrimaryTurns.length === 0) return [];
  const orderedEditTurns = [...editTurns].filter((turn) => turn > 0).sort((a, b) => a - b);
  const selectedTurns = /* @__PURE__ */ new Set();
  for (const primaryTurn of orderedPrimaryTurns) {
    selectedTurns.add(primaryTurn);
    let lowerBoundary = maxConsumedTurn;
    for (let index = orderedEditTurns.length - 1; index >= 0; index--) {
      const editTurn = orderedEditTurns[index];
      if (editTurn >= primaryTurn) continue;
      lowerBoundary = Math.max(editTurn, maxConsumedTurn);
      break;
    }
    for (let turn = primaryTurn - 1; turn > lowerBoundary; turn--) {
      if (editTurns.has(turn)) break;
      selectedTurns.add(turn);
    }
  }
  return promptEntries.filter((entry) => {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    return turn > 0 && selectedTurns.has(turn);
  });
}
async function selectTranscriptPrimaryTurns(transcriptMatched, promptEntries, commitFileSet) {
  const promptTurnById = /* @__PURE__ */ new Map();
  for (const entry of promptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (promptId && turn > 0) promptTurnById.set(promptId, turn);
  }
  const matchedTurns = /* @__PURE__ */ new Set();
  for (const interaction of transcriptMatched) {
    if (!interaction.prompt_id) continue;
    const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
    if (turn > 0) matchedTurns.add(turn);
  }
  if (matchedTurns.size === 0) return matchedTurns;
  const committedDiffCounts = await readCommittedDiffCounts(commitFileSet);
  if (committedDiffCounts.size !== commitFileSet.size) return matchedTurns;
  const cumulative = /* @__PURE__ */ new Map();
  const suffixTurns = /* @__PURE__ */ new Set();
  for (let index = transcriptMatched.length - 1; index >= 0; index--) {
    const interaction = transcriptMatched[index];
    let contributedStats = false;
    for (const [file, stats] of Object.entries(interaction.line_stats ?? {})) {
      if (!commitFileSet.has(file)) continue;
      contributedStats = true;
      const previous = cumulative.get(file) ?? { added: 0, deleted: 0 };
      cumulative.set(file, {
        added: previous.added + stats.added,
        deleted: previous.deleted + stats.deleted
      });
    }
    if (interaction.prompt_id) {
      const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
      if (turn > 0 && contributedStats) suffixTurns.add(turn);
    }
    if (matchesDiffCounts(cumulative, committedDiffCounts) && suffixTurns.size > 0) {
      return suffixTurns;
    }
  }
  return matchedTurns;
}
function matchesDiffCounts(actual, expected) {
  if (actual.size !== expected.size) return false;
  for (const [file, expectedCounts] of expected) {
    const actualCounts = actual.get(file);
    if (!actualCounts) return false;
    if (actualCounts.added !== expectedCounts.added || actualCounts.deleted !== expectedCounts.deleted) {
      return false;
    }
  }
  return true;
}
async function detectGeneratedFiles(commitSha, commitFiles) {
  const generated = /* @__PURE__ */ new Set();
  for (const file of commitFiles) {
    if (isGeneratedArtifactPath(file)) {
      generated.add(file);
      continue;
    }
    const content = await readCommittedFilePrefix(commitSha, file);
    if (content && hasGeneratedArtifactMarkers(content)) {
      generated.add(file);
    }
  }
  return [...generated];
}
async function readCommittedFilePrefix(commitSha, file, maxBytes = 2048) {
  return new Promise((resolve6) => {
    const child = spawn("git", ["show", `${commitSha}:${file}`], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    const stdout = child.stdout;
    if (!stdout) {
      resolve6(null);
      return;
    }
    const chunks = [];
    let totalBytes = 0;
    let stoppedEarly = false;
    let sawBinaryData = false;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve6(value);
    };
    child.on("error", () => finish(null));
    stdout.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.includes(0)) {
        sawBinaryData = true;
        stoppedEarly = true;
        child.kill();
        return;
      }
      if (totalBytes < maxBytes) {
        const remaining = maxBytes - totalBytes;
        const prefix = buffer.subarray(0, remaining);
        chunks.push(prefix);
        totalBytes += prefix.length;
      }
      if (totalBytes >= maxBytes) {
        stoppedEarly = true;
        child.kill();
      }
    });
    child.on("close", (code) => {
      if (sawBinaryData) {
        finish(null);
        return;
      }
      if (!stoppedEarly && code !== 0) {
        finish(null);
        return;
      }
      finish(Buffer.concat(chunks).toString("utf-8"));
    });
  });
}
async function readAllSessionJsonl(sessionDir, baseFile) {
  const stem = baseFile.slice(0, baseFile.lastIndexOf(".jsonl"));
  const files = await readdir(sessionDir).catch(() => []);
  const matching = files.filter((f) => {
    if (f === baseFile) return true;
    const suffix = f.slice(stem.length + 1, -".jsonl".length);
    return f.startsWith(`${stem}-`) && f.endsWith(".jsonl") && ARCHIVE_ID_RE.test(suffix);
  }).sort((a, b) => {
    const getId = (f) => {
      const s = f.slice(stem.length + 1, -".jsonl".length);
      return s ? parseInt(s, 36) : Infinity;
    };
    return getId(a) - getId(b);
  }).map((f) => join6(sessionDir, f));
  const all = [];
  for (const file of matching) {
    const entries = await readJsonlEntries(file);
    all.push(...entries);
  }
  return all;
}
async function computeLineAttribution(opts) {
  const {
    sessionDir,
    commitFileSet,
    aiFileSet,
    generatedFileSet,
    relevantTurns,
    hasTurnData,
    changeEntries
  } = opts;
  let diffTreeOutput;
  try {
    diffTreeOutput = await git(["diff-tree", "--raw", "--root", "-r", "HEAD"]);
  } catch {
    return { counts: null, contributingTurns: /* @__PURE__ */ new Set() };
  }
  const committedBlobs = parseDiffTreeBlobs(diffTreeOutput);
  if (committedBlobs.size === 0) {
    return { counts: null, contributingTurns: /* @__PURE__ */ new Set() };
  }
  await ensureEmptyBlobInStore();
  const preBlobEntries = await readAllSessionJsonl(sessionDir, PRE_BLOBS_FILE);
  const hasPreBlobData = preBlobEntries.some((e) => e.blob);
  const hasPostBlobData = changeEntries.some((e) => e.blob);
  if (!hasPreBlobData && !hasPostBlobData) {
    return { counts: null, contributingTurns: /* @__PURE__ */ new Set() };
  }
  const committedDiffCounts = await readCommittedDiffCounts(commitFileSet);
  if (committedDiffCounts.size !== commitFileSet.size) {
    return { counts: null, contributingTurns: /* @__PURE__ */ new Set() };
  }
  const preBlobById = /* @__PURE__ */ new Map();
  const preBlobsFallback = /* @__PURE__ */ new Map();
  for (const entry of preBlobEntries) {
    const file = entry.file;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const id = entry.tool_use_id;
    if (!file || !commitFileSet.has(file)) continue;
    if (hasTurnData && !relevantTurns.has(turn)) continue;
    if (id) {
      preBlobById.set(id, { file, blob: entry.blob || "", turn });
    } else {
      if (!preBlobsFallback.has(file)) preBlobsFallback.set(file, []);
      preBlobsFallback.get(file)?.push({ blob: entry.blob || "", turn });
    }
  }
  const turnPairsByFile = /* @__PURE__ */ new Map();
  const hadNewFileEditTurnsByFile = /* @__PURE__ */ new Map();
  const exactCursorEditCountFiles = /* @__PURE__ */ new Set();
  const exactCursorTurnsByFile = /* @__PURE__ */ new Map();
  const lastPostBlobByFile = /* @__PURE__ */ new Map();
  const postBlobsFallback = /* @__PURE__ */ new Map();
  const cursorEditCountsByFile = /* @__PURE__ */ new Map();
  for (const entry of changeEntries) {
    const file = entry.file;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const id = entry.tool_use_id;
    const postBlob = entry.blob || "";
    if (!file || !commitFileSet.has(file) || !postBlob) continue;
    const editAdded = typeof entry.edit_added === "number" ? entry.edit_added : null;
    const editDeleted = typeof entry.edit_deleted === "number" ? entry.edit_deleted : null;
    if (editAdded !== null && editDeleted !== null && (!hasTurnData || relevantTurns.has(id ? preBlobById.get(id)?.turn ?? turn : turn))) {
      const previous = cursorEditCountsByFile.get(file) ?? { added: 0, deleted: 0 };
      cursorEditCountsByFile.set(file, {
        added: previous.added + editAdded,
        deleted: previous.deleted + editDeleted
      });
      if (!exactCursorTurnsByFile.has(file)) exactCursorTurnsByFile.set(file, /* @__PURE__ */ new Set());
      exactCursorTurnsByFile.get(file)?.add(id ? preBlobById.get(id)?.turn ?? turn : turn);
    }
    lastPostBlobByFile.set(file, postBlob);
    if (id) {
      const pre = preBlobById.get(id);
      if (!pre) continue;
      if (hasTurnData && !relevantTurns.has(pre.turn)) continue;
      if (!pre.blob) {
        if (!hadNewFileEditTurnsByFile.has(file)) hadNewFileEditTurnsByFile.set(file, /* @__PURE__ */ new Set());
        hadNewFileEditTurnsByFile.get(file)?.add(pre.turn);
      } else {
        if (!turnPairsByFile.has(file)) turnPairsByFile.set(file, []);
        turnPairsByFile.get(file)?.push({ turn: pre.turn, preBlob: pre.blob, postBlob });
      }
    } else {
      if (hasTurnData && !relevantTurns.has(turn)) continue;
      if (!postBlobsFallback.has(file)) postBlobsFallback.set(file, []);
      postBlobsFallback.get(file)?.push({ blob: postBlob, turn });
    }
  }
  for (const [file, postBlobs] of postBlobsFallback) {
    const preBlobs = preBlobsFallback.get(file) ?? [];
    const pairCount = Math.min(preBlobs.length, postBlobs.length);
    for (let i = 0; i < pairCount; i++) {
      const pre = preBlobs[i]?.blob || "";
      const preTurn = preBlobs[i]?.turn ?? 0;
      const post = postBlobs[i]?.blob || "";
      if (!pre) {
        if (!hadNewFileEditTurnsByFile.has(file)) hadNewFileEditTurnsByFile.set(file, /* @__PURE__ */ new Set());
        hadNewFileEditTurnsByFile.get(file)?.add(preTurn);
      } else if (post) {
        if (!turnPairsByFile.has(file)) turnPairsByFile.set(file, []);
        turnPairsByFile.get(file)?.push({ turn: preTurn, preBlob: pre, postBlob: post });
      }
    }
  }
  for (const file of aiFileSet) {
    if (generatedFileSet.has(file)) continue;
    if (!commitFileSet.has(file)) continue;
    const hasPairs = (turnPairsByFile.get(file) ?? []).length > 0;
    const hasNewFileEdit = (hadNewFileEditTurnsByFile.get(file)?.size ?? 0) > 0;
    const cursorEditCounts = cursorEditCountsByFile.get(file);
    const committedCounts = committedDiffCounts.get(file);
    const committedBlob = committedBlobs.get(file)?.committedBlob ?? null;
    const lastPostBlob = lastPostBlobByFile.get(file) ?? null;
    const hasExactCursorEditCounts = !!cursorEditCounts && !!committedCounts && !!committedBlob && committedBlob === lastPostBlob && cursorEditCounts.added === committedCounts.added && cursorEditCounts.deleted === committedCounts.deleted;
    if (hasExactCursorEditCounts) {
      exactCursorEditCountFiles.add(file);
    }
    if (!hasPairs && !hasNewFileEdit && !hasExactCursorEditCounts) {
      return { counts: null, contributingTurns: /* @__PURE__ */ new Set() };
    }
  }
  let totalAiAdded = 0;
  let totalAdded = 0;
  let totalDeleted = 0;
  const contributingTurns = /* @__PURE__ */ new Set();
  for (const file of commitFileSet) {
    if (generatedFileSet.has(file)) continue;
    const blobs = committedBlobs.get(file);
    if (!blobs) continue;
    const { parentBlob, committedBlob } = blobs;
    const turnPairs = turnPairsByFile.get(file) ?? [];
    const hadNewFileEditTurns = hadNewFileEditTurnsByFile.get(file) ?? /* @__PURE__ */ new Set();
    try {
      const result = await computePositionAttribution(parentBlob, committedBlob, turnPairs);
      if (hadNewFileEditTurns.size > 0 && aiFileSet.has(file) && turnPairs.length === 0) {
        totalAiAdded += result.totalAddedLines;
        for (const turn of hadNewFileEditTurns) {
          if (turn > 0) contributingTurns.add(turn);
        }
      } else if (exactCursorEditCountFiles.has(file)) {
        totalAiAdded += result.totalAddedLines;
        for (const turn of exactCursorTurnsByFile.get(file) ?? []) {
          if (turn > 0) contributingTurns.add(turn);
        }
      } else {
        totalAiAdded += result.aiAddedLines;
        for (const turn of result.contributingTurns) {
          if (turn > 0) contributingTurns.add(turn);
        }
      }
      totalAdded += result.totalAddedLines;
      totalDeleted += result.deletedLines;
    } catch {
    }
  }
  return {
    counts: {
      aiAddedLines: totalAiAdded,
      totalAddedLines: totalAdded,
      deletedLines: totalDeleted
    },
    contributingTurns
  };
}
function parseDiffTreeBlobs(output) {
  const map = /* @__PURE__ */ new Map();
  const ZEROS = "0000000000000000000000000000000000000000";
  for (const line of output.split("\n")) {
    const m = line.match(/^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) \w+\t(.+)$/);
    if (!m) continue;
    const parentBlob = m[1] === ZEROS ? EMPTY_BLOB : m[1];
    const committedBlob = m[2] === ZEROS ? EMPTY_BLOB : m[2];
    const paths = m[3];
    const parts = paths.split("	");
    const file = parts[parts.length - 1];
    map.set(file, { parentBlob, committedBlob });
  }
  return map;
}
async function readMaxConsumedTurn(sessionDir) {
  const file = join6(sessionDir, COMMITTED_PAIRS_FILE);
  if (!existsSync7(file)) return 0;
  const entries = await readJsonlEntries(file);
  let max = 0;
  for (const e of entries) {
    const turn = typeof e.turn === "number" ? e.turn : 0;
    if (turn > max) max = turn;
  }
  return max;
}
async function readConsumedPairs(sessionDir) {
  const file = join6(sessionDir, COMMITTED_PAIRS_FILE);
  if (!existsSync7(file)) return /* @__PURE__ */ new Set();
  const entries = await readJsonlEntries(file);
  const set = /* @__PURE__ */ new Set();
  for (const e of entries) {
    if (typeof e.change_id === "string" && e.change_id) {
      set.add(`change:${e.change_id}`);
    } else if (e.tool_use_id) {
      set.add(`id:${e.tool_use_id}`);
    } else if (e.turn !== void 0 && e.file) {
      set.add(`${e.turn}:${e.file}`);
    }
  }
  return set;
}
function consumedKey(entry) {
  if (typeof entry.change_id === "string" && entry.change_id) {
    return `change:${entry.change_id}`;
  }
  if (entry.tool_use_id) return `id:${entry.tool_use_id}`;
  return `${entry.turn}:${entry.file}`;
}
async function recordConsumedPairs(sessionDir, changeEntries, preBlobEntries, commitFileSet, consumedPromptEntries = []) {
  const seen = /* @__PURE__ */ new Set();
  const pairsFile = join6(sessionDir, COMMITTED_PAIRS_FILE);
  const allEntries = [...changeEntries, ...preBlobEntries];
  for (const entry of allEntries) {
    const file = entry.file;
    if (!file || !commitFileSet.has(file)) continue;
    const key = consumedKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    await appendJsonl(pairsFile, {
      turn: entry.turn,
      file,
      change_id: entry.change_id ?? null,
      tool_use_id: entry.tool_use_id ?? null
    });
  }
  const promptSeen = /* @__PURE__ */ new Set();
  for (const entry of consumedPromptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
    const turn = typeof entry.turn === "number" ? entry.turn : void 0;
    if (!promptId || turn === void 0) continue;
    const key = `prompt:${promptId}`;
    if (promptSeen.has(key) || seen.has(key)) continue;
    promptSeen.add(key);
    await appendJsonl(pairsFile, {
      turn,
      prompt_id: promptId,
      file: null,
      change_id: null,
      tool_use_id: null
    });
  }
}
async function readResponsesByTurn(sessionDir) {
  const eventsFile = join6(sessionDir, EVENTS_FILE);
  if (!existsSync7(eventsFile)) return /* @__PURE__ */ new Map();
  const entries = await readJsonlEntries(eventsFile);
  const responsesByTurn = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (entry.event !== "response" && entry.event !== "stop") continue;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const response = typeof entry.response === "string" ? entry.response.trim() : "";
    if (!turn || !response) continue;
    const priority = entry.event === "response" ? 2 : 1;
    const current = responsesByTurn.get(turn);
    if (current && current.priority > priority) continue;
    responsesByTurn.set(turn, { response, priority });
  }
  return new Map([...responsesByTurn.entries()].map(([turn, value]) => [turn, value.response]));
}
async function readSessionModel(sessionDir) {
  const eventsFile = join6(sessionDir, EVENTS_FILE);
  if (!existsSync7(eventsFile)) return null;
  const entries = await readJsonlEntries(eventsFile);
  let fallbackModel = null;
  for (const e of entries) {
    if (e.event === "session_start" && typeof e.model === "string" && e.model) {
      return e.model;
    }
    if (fallbackModel === null && typeof e.model === "string" && e.model) {
      fallbackModel = e.model;
    }
  }
  return fallbackModel;
}
function buildInteractionTools(changeEntries, promptEntries, commitFileSet) {
  const toolsByTurn = /* @__PURE__ */ new Map();
  for (const entry of changeEntries) {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const file = entry.file;
    const tool = entry.tool;
    if (!file || !commitFileSet.has(file) || !tool) continue;
    if (!toolsByTurn.has(turn)) toolsByTurn.set(turn, /* @__PURE__ */ new Set());
    toolsByTurn.get(turn)?.add(tool);
  }
  const result = /* @__PURE__ */ new Map();
  for (let i = 0; i < promptEntries.length; i++) {
    const promptEntry = promptEntries[i];
    if (!promptEntry) continue;
    const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
    const tools = toolsByTurn.get(turn);
    if (tools && tools.size > 0) {
      result.set(i, [...tools]);
    }
  }
  return result;
}
async function ensureEmptyBlobInStore() {
  const tmp = join6(tmpdir(), `agentnote-empty-${process.pid}.tmp`);
  try {
    await writeFile6(tmp, "");
    await git(["hash-object", "-w", tmp]);
  } catch {
  } finally {
    try {
      await unlink(tmp);
    } catch {
    }
  }
}
var init_record = __esm({
  "src/core/record.ts"() {
    "use strict";
    init_agents();
    init_git();
    init_attribution();
    init_constants();
    init_entry();
    init_jsonl();
    init_session();
    init_storage();
  }
});

// src/paths.ts
var paths_exports = {};
__export(paths_exports, {
  agentnoteDir: () => agentnoteDir,
  root: () => root,
  sessionFile: () => sessionFile,
  settingsFile: () => settingsFile
});
import { join as join7 } from "node:path";
async function root() {
  if (!_root) {
    try {
      _root = await repoRoot2();
    } catch {
      console.error("error: git repository not found");
      process.exit(1);
    }
  }
  return _root;
}
async function gitDir() {
  if (!_gitDir) {
    _gitDir = await git(["rev-parse", "--git-dir"]);
    if (!_gitDir.startsWith("/")) {
      _gitDir = join7(await root(), _gitDir);
    }
  }
  return _gitDir;
}
async function agentnoteDir() {
  return join7(await gitDir(), AGENTNOTE_DIR);
}
async function sessionFile() {
  return join7(await agentnoteDir(), SESSION_FILE);
}
async function settingsFile() {
  return join7(await root(), ".claude", "settings.json");
}
var _root, _gitDir;
var init_paths = __esm({
  "src/paths.ts"() {
    "use strict";
    init_constants();
    init_git();
    _root = null;
    _gitDir = null;
  }
});

// src/commands/commit.ts
init_constants();
init_record();
init_paths();
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync8 } from "node:fs";
import { readFile as readFile8 } from "node:fs/promises";
import { join as join8 } from "node:path";
async function commit(args2) {
  const sf = await sessionFile();
  let sessionId = "";
  if (existsSync8(sf)) {
    sessionId = (await readFile8(sf, "utf-8")).trim();
    if (sessionId) {
      const dir = await agentnoteDir();
      const hbPath = join8(dir, "sessions", sessionId, HEARTBEAT_FILE);
      try {
        const hb = Number.parseInt((await readFile8(hbPath, "utf-8")).trim(), 10);
        if (hb === 0 || Number.isNaN(hb)) {
          sessionId = "";
        } else {
          const ageSeconds = Math.floor(Date.now() / 1e3) - Math.floor(hb / 1e3);
          if (ageSeconds > 3600) sessionId = "";
        }
      } catch {
        sessionId = "";
      }
    }
  }
  const gitArgs = ["commit"];
  if (sessionId) {
    gitArgs.push("--trailer", `${TRAILER_KEY}: ${sessionId}`);
  }
  gitArgs.push(...args2);
  const child = spawn2("git", gitArgs, {
    stdio: "inherit",
    cwd: process.cwd()
  });
  const exitCode = await new Promise((resolve6) => {
    child.on("close", (code) => resolve6(code ?? 1));
  });
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
  if (sessionId) {
    try {
      const agentnoteDirPath = await agentnoteDir();
      const result = await recordCommitEntry({ agentnoteDirPath, sessionId });
      console.log(`agent-note: ${result.promptCount} prompts, AI ratio ${result.aiRatio}%`);
    } catch (err) {
      console.error(`agent-note: warning: ${err.message}`);
    }
  }
}

// src/commands/deinit.ts
init_agents();
init_constants();
init_git();
init_paths();
import { existsSync as existsSync10 } from "node:fs";
import { readFile as readFile10, rename, unlink as unlink2 } from "node:fs/promises";
import { join as join10 } from "node:path";

// src/commands/init.ts
init_agents();
init_constants();
init_git();
init_paths();
import { existsSync as existsSync9 } from "node:fs";
import { chmod, mkdir as mkdir5, readFile as readFile9, writeFile as writeFile7 } from "node:fs/promises";
import { isAbsolute as isAbsolute2, join as join9, resolve as resolve5 } from "node:path";
var PR_REPORT_WORKFLOW_FILENAME = "agentnote-pr-report.yml";
var DASHBOARD_WORKFLOW_FILENAME = "agentnote-dashboard.yml";
var PR_REPORT_WORKFLOW_TEMPLATE = `name: Agent Note PR Report
on:
  pull_request:
    types: [opened, reopened, synchronize]
concurrency:
  group: agentnote-\${{ github.event.pull_request.number }}
  cancel-in-progress: true
permissions:
  contents: read
  pull-requests: write
jobs:
  report:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - uses: wasabeef/AgentNote@v0
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
var DASHBOARD_WORKFLOW_TEMPLATE = `name: Agent Note Dashboard

on:
  push:
  pull_request:
    types:
      - opened
      - reopened
      - synchronize

permissions:
  contents: write
  pages: write
  id-token: write
  pull-requests: read

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      should_deploy: \${{ steps.notes.outputs.should_deploy }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - name: Check out Dashboard source
        uses: actions/checkout@v6
        with:
          repository: wasabeef/AgentNote
          ref: v0
          path: .agentnote-dashboard-source

      - name: Restore Dashboard notes from gh-pages
        run: npm --prefix .agentnote-dashboard-source run dashboard:restore-notes

      - name: Update Dashboard notes from git notes
        id: notes
        env:
          NOTES_DIR: \${{ github.workspace }}/.agentnote-dashboard-notes
          EVENT_NAME: \${{ github.event_name }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: \${{ github.repository }}
          DEFAULT_BRANCH: \${{ github.event.repository.default_branch }}
          BEFORE_SHA: \${{ github.event.before }}
          HEAD_SHA: \${{ github.sha }}
          REF_NAME: \${{ github.ref_name }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
          PR_TITLE: \${{ github.event.pull_request.title }}
          PR_HEAD_REPO: \${{ github.event.pull_request.head.repo.full_name }}
        run: npm --prefix .agentnote-dashboard-source run dashboard:sync-notes

      - name: Build Dashboard
        if: steps.notes.outputs.should_build == 'true'
        env:
          NOTES_DIR: \${{ github.workspace }}/.agentnote-dashboard-notes
          PAGES_DIR: \${{ github.workspace }}/.pages
          PUBLIC_REPO: \${{ github.repository }}
        run: npm --prefix .agentnote-dashboard-source run dashboard:build-pages

      - name: Upload Pages artifact
        if: steps.notes.outputs.should_deploy == 'true'
        uses: actions/upload-pages-artifact@v5
        with:
          path: .pages

      - name: Persist Dashboard notes to gh-pages
        if: steps.notes.outputs.should_persist == 'true'
        env:
          NOTES_DIR: \${{ github.workspace }}/.agentnote-dashboard-notes
        run: npm --prefix .agentnote-dashboard-source run dashboard:persist-notes

  deploy:
    if: needs.build.outputs.should_deploy == 'true'
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;
function parseAgentArgs(args2) {
  const agentFlagIndexes = args2.reduce((indexes, arg, index) => {
    if (arg === "--agent") indexes.push(index);
    return indexes;
  }, []);
  if (agentFlagIndexes.length === 0) return [];
  if (agentFlagIndexes.length > 1) {
    throw new Error("repeat --agent is not supported. Use --agent claude cursor");
  }
  const agents = [];
  let cursor2 = agentFlagIndexes[0] + 1;
  while (cursor2 < args2.length && !args2[cursor2].startsWith("--")) {
    agents.push(args2[cursor2]);
    cursor2++;
  }
  return [...new Set(agents)];
}
var PREPARE_COMMIT_MSG_SCRIPT = `#!/bin/sh
${AGENTNOTE_HOOK_MARKER}
# Inject Agentnote-Session trailer into commit messages.
# Skip amend/reword/reuse (-c/-C/--amend) \u2014 only brand-new commits get a trailer.
# $2 values: "" (normal), "template", "merge", "squash" = new commits.
# "commit" = -c/-C/--amend (reuse). Skip those.
case "$2" in commit) exit 0;; esac
# Fail closed: no session file, no heartbeat, or stale heartbeat \u2192 skip.
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
SESSION_FILE="$GIT_DIR/agentnote/session"
if [ ! -f "$SESSION_FILE" ]; then exit 0; fi
SESSION_ID=$(cat "$SESSION_FILE" 2>/dev/null | tr -d '\\n')
if [ -z "$SESSION_ID" ]; then exit 0; fi
# Check freshness via this session's heartbeat (< 1 hour).
HEARTBEAT_FILE="$GIT_DIR/agentnote/sessions/$SESSION_ID/heartbeat"
if [ ! -f "$HEARTBEAT_FILE" ]; then exit 0; fi
NOW=$(date +%s)
HB=$(cat "$HEARTBEAT_FILE" 2>/dev/null | tr -d '\\n')
HB_SEC=\${HB%???}
AGE=$((NOW - HB_SEC))
if [ "$AGE" -gt 3600 ] 2>/dev/null; then exit 0; fi
if ! grep -q "${TRAILER_KEY}" "$1" 2>/dev/null; then
  echo "" >> "$1"
  echo "${TRAILER_KEY}: $SESSION_ID" >> "$1"
fi
`;
var POST_COMMIT_SCRIPT = `#!/bin/sh
${AGENTNOTE_HOOK_MARKER}
# Record agentnote entry as a git note on HEAD.
# Read session ID from the finalized commit's trailer (source of truth),
# not from the mutable session file. This eliminates TOCTOU races between
# prepare-commit-msg and post-commit.
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
SESSION_ID=$(git log -1 --format='%(trailers:key=${TRAILER_KEY},valueonly)' HEAD 2>/dev/null | tr -d '\\n')
if [ -z "$SESSION_ID" ]; then exit 0; fi
# Prefer the repo-local shim created at init time so post-commit uses the
# exact CLI version that generated these hooks.
if [ -x "$GIT_DIR/agentnote/bin/agent-note" ]; then
  "$GIT_DIR/agentnote/bin/agent-note" record "$SESSION_ID" 2>/dev/null || true
  exit 0
fi
# Fall back to stable local/global binaries only.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -f "$REPO_ROOT/node_modules/.bin/agent-note" ]; then
  "$REPO_ROOT/node_modules/.bin/agent-note" record "$SESSION_ID" 2>/dev/null || true
elif command -v agent-note >/dev/null 2>&1; then
  agent-note record "$SESSION_ID" 2>/dev/null || true
fi
`;
var PRE_PUSH_SCRIPT = `#!/bin/sh
${AGENTNOTE_HOOK_MARKER}
# Push agentnote notes alongside code via the repo-local shim so hook behavior
# tracks the current CLI implementation after upgrades. Wait for completion so
# PR workflows can fetch the latest notes ref, but never block the main push on failure.
if [ -n "$AGENTNOTE_PUSHING" ]; then exit 0; fi
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
if [ -x "$GIT_DIR/agentnote/bin/agent-note" ]; then
  "$GIT_DIR/agentnote/bin/agent-note" push-notes "$1" 2>/dev/null || true
  exit 0
fi
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -f "$REPO_ROOT/node_modules/.bin/agent-note" ]; then
  "$REPO_ROOT/node_modules/.bin/agent-note" push-notes "$1" 2>/dev/null || true
elif command -v agent-note >/dev/null 2>&1; then
  agent-note push-notes "$1" 2>/dev/null || true
fi
`;
async function init(args2) {
  let agents = [];
  try {
    agents = parseAgentArgs(args2);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
  const skipHooks = args2.includes("--no-hooks");
  const skipAction = args2.includes("--no-action");
  const skipNotes = args2.includes("--no-notes");
  const skipGitHooks = args2.includes("--no-git-hooks");
  const hooksOnly = args2.includes("--hooks");
  const actionOnly = args2.includes("--action");
  const dashboard = args2.includes("--dashboard");
  if (agents.length === 0 && !actionOnly) {
    console.error(`error: --agent is required. Available agents: ${listAgents().join(", ")}`);
    process.exit(1);
  }
  for (const agentName of agents) {
    if (!hasAgent(agentName)) {
      console.error(`error: unknown agent '${agentName}'`);
      process.exit(1);
    }
  }
  const repoRoot3 = await root();
  const results = [];
  await mkdir5(await agentnoteDir(), { recursive: true });
  if (!skipHooks && !actionOnly) {
    for (const agentName of agents) {
      const adapter = getAgent(agentName);
      if (await adapter.isEnabled(repoRoot3)) {
        results.push(`  \xB7 hooks already configured for ${adapter.name}`);
      } else {
        await adapter.installHooks(repoRoot3);
        results.push(`  \u2713 hooks added for ${adapter.name}`);
        for (const relPath of await adapter.managedPaths(repoRoot3)) {
          results.push(`    ${relPath}`);
        }
      }
    }
  }
  if (!skipGitHooks && !actionOnly) {
    await installLocalCliShim(await agentnoteDir());
    const hookDir = await resolveHookDir(repoRoot3);
    await mkdir5(hookDir, { recursive: true });
    const installed = await installGitHook(
      hookDir,
      "prepare-commit-msg",
      PREPARE_COMMIT_MSG_SCRIPT
    );
    results.push(
      installed ? "  \u2713 git hook: prepare-commit-msg" : "  \xB7 git hook: prepare-commit-msg (exists)"
    );
    const installed2 = await installGitHook(hookDir, "post-commit", POST_COMMIT_SCRIPT);
    results.push(installed2 ? "  \u2713 git hook: post-commit" : "  \xB7 git hook: post-commit (exists)");
    const installed3 = await installGitHook(hookDir, "pre-push", PRE_PUSH_SCRIPT);
    results.push(
      installed3 ? "  \u2713 git hook: pre-push (auto-push notes)" : "  \xB7 git hook: pre-push (exists)"
    );
  }
  if (!skipAction && !hooksOnly) {
    const workflowDir = join9(repoRoot3, ".github", "workflows");
    const prReportWorkflowPath = join9(workflowDir, PR_REPORT_WORKFLOW_FILENAME);
    await mkdir5(workflowDir, { recursive: true });
    if (existsSync9(prReportWorkflowPath)) {
      results.push(
        `  \xB7 workflow already exists at .github/workflows/${PR_REPORT_WORKFLOW_FILENAME}`
      );
    } else {
      await writeFile7(prReportWorkflowPath, PR_REPORT_WORKFLOW_TEMPLATE);
      results.push(`  \u2713 workflow created at .github/workflows/${PR_REPORT_WORKFLOW_FILENAME}`);
    }
    if (dashboard) {
      const dashboardWorkflowPath = join9(workflowDir, DASHBOARD_WORKFLOW_FILENAME);
      if (existsSync9(dashboardWorkflowPath)) {
        results.push(
          `  \xB7 workflow already exists at .github/workflows/${DASHBOARD_WORKFLOW_FILENAME}`
        );
      } else {
        await writeFile7(dashboardWorkflowPath, DASHBOARD_WORKFLOW_TEMPLATE);
        results.push(`  \u2713 workflow created at .github/workflows/${DASHBOARD_WORKFLOW_FILENAME}`);
      }
    }
  }
  if (!skipNotes && !hooksOnly && !actionOnly) {
    const { stdout } = await gitSafe(["config", "--get-all", "remote.origin.fetch"]);
    if (stdout.includes(NOTES_REF_FULL)) {
      results.push("  \xB7 git already configured to fetch notes");
    } else {
      await gitSafe(["config", "--add", "remote.origin.fetch", NOTES_FETCH_REFSPEC]);
      results.push("  \u2713 git configured to auto-fetch notes on pull");
    }
  }
  console.log("");
  console.log("agent-note init");
  console.log("");
  for (const line of results) {
    console.log(line);
  }
  const toCommit = [];
  if (!skipHooks && !actionOnly) {
    for (const agentName of agents) {
      const adapter = getAgent(agentName);
      toCommit.push(...await adapter.managedPaths(repoRoot3));
    }
  }
  if (!skipAction && !hooksOnly) {
    const prReportWorkflowPath = join9(
      repoRoot3,
      ".github",
      "workflows",
      PR_REPORT_WORKFLOW_FILENAME
    );
    if (existsSync9(prReportWorkflowPath)) {
      toCommit.push(`.github/workflows/${PR_REPORT_WORKFLOW_FILENAME}`);
    }
    if (dashboard) {
      const dashboardWorkflowPath = join9(
        repoRoot3,
        ".github",
        "workflows",
        DASHBOARD_WORKFLOW_FILENAME
      );
      if (existsSync9(dashboardWorkflowPath)) {
        toCommit.push(`.github/workflows/${DASHBOARD_WORKFLOW_FILENAME}`);
      }
    }
  }
  const uniqueToCommit = [...new Set(toCommit)];
  if (uniqueToCommit.length > 0) {
    console.log("");
    console.log("  Next: commit and push these files");
    console.log(`    git add ${uniqueToCommit.join(" ")}`);
    console.log('    git commit -m "chore: enable agent-note session tracking"');
    console.log("    git push");
    if (dashboard) {
      console.log("    # then enable GitHub Pages for this repository");
    }
    if (agents.includes("cursor")) {
      console.log("");
      console.log("  Cursor note");
      console.log("    With the default git hooks, plain `git commit` is tracked normally.");
      console.log(
        '    `agent-note commit -m "..."` is still useful as a fallback wrapper when git hooks are unavailable.'
      );
    }
  }
  console.log("");
}
async function resolveHookDir(repoRoot3) {
  try {
    const hooksPath = await git(["config", "--get", "core.hooksPath"]);
    if (hooksPath) return isAbsolute2(hooksPath) ? hooksPath : join9(repoRoot3, hooksPath);
  } catch {
  }
  const gitDir2 = await git(["rev-parse", "--git-dir"]);
  return join9(gitDir2, "hooks");
}
function shellSingleQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
async function installLocalCliShim(agentnoteDirPath) {
  if (!process.argv[1]) return;
  const shimDir = join9(agentnoteDirPath, "bin");
  const shimPath = join9(shimDir, "agent-note");
  const cliPath = resolve5(process.argv[1]);
  const shim = `#!/bin/sh
exec ${shellSingleQuote(process.execPath)} ${shellSingleQuote(cliPath)} "$@"
`;
  await mkdir5(shimDir, { recursive: true });
  await writeFile7(shimPath, shim);
  await chmod(shimPath, 493);
}
async function installGitHook(hookDir, name, script) {
  const hookPath = join9(hookDir, name);
  if (existsSync9(hookPath)) {
    const existing = await readFile9(hookPath, "utf-8");
    if (existing.includes(AGENTNOTE_HOOK_MARKER)) {
      const backupPath2 = `${hookPath}.agentnote-backup`;
      const target = existsSync9(backupPath2) ? script.replace(
        "#!/bin/sh",
        `#!/bin/sh
# Chain to original hook \u2014 preserve exit status.
if [ -f "${backupPath2}" ]; then "${backupPath2}" "$@" || exit $?; fi`
      ) : script;
      if (existing.trim() === target.trim()) return false;
      await writeFile7(hookPath, target);
      await chmod(hookPath, 493);
      return true;
    }
    const backupPath = `${hookPath}.agentnote-backup`;
    if (!existsSync9(backupPath)) {
      await writeFile7(backupPath, existing);
      await chmod(backupPath, 493);
    }
    const chainedScript = script.replace(
      "#!/bin/sh",
      `#!/bin/sh
# Chain to original hook \u2014 preserve exit status.
if [ -f "${backupPath}" ]; then "${backupPath}" "$@" || exit $?; fi`
    );
    await writeFile7(hookPath, chainedScript);
    await chmod(hookPath, 493);
    return true;
  }
  await writeFile7(hookPath, script);
  await chmod(hookPath, 493);
  return true;
}

// src/commands/deinit.ts
async function hasOtherEnabledAgents(repoRoot3, removingAgents) {
  const removing = new Set(removingAgents);
  for (const name of listAgents()) {
    if (removing.has(name)) continue;
    if (await getAgent(name).isEnabled(repoRoot3)) return true;
  }
  return false;
}
var GIT_HOOK_NAMES = ["prepare-commit-msg", "post-commit", "pre-push"];
async function removeGitHook(hookDir, name) {
  const hookPath = join10(hookDir, name);
  if (!existsSync10(hookPath)) return false;
  const content = await readFile10(hookPath, "utf-8");
  if (!content.includes(AGENTNOTE_HOOK_MARKER)) return false;
  const backupPath = `${hookPath}.agentnote-backup`;
  if (existsSync10(backupPath)) {
    await rename(backupPath, hookPath);
  } else {
    await unlink2(hookPath);
  }
  return true;
}
async function deinit(args2) {
  let agents = [];
  try {
    agents = parseAgentArgs(args2);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
  const removeWorkflow = args2.includes("--remove-workflow");
  const keepNotes = args2.includes("--keep-notes");
  if (agents.length === 0) {
    console.error(`error: --agent is required. Available agents: ${listAgents().join(", ")}`);
    process.exit(1);
  }
  for (const agentName of agents) {
    if (!hasAgent(agentName)) {
      console.error(`error: unknown agent '${agentName}'`);
      process.exit(1);
    }
  }
  const repoRoot3 = await root();
  const results = [];
  for (const agentName of agents) {
    const adapter = getAgent(agentName);
    await adapter.removeHooks(repoRoot3);
    results.push(`  \u2713 hooks removed for ${adapter.name}`);
  }
  const othersEnabled = await hasOtherEnabledAgents(repoRoot3, agents);
  if (!othersEnabled) {
    const hookDir = await resolveHookDir(repoRoot3);
    for (const name of GIT_HOOK_NAMES) {
      const removed = await removeGitHook(hookDir, name);
      if (removed) {
        results.push(`  \u2713 git hook: ${name} removed`);
      } else {
        results.push(`  \xB7 git hook: ${name} (not found or not managed by agentnote)`);
      }
    }
    const binDir = join10(await agentnoteDir(), "bin");
    const shimPath = join10(binDir, "agent-note");
    if (existsSync10(shimPath)) {
      await unlink2(shimPath);
      results.push("  \u2713 removed local CLI shim");
    }
    if (removeWorkflow) {
      const workflowPaths = [
        join10(repoRoot3, ".github", "workflows", PR_REPORT_WORKFLOW_FILENAME),
        join10(repoRoot3, ".github", "workflows", DASHBOARD_WORKFLOW_FILENAME)
      ];
      for (const workflowPath of workflowPaths) {
        if (!existsSync10(workflowPath)) continue;
        await unlink2(workflowPath);
        results.push(`  \u2713 removed ${workflowPath.replace(`${repoRoot3}/`, "")}`);
      }
    }
    if (!keepNotes) {
      await gitSafe([
        "config",
        "--unset",
        "--fixed-value",
        "remote.origin.fetch",
        NOTES_FETCH_REFSPEC
      ]);
      results.push("  \u2713 removed notes auto-fetch config");
    }
  } else {
    results.push("  \xB7 shared infrastructure preserved (other agents still enabled)");
  }
  console.log("");
  console.log("agent-note deinit");
  console.log("");
  for (const line of results) {
    console.log(line);
  }
  console.log("");
}

// src/commands/hook.ts
init_agents();
init_constants();
init_jsonl();
init_record();
import { randomUUID } from "node:crypto";
import { existsSync as existsSync12 } from "node:fs";
import { mkdir as mkdir6, readFile as readFile11, realpath, unlink as unlink3, writeFile as writeFile8 } from "node:fs/promises";
import { isAbsolute as isAbsolute3, join as join12, relative as relative2 } from "node:path";

// src/core/rotate.ts
init_constants();
import { existsSync as existsSync11 } from "node:fs";
import { rename as rename2 } from "node:fs/promises";
import { join as join11 } from "node:path";
async function rotateLogs(sessionDir, rotateId, fileNames = [PROMPTS_FILE, CHANGES_FILE]) {
  for (const name of fileNames) {
    const src = join11(sessionDir, name);
    if (existsSync11(src)) {
      const base = name.replace(".jsonl", "");
      await rename2(src, join11(sessionDir, `${base}-${rotateId}.jsonl`));
    }
  }
}

// src/commands/hook.ts
init_session();
init_git();
init_paths();
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSynchronousHookEvent(value) {
  if (!isRecord4(value) || typeof value.hook_event_name !== "string") return false;
  return ["PreToolUse", "beforeSubmitPrompt", "beforeShellExecution", "BeforeTool"].includes(
    value.hook_event_name
  );
}
async function normalizeToRepoRelative(filePath) {
  if (!isAbsolute3(filePath)) return filePath;
  try {
    const rawRoot = (await git(["rev-parse", "--show-toplevel"])).trim();
    const repoRoot3 = await realpath(rawRoot);
    let normalized = filePath;
    if (repoRoot3.startsWith("/private") && !normalized.startsWith("/private")) {
      normalized = `/private${normalized}`;
    } else if (!repoRoot3.startsWith("/private") && normalized.startsWith("/private")) {
      normalized = normalized.replace(/^\/private/, "");
    }
    return relative2(repoRoot3, normalized);
  } catch {
    return filePath;
  }
}
async function blobHash(absPath) {
  try {
    if (!existsSync12(absPath)) return EMPTY_BLOB;
    return (await git(["hash-object", "-w", absPath])).trim();
  } catch {
    return EMPTY_BLOB;
  }
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
async function readCurrentTurn(sessionDir) {
  const turnPath = join12(sessionDir, TURN_FILE);
  if (!existsSync12(turnPath)) return 0;
  const raw = (await readFile11(turnPath, "utf-8")).trim();
  return Number.parseInt(raw, 10) || 0;
}
async function readCurrentPromptId(sessionDir) {
  const p = join12(sessionDir, PROMPT_ID_FILE);
  if (!existsSync12(p)) return null;
  const raw = (await readFile11(p, "utf-8")).trim();
  return raw || null;
}
async function readCurrentHead() {
  try {
    return (await git(["rev-parse", "HEAD"])).trim();
  } catch {
    return null;
  }
}
async function hook(args2 = []) {
  const raw = await readStdin();
  let sync = false;
  let peek;
  try {
    peek = JSON.parse(raw);
    sync = isSynchronousHookEvent(peek);
  } catch {
    return;
  }
  const agentArgIndex = args2.indexOf("--agent");
  const agentName = agentArgIndex >= 0 && args2[agentArgIndex + 1] ? args2[agentArgIndex + 1] : null;
  if (!agentName || !hasAgent(agentName)) return;
  const adapter = getAgent(agentName);
  const input = { raw, sync };
  const event = adapter.parseEvent(input);
  if (!event) {
    const peekSid = isRecord4(peek) && typeof peek.session_id === "string" ? peek.session_id : "";
    if (peekSid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(peekSid)) {
      try {
        const dir = await agentnoteDir();
        const hbPath = join12(dir, SESSIONS_DIR, peekSid, HEARTBEAT_FILE);
        if (existsSync12(hbPath)) {
          await writeFile8(hbPath, String(Date.now()));
        }
      } catch {
      }
    }
    if (adapter.name === "gemini" && input.sync) {
      if (isRecord4(peek) && peek.hook_event_name === "BeforeTool") {
        process.stdout.write(JSON.stringify({ decision: "allow" }));
      }
    }
    return;
  }
  const agentnoteDirPath = await agentnoteDir();
  const sessionDir = join12(agentnoteDirPath, SESSIONS_DIR, event.sessionId);
  await mkdir6(sessionDir, { recursive: true });
  switch (event.kind) {
    case "session_start": {
      await writeFile8(join12(agentnoteDirPath, SESSION_FILE), event.sessionId);
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      await appendJsonl(join12(sessionDir, EVENTS_FILE), {
        event: "session_start",
        session_id: event.sessionId,
        timestamp: event.timestamp,
        agent: adapter.name,
        model: event.model ?? null
      });
      await writeFile8(join12(sessionDir, HEARTBEAT_FILE), String(Date.now()));
      break;
    }
    case "stop": {
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      const turn = await readCurrentTurn(sessionDir);
      await appendJsonl(join12(sessionDir, EVENTS_FILE), {
        event: "stop",
        session_id: event.sessionId,
        timestamp: event.timestamp,
        turn,
        response: event.response ?? null
      });
      if (adapter.name === "gemini") {
        try {
          await unlink3(join12(sessionDir, HEARTBEAT_FILE));
        } catch {
        }
      }
      break;
    }
    case "prompt": {
      await writeFile8(join12(agentnoteDirPath, SESSION_FILE), event.sessionId);
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      const eventsPath = join12(sessionDir, EVENTS_FILE);
      if (!existsSync12(eventsPath)) {
        await appendJsonl(eventsPath, {
          event: "session_start",
          session_id: event.sessionId,
          timestamp: event.timestamp,
          agent: adapter.name,
          model: event.model ?? null
        });
      }
      const rotateId = Date.now().toString(36);
      await rotateLogs(sessionDir, rotateId, [PROMPTS_FILE, CHANGES_FILE, PRE_BLOBS_FILE]);
      const turnPath = join12(sessionDir, TURN_FILE);
      let turn = await readCurrentTurn(sessionDir);
      turn += 1;
      await writeFile8(turnPath, String(turn));
      const promptId = randomUUID();
      await writeFile8(join12(sessionDir, PROMPT_ID_FILE), promptId);
      await appendJsonl(join12(sessionDir, PROMPTS_FILE), {
        event: "prompt",
        timestamp: event.timestamp,
        prompt: event.prompt,
        prompt_id: promptId,
        turn
      });
      await appendJsonl(eventsPath, {
        event: "prompt",
        session_id: event.sessionId,
        timestamp: event.timestamp,
        prompt_id: promptId,
        turn,
        model: event.model ?? null
      });
      await writeFile8(join12(sessionDir, HEARTBEAT_FILE), String(Date.now()));
      if (adapter.name === "cursor") {
        process.stdout.write(JSON.stringify({ continue: true }));
      }
      break;
    }
    case "response": {
      const turn = await readCurrentTurn(sessionDir);
      await appendJsonl(join12(sessionDir, EVENTS_FILE), {
        event: "response",
        session_id: event.sessionId,
        timestamp: event.timestamp,
        turn,
        response: event.response ?? null
      });
      break;
    }
    case "pre_edit": {
      const absPath = event.file ?? "";
      const filePath = await normalizeToRepoRelative(absPath);
      const turn = await readCurrentTurn(sessionDir);
      const promptId = await readCurrentPromptId(sessionDir);
      const preBlob = isAbsolute3(absPath) ? await blobHash(absPath) : EMPTY_BLOB;
      await appendJsonl(join12(sessionDir, PRE_BLOBS_FILE), {
        event: "pre_blob",
        turn,
        prompt_id: promptId,
        file: filePath,
        blob: preBlob,
        // tool_use_id links this pre-blob to its PostToolUse counterpart,
        // enabling correct pairing even when async hooks fire out of order.
        tool_use_id: event.toolUseId ?? null
      });
      if (adapter.name === "gemini") {
        process.stdout.write(JSON.stringify({ decision: "allow" }));
      }
      break;
    }
    case "file_change": {
      const absPath = event.file ?? "";
      const filePath = await normalizeToRepoRelative(absPath);
      const turn = await readCurrentTurn(sessionDir);
      const promptId = await readCurrentPromptId(sessionDir);
      const postBlob = isAbsolute3(absPath) ? await blobHash(absPath) : EMPTY_BLOB;
      const changeId = adapter.name === "cursor" ? `${event.timestamp}:${event.tool ?? "file_change"}:${filePath}:${postBlob}` : null;
      await appendJsonl(join12(sessionDir, CHANGES_FILE), {
        event: "file_change",
        timestamp: event.timestamp,
        tool: event.tool,
        file: filePath,
        session_id: event.sessionId,
        turn,
        prompt_id: promptId,
        blob: postBlob,
        change_id: changeId,
        edit_added: event.editStats?.added ?? null,
        edit_deleted: event.editStats?.deleted ?? null,
        // Same tool_use_id as the matching pre_blob entry — used for reliable pairing
        // even when this async hook fires after the next prompt has advanced the turn counter.
        tool_use_id: event.toolUseId ?? null
      });
      break;
    }
    case "pre_commit": {
      if (adapter.name === "gemini") {
        const headBefore = await readCurrentHead();
        await writeFile8(
          join12(sessionDir, PENDING_COMMIT_FILE),
          `${JSON.stringify(
            {
              command: event.commitCommand ?? "",
              head_before: headBefore,
              timestamp: event.timestamp
            },
            null,
            2
          )}
`
        );
        process.stdout.write(JSON.stringify({ decision: "allow" }));
        break;
      }
      if (adapter.name === "cursor") {
        const headBefore = await readCurrentHead();
        await writeFile8(
          join12(sessionDir, PENDING_COMMIT_FILE),
          `${JSON.stringify(
            {
              command: event.commitCommand ?? "",
              head_before: headBefore,
              timestamp: event.timestamp
            },
            null,
            2
          )}
`
        );
        process.stdout.write(JSON.stringify({ continue: true }));
        break;
      }
      const cmd = event.commitCommand ?? "";
      if (!cmd.includes(TRAILER_KEY) && event.sessionId) {
        const trailer = `--trailer '${TRAILER_KEY}: ${event.sessionId}'`;
        const updatedCmd = cmd.replace(/(git\s+commit)/, `$1 ${trailer}`);
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              updatedInput: {
                command: updatedCmd
              }
            }
          })
        );
      }
      break;
    }
    case "post_commit": {
      if (adapter.name === "cursor" || adapter.name === "gemini") {
        const pendingPath = join12(sessionDir, PENDING_COMMIT_FILE);
        if (!existsSync12(pendingPath)) break;
        let headBefore = null;
        try {
          const pending = JSON.parse(await readFile11(pendingPath, "utf-8"));
          headBefore = pending.head_before?.trim() || null;
        } catch {
          headBefore = null;
        }
        const headAfter = await readCurrentHead();
        try {
          await unlink3(pendingPath);
        } catch {
        }
        if (!headAfter || headAfter === headBefore) break;
      }
      try {
        await recordCommitEntry({
          agentnoteDirPath,
          sessionId: event.sessionId,
          transcriptPath: event.transcriptPath
        });
      } catch {
      }
      break;
    }
  }
}

// src/commands/log.ts
init_constants();
init_storage();
init_git();

// src/commands/normalize.ts
function isStructuredEntry(raw) {
  if (!raw || typeof raw !== "object") return false;
  const entry = raw;
  return Array.isArray(entry.interactions) && Array.isArray(entry.files) && !!entry.attribution;
}
function normalizeEntry(raw) {
  if (!isStructuredEntry(raw)) {
    throw new Error("unsupported agent-note entry format");
  }
  return raw;
}

// src/commands/log.ts
async function log(count = 10) {
  const raw = await git([
    "log",
    `-${count}`,
    `--format=%H	%h %s	%(trailers:key=${TRAILER_KEY},valueonly)`
  ]);
  if (!raw) {
    console.log("no commits found");
    return;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("	");
    const fullSha = parts[0];
    const commitPart = parts[1];
    const trailerSessionId = parts[2]?.trim();
    if (!fullSha || !commitPart) continue;
    let ratioStr = "";
    let promptCount = "";
    let sid = trailerSessionId;
    const note = await readNote(fullSha);
    if (note) {
      const entry = normalizeEntry(note);
      sid = sid || entry.session_id;
      ratioStr = `${entry.attribution.ai_ratio}%`;
      promptCount = `${entry.interactions?.length ?? 0}p`;
    }
    if (!sid) {
      console.log(commitPart);
      continue;
    }
    if (ratioStr) {
      console.log(`${commitPart}  [${sid.slice(0, 8)}\u2026 | \u{1F916}${ratioStr} | ${promptCount}]`);
    } else {
      console.log(`${commitPart}  [${sid.slice(0, 8)}\u2026]`);
    }
  }
}

// ../pr-report/src/github.ts
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
var COMMENT_MARKER = "<!-- agentnote-pr-report -->";
var DESCRIPTION_BEGIN = "<!-- agentnote-begin -->";
var DESCRIPTION_END = "<!-- agentnote-end -->";
var execFileAsync2 = promisify2(execFile2);
function upsertDescription(existingBody, markdown) {
  const section = `${DESCRIPTION_BEGIN}
${markdown}
${DESCRIPTION_END}`;
  if (existingBody.includes(DESCRIPTION_BEGIN)) {
    const before = existingBody.slice(
      0,
      existingBody.indexOf(DESCRIPTION_BEGIN)
    );
    const after = existingBody.includes(DESCRIPTION_END) ? existingBody.slice(
      existingBody.indexOf(DESCRIPTION_END) + DESCRIPTION_END.length
    ) : "";
    return `${before.trimEnd()}

${section}${after}`;
  }
  return `${existingBody.trimEnd()}

${section}`;
}
function inferDashboardUrl(repoUrl) {
  if (!repoUrl) return null;
  const normalized = repoUrl.replace(/\.git$/, "");
  const match = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const [, owner, repo] = match;
  const pagesRoot = `https://${owner}.github.io`;
  if (repo === `${owner}.github.io`) {
    return `${pagesRoot}/dashboard/`;
  }
  return `${pagesRoot}/${repo}/dashboard/`;
}
async function updatePrDescription(prNumber, markdown) {
  const currentBody = await readPrBody(prNumber);
  const newBody = upsertDescription(currentBody, markdown);
  await execFileAsync2("gh", ["pr", "edit", prNumber, "--body", newBody], {
    encoding: "utf-8"
  });
}
async function postPrComment(prNumber, content) {
  const body = `${COMMENT_MARKER}
${content}`;
  try {
    const { stdout } = await execFileAsync2(
      "gh",
      [
        "pr",
        "view",
        prNumber,
        "--json",
        "comments",
        "--jq",
        `.comments[] | select(.body | contains("${COMMENT_MARKER}")) | .id`
      ],
      { encoding: "utf-8" }
    );
    const commentId = stdout.trim().split("\n")[0];
    if (commentId) {
      await execFileAsync2(
        "gh",
        [
          "api",
          "-X",
          "PATCH",
          `/repos/{owner}/{repo}/issues/comments/${commentId}`,
          "-f",
          `body=${body}`
        ],
        { encoding: "utf-8" }
      );
      return;
    }
  } catch {
  }
  await execFileAsync2("gh", ["pr", "comment", prNumber, "--body", body], {
    encoding: "utf-8"
  });
}
async function readPrBody(prNumber) {
  const { stdout } = await execFileAsync2(
    "gh",
    ["pr", "view", prNumber, "--json", "body"],
    { encoding: "utf-8" }
  );
  return JSON.parse(stdout).body ?? "";
}

// ../pr-report/src/report.ts
init_constants();
init_entry();
init_storage();
init_git();
import { existsSync as existsSync13 } from "node:fs";
import { join as join13 } from "node:path";
async function collectReport(base, headRef = "HEAD") {
  const head = await git(["rev-parse", "--short", headRef]);
  const raw = await git(["log", "--reverse", "--format=%H	%h	%s", `${base}..${headRef}`]);
  if (!raw.trim()) return null;
  const commits = [];
  for (const line of raw.trim().split("\n")) {
    const [sha, short, ...msgParts] = line.split("	");
    const message = msgParts.join("	");
    const note = await readNote(sha);
    if (!note) {
      commits.push({
        sha,
        short,
        message,
        session_id: null,
        model: null,
        ai_ratio: null,
        attribution_method: null,
        prompts_count: 0,
        files_total: 0,
        files_ai: 0,
        files: [],
        interactions: [],
        attribution: null
      });
      continue;
    }
    const entry = normalizeEntry(note);
    const eligibleCounts = countAiRatioEligibleFiles(entry.files);
    commits.push({
      sha,
      short,
      message,
      session_id: entry.session_id ?? null,
      model: entry.model ?? null,
      ai_ratio: entry.attribution.ai_ratio,
      attribution_method: entry.attribution.method,
      prompts_count: entry.interactions.length,
      files_total: eligibleCounts.total,
      files_ai: eligibleCounts.ai,
      files: entry.files,
      interactions: entry.interactions,
      attribution: entry.attribution
    });
  }
  const tracked = commits.filter((commit2) => commit2.session_id !== null);
  const totalFiles = tracked.reduce((sum, commit2) => sum + commit2.files_total, 0);
  const totalFilesAi = tracked.reduce((sum, commit2) => sum + commit2.files_ai, 0);
  const lineEligible = tracked.filter(
    (commit2) => commit2.attribution?.method === "line" && commit2.attribution.lines && commit2.attribution.lines.total_added > 0
  );
  const fileOnly = tracked.filter((commit2) => commit2.attribution?.method === "file");
  const excluded = tracked.filter((commit2) => commit2.attribution?.method === "none");
  const eligible = [...lineEligible, ...fileOnly];
  let overallMethod;
  if (tracked.length > 0 && excluded.length === tracked.length) {
    overallMethod = "none";
  } else if (eligible.length === 0) {
    overallMethod = "none";
  } else if (fileOnly.length === 0 && lineEligible.length > 0) {
    overallMethod = "line";
  } else if (lineEligible.length === 0) {
    overallMethod = "file";
  } else {
    overallMethod = "mixed";
  }
  let overallAiRatio;
  if (overallMethod === "line") {
    const aiAdded = lineEligible.reduce(
      (sum, commit2) => sum + (commit2.attribution?.lines?.ai_added ?? 0),
      0
    );
    const totalAdded = lineEligible.reduce(
      (sum, commit2) => sum + (commit2.attribution?.lines?.total_added ?? 0),
      0
    );
    overallAiRatio = totalAdded > 0 ? Math.round(aiAdded / totalAdded * 100) : 0;
  } else if (overallMethod === "file") {
    const eligibleFiles = eligible.reduce((sum, commit2) => sum + commit2.files_total, 0);
    const eligibleFilesAi = eligible.reduce((sum, commit2) => sum + commit2.files_ai, 0);
    overallAiRatio = eligibleFiles > 0 ? Math.round(eligibleFilesAi / eligibleFiles * 100) : 0;
  } else if (overallMethod === "mixed") {
    const weightedSum = eligible.reduce(
      (sum, commit2) => sum + (commit2.ai_ratio ?? 0) * commit2.files_total,
      0
    );
    const weightTotal = eligible.reduce((sum, commit2) => sum + commit2.files_total, 0);
    overallAiRatio = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  } else {
    overallAiRatio = 0;
  }
  let repoUrl = null;
  try {
    const remoteUrl = await git(["remote", "get-url", "origin"]);
    repoUrl = remoteUrl.replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/").replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
  } catch {
    repoUrl = null;
  }
  const repoRoot3 = await git(["rev-parse", "--show-toplevel"]);
  const hasDashboardWorkflow = existsSync13(
    join13(repoRoot3, ".github", "workflows", "agentnote-dashboard.yml")
  );
  const dashboardUrl = hasDashboardWorkflow ? inferDashboardUrl(repoUrl) : null;
  return {
    base,
    head,
    repo_url: repoUrl,
    dashboard_url: dashboardUrl,
    total_commits: commits.length,
    tracked_commits: tracked.length,
    total_prompts: tracked.reduce((sum, commit2) => sum + commit2.prompts_count, 0),
    total_files: totalFiles,
    total_files_ai: totalFilesAi,
    overall_ai_ratio: overallAiRatio,
    overall_method: overallMethod,
    model: tracked.find((commit2) => commit2.model)?.model ?? null,
    commits
  };
}
function renderProgressBar(ratio, width = 8) {
  const filled = Math.round(ratio / 100 * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}
function renderRatioWithBar(ratio, width) {
  return `${renderProgressBar(ratio, width)} ${ratio}%`;
}
function renderHeader(report) {
  const line1 = `**Total AI Ratio:** ${renderRatioWithBar(report.overall_ai_ratio, 8)}`;
  const lines = [line1];
  if (report.model) {
    lines.push(`**Model:** \`${report.model}\``);
  }
  return lines;
}
function renderMarkdown(report) {
  const lines = [];
  lines.push("## \u{1F9D1}\u{1F4AC}\u{1F916} Agent Note");
  lines.push("");
  lines.push(...renderHeader(report));
  lines.push("");
  lines.push("| Commit | AI Ratio | Prompts | Files |");
  lines.push("|---|---|---|---|");
  for (const commit2 of report.commits) {
    const link = commitLink(commit2, report.repo_url);
    const commitCell = escapeTableCell(`${link} ${commit2.message}`);
    if (commit2.ai_ratio === null) {
      lines.push(`| ${commitCell} | \u2014 | \u2014 | \u2014 |`);
      continue;
    }
    const fileList = escapeTableCell(
      commit2.files.map((file) => `${basename(file.path)} ${file.by_ai ? "\u{1F916}" : "\u{1F464}"}`).join(", ")
    );
    const aiRatioCell = renderRatioWithBar(commit2.ai_ratio, 5);
    lines.push(
      `| ${commitCell} | ${aiRatioCell} | ${commit2.prompts_count} | ${fileList} |`
    );
  }
  lines.push("");
  if (report.dashboard_url) {
    lines.push(
      `<div align="right"><a href="${report.dashboard_url}">Open Dashboard \u2197</a></div>`
    );
    if (report.dashboard_preview_help_url) {
      lines.push(
        `<div align="right"><sub><a href="${report.dashboard_preview_help_url}">About PR previews</a></sub></div>`
      );
    }
    lines.push("");
  }
  const withPrompts = report.commits.filter((commit2) => commit2.interactions.length > 0);
  if (withPrompts.length > 0) {
    lines.push("<details>");
    lines.push(`<summary>\u{1F4AC} Prompts & Responses (${report.total_prompts} total)</summary>`);
    lines.push("");
    for (const commit2 of withPrompts) {
      lines.push(`### ${commitLink(commit2, report.repo_url)} ${commit2.message}`);
      lines.push("");
      for (const { prompt, response } of commit2.interactions) {
        const cleaned = cleanPrompt(prompt, TRUNCATE_PROMPT_PR);
        lines.push(`> **\u{1F9D1} Prompt:** ${cleaned.split("\n").join("\n> ")}`);
        if (response) {
          const truncated = response.length > TRUNCATE_RESPONSE_PR ? `${response.slice(0, TRUNCATE_RESPONSE_PR)}\u2026` : response;
          lines.push(">");
          lines.push(`> **\u{1F916} Response:** ${truncated.split("\n").join("\n> ")}`);
        }
        lines.push("");
      }
    }
    lines.push("</details>");
  }
  return lines.join("\n");
}
async function detectBaseBranch() {
  for (const name of ["main", "master", "develop"]) {
    const { exitCode } = await gitSafe(["rev-parse", "--verify", `origin/${name}`]);
    if (exitCode === 0) return `origin/${name}`;
  }
  return null;
}
function commitLink(commit2, repoUrl) {
  if (repoUrl) {
    return `[\`${commit2.short}\`](${repoUrl}/commit/${commit2.sha})`;
  }
  return `\`${commit2.short}\``;
}
function escapeTableCell(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
function cleanPrompt(prompt, maxLen) {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return "";
  const lines = trimmed.split("\n");
  const firstLine = lines[0] ?? "";
  let body = trimmed;
  if (firstLine.startsWith("## ") || firstLine.startsWith("# ")) {
    const userStart = lines.findIndex(
      (line, index) => index > 0 && !line.startsWith("#") && !line.startsWith("```") && line.trim().length > 10
    );
    if (userStart !== -1) {
      body = lines.slice(userStart).join("\n").trim();
    } else {
      body = firstLine.replace(/^#+\s*/, "");
    }
  }
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen)}\u2026`;
}
function basename(path) {
  return path.split("/").pop() ?? path;
}

// src/commands/pr.ts
async function pr(args2) {
  const isJson = args2.includes("--json");
  const outputIdx = args2.indexOf("--output");
  const updateIdx = args2.indexOf("--update");
  const headIdx = args2.indexOf("--head");
  const prNumber = updateIdx !== -1 ? args2[updateIdx + 1] : null;
  const headRef = headIdx !== -1 ? args2[headIdx + 1] : "HEAD";
  const positional = args2.filter(
    (arg, index) => !arg.startsWith("--") && (outputIdx === -1 || index !== outputIdx + 1) && (updateIdx === -1 || index !== updateIdx + 1) && (headIdx === -1 || index !== headIdx + 1)
  );
  const base = positional[0] ?? await detectBaseBranch();
  if (!base) {
    console.error("error: could not detect base branch. pass it as argument: agent-note pr <base>");
    process.exit(1);
  }
  const outputMode = outputIdx !== -1 ? args2[outputIdx + 1] : "description";
  const report = await collectReport(base, headRef);
  if (!report) {
    if (isJson) {
      console.log(JSON.stringify({ error: "no commits found" }));
    } else {
      console.log(`no commits found between HEAD and ${base}`);
    }
    return;
  }
  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const rendered = renderMarkdown(report);
  if (!prNumber) {
    console.log(rendered);
    return;
  }
  if (outputMode === "description") {
    await updatePrDescription(prNumber, rendered);
    console.log(`agent-note: PR #${prNumber} description updated`);
    return;
  }
  await postPrComment(prNumber, rendered);
  console.log(`agent-note: PR #${prNumber} comment posted`);
}

// src/commands/push-notes.ts
init_git();
import { execFileSync as execFileSync2 } from "node:child_process";
var NOTES_PUSH_TIMEOUT_MS = 1e4;
async function pushNotes(args2) {
  const remote = args2[0]?.trim() || "origin";
  const { exitCode } = await gitSafe(["rev-parse", "--verify", "refs/notes/agentnote"]);
  if (exitCode !== 0) return;
  try {
    execFileSync2("git", ["push", remote, "refs/notes/agentnote"], {
      stdio: "ignore",
      timeout: NOTES_PUSH_TIMEOUT_MS,
      env: {
        ...process.env,
        AGENTNOTE_PUSHING: "1",
        GIT_TERMINAL_PROMPT: "0"
      }
    });
  } catch {
  }
}

// src/commands/session.ts
init_constants();
init_entry();
init_storage();
init_git();
async function session(sessionId) {
  if (!sessionId) {
    console.error("usage: agent-note session <session-id>");
    process.exit(1);
  }
  const raw = await git([
    "log",
    "--all",
    `--max-count=${MAX_COMMITS}`,
    `--format=%H	%h %s	%(trailers:key=${TRAILER_KEY},valueonly)`
  ]);
  if (!raw) {
    console.log("no commits found");
    return;
  }
  const matches = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("	");
    const fullSha = parts[0];
    const shortInfo = parts[1];
    const trailer = parts[2]?.trim();
    if (!fullSha || !shortInfo) continue;
    if (trailer === sessionId) {
      const note = await readNote(fullSha);
      const entry = note ? normalizeEntry(note) : null;
      matches.push({ sha: fullSha, shortInfo, entry });
      continue;
    }
    if (!trailer) {
      const note = await readNote(fullSha);
      if (note && note.session_id === sessionId) {
        const entry = normalizeEntry(note);
        matches.push({ sha: fullSha, shortInfo, entry });
      }
    }
  }
  if (matches.length === 0) {
    console.log(`no commits found for session ${sessionId}`);
    return;
  }
  matches.reverse();
  console.log(`Session: ${sessionId}`);
  console.log(`Commits: ${matches.length}`);
  console.log();
  let totalPrompts = 0;
  let lineAiAdded = 0;
  let lineTotalAdded = 0;
  let lineCount = 0;
  let fileFilesAi = 0;
  let fileFilesTotal = 0;
  let fileCount = 0;
  for (const m of matches) {
    let suffix = "";
    if (m.entry) {
      const promptCount = m.entry.interactions?.length ?? 0;
      totalPrompts += promptCount;
      const attr = m.entry.attribution;
      if (attr.method === "line" && attr.lines && attr.lines.total_added > 0) {
        lineAiAdded += attr.lines.ai_added;
        lineTotalAdded += attr.lines.total_added;
        lineCount++;
      } else if (attr.method === "file") {
        const eligibleCounts = countAiRatioEligibleFiles(m.entry.files);
        fileFilesAi += eligibleCounts.ai;
        fileFilesTotal += eligibleCounts.total;
        fileCount++;
      }
      suffix = `  [\u{1F916}${attr.ai_ratio}% | ${promptCount}p]`;
    }
    console.log(`${m.shortInfo}${suffix}`);
  }
  console.log();
  let _overallMethod;
  let overallRatio = null;
  let lineDetail = "";
  if (lineCount > 0 && fileCount === 0) {
    _overallMethod = "line";
    overallRatio = lineTotalAdded > 0 ? Math.round(lineAiAdded / lineTotalAdded * 100) : 0;
    lineDetail = ` (${lineAiAdded}/${lineTotalAdded} lines)`;
  } else if (lineCount === 0 && fileCount > 0) {
    _overallMethod = "file";
    overallRatio = fileFilesTotal > 0 ? Math.round(fileFilesAi / fileFilesTotal * 100) : 0;
  } else if (lineCount > 0 && fileCount > 0) {
    _overallMethod = "mixed";
    let weightedSum = 0;
    let weightTotal = 0;
    for (const m of matches) {
      if (!m.entry) continue;
      const attr = m.entry.attribution;
      const isLineEligible = attr.method === "line" && attr.lines && attr.lines.total_added > 0;
      const isFileEligible = attr.method === "file";
      if (isLineEligible || isFileEligible) {
        const eligibleCounts = countAiRatioEligibleFiles(m.entry.files);
        weightedSum += attr.ai_ratio * eligibleCounts.total;
        weightTotal += eligibleCounts.total;
      }
    }
    overallRatio = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  } else {
    _overallMethod = "none";
  }
  if (overallRatio !== null) {
    console.log(`Total: ${totalPrompts} prompts, AI ratio ${overallRatio}%${lineDetail}`);
  } else if (totalPrompts > 0) {
    console.log(`Total: ${totalPrompts} prompts`);
  }
}

// src/commands/show.ts
init_agents();
init_constants();
init_session();
init_storage();
init_git();
init_paths();
import { stat } from "node:fs/promises";
import { join as join14 } from "node:path";
var COMMIT_REF_PATTERN = /^(HEAD|[0-9a-f]{7,40})$/i;
async function show(commitRef) {
  if (commitRef && !COMMIT_REF_PATTERN.test(commitRef)) {
    console.error("usage: agent-note show [commit]");
    console.error("commit must be HEAD or a 7-40 character commit SHA");
    process.exit(1);
  }
  const ref = commitRef ?? "HEAD";
  const commitInfo = await git(["log", "-1", "--format=%h %s", ref]);
  const commitSha = await git(["log", "-1", "--format=%H", ref]);
  console.log(`commit:  ${commitInfo}`);
  const raw = await readNote(commitSha);
  const trailerSessionId = (await git(["log", "-1", `--format=%(trailers:key=${TRAILER_KEY},valueonly)`, ref])).trim();
  if (!raw && !trailerSessionId) {
    console.log("session: none (no agent-note data)");
    return;
  }
  if (!raw) {
    console.log(`session: ${trailerSessionId}`);
    console.log("entry:   no agent-note note found for this commit");
    return;
  }
  const entry = normalizeEntry(raw);
  const sessionId = trailerSessionId || entry.session_id;
  if (!sessionId) {
    console.log("session: none (no agent-note data)");
    return;
  }
  console.log(`session: ${sessionId}`);
  console.log();
  const ratioBar = renderRatioBar(entry.attribution.ai_ratio);
  const lineDetail = entry.attribution.method === "line" && entry.attribution.lines ? ` (${entry.attribution.lines.ai_added}/${entry.attribution.lines.total_added} lines)` : "";
  console.log(`ai:      ${entry.attribution.ai_ratio}%${lineDetail} ${ratioBar}`);
  if (entry.model) {
    console.log(`model:   ${entry.model}`);
  }
  if (entry.agent) {
    console.log(`agent:   ${entry.agent}`);
  }
  const aiCount = entry.files.filter((f) => f.by_ai).length;
  console.log(`files:   ${entry.files.length} changed, ${aiCount} by AI`);
  if (entry.files.length > 0) {
    console.log();
    for (const file of entry.files) {
      const marker = file.by_ai ? "  \u{1F916}" : "  \u{1F464}";
      console.log(`  ${file.path}${marker}`);
    }
  }
  if (entry.interactions.length > 0) {
    console.log();
    console.log(`prompts: ${entry.interactions.length}`);
    for (let i = 0; i < entry.interactions.length; i++) {
      const interaction = entry.interactions[i];
      console.log();
      console.log(`  ${i + 1}. ${truncateLines(interaction.prompt, TRUNCATE_PROMPT)}`);
      if (interaction.response) {
        console.log(`     \u2192 ${truncateLines(interaction.response, TRUNCATE_RESPONSE_SHOW)}`);
      }
      if (interaction.files_touched && interaction.files_touched.length > 0) {
        for (const file of interaction.files_touched) {
          console.log(`     \u{1F4C4} ${file}`);
        }
      }
    }
  }
  const sessionDir = join14(await agentnoteDir(), SESSIONS_DIR, sessionId);
  const sessionAgent = await readSessionAgent(sessionDir) ?? entry.agent ?? "claude";
  const adapter = hasAgent(sessionAgent) ? getAgent(sessionAgent) : getAgent("claude");
  const transcriptPath = await readSessionTranscriptPath(sessionDir) ?? adapter.findTranscript(sessionId);
  if (transcriptPath) {
    console.log();
    const stats = await stat(transcriptPath);
    const sizeKb = (stats.size / 1024).toFixed(1);
    console.log(`transcript: ${transcriptPath} (${sizeKb} KB)`);
  }
}
function renderRatioBar(ratio) {
  const width = BAR_WIDTH_FULL;
  const filled = Math.round(ratio / 100 * width);
  const empty = width - filled;
  return `[${"\u2588".repeat(filled)}${"\u2591".repeat(empty)}]`;
}
function truncateLines(text, maxLen) {
  const firstLine = text.split("\n")[0];
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, maxLen)}\u2026`;
}

// src/commands/status.ts
init_agents();
init_constants();
init_session();
init_storage();
init_git();
init_paths();
import { existsSync as existsSync14 } from "node:fs";
import { readFile as readFile12 } from "node:fs/promises";
import { isAbsolute as isAbsolute4, join as join15 } from "node:path";
var VERSION = "0.2.2";
async function status() {
  console.log(`agent-note v${VERSION}`);
  console.log();
  const repoRoot3 = await root();
  const enabledAgents = [];
  for (const agentName of listAgents()) {
    if (await getAgent(agentName).isEnabled(repoRoot3)) {
      enabledAgents.push(agentName);
    }
  }
  if (enabledAgents.length > 0) {
    console.log(`agent:   active (${enabledAgents.join(", ")})`);
  } else {
    console.log("agent:   not configured (run 'agent-note init')");
  }
  const captureDetails = await readAgentCaptureDetails(repoRoot3, enabledAgents);
  if (captureDetails.length > 0) {
    console.log(`capture: ${captureDetails.join("; ")}`);
  }
  const activeGitHooks = await readManagedGitHooks(repoRoot3);
  if (activeGitHooks.length > 0) {
    console.log(`git:     active (${activeGitHooks.join(", ")})`);
    console.log("commit:  tracked via git hooks");
  } else if (enabledAgents.includes("cursor")) {
    console.log("git:     not configured");
    console.log(
      "commit:  fallback mode (`agent-note commit` recommended; Cursor shell hooks may still attach notes)"
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
  if (existsSync14(sessionPath)) {
    const sid = (await readFile12(sessionPath, "utf-8")).trim();
    if (sid) {
      const dir = await agentnoteDir();
      const sessionDir = join15(dir, "sessions", sid);
      const hbPath = join15(sessionDir, HEARTBEAT_FILE);
      if (existsSync14(hbPath)) {
        try {
          const hb = Number.parseInt((await readFile12(hbPath, "utf-8")).trim(), 10);
          const ageSeconds = Math.floor(Date.now() / 1e3) - Math.floor(hb / 1e3);
          if (hb > 0 && ageSeconds <= 3600) {
            sessionActive = true;
            console.log(`session: ${sid.slice(0, 8)}\u2026`);
            const agent = await readSessionAgent(sessionDir);
            if (agent) {
              console.log(`agent:   ${agent}`);
            }
          }
        } catch {
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
    `--format=%H	%(trailers:key=${TRAILER_KEY},valueonly)`
  ]);
  let linked = 0;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const [sha, trailer] = line.split("	");
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
async function readAgentCaptureDetails(repoRoot3, enabledAgents) {
  const details = [];
  if (enabledAgents.includes("codex")) {
    const codexCapabilities = await readCodexCaptureCapabilities(repoRoot3);
    if (codexCapabilities.length > 0) {
      details.push(`codex(${codexCapabilities.join(", ")})`);
    }
  }
  if (enabledAgents.includes("cursor")) {
    const cursorCapabilities = await readCursorCaptureCapabilities(repoRoot3);
    if (cursorCapabilities.length > 0) {
      details.push(`cursor(${cursorCapabilities.join(", ")})`);
    }
  }
  if (enabledAgents.includes("gemini")) {
    const geminiCapabilities = await readGeminiCaptureCapabilities(repoRoot3);
    if (geminiCapabilities.length > 0) {
      details.push(`gemini(${geminiCapabilities.join(", ")})`);
    }
  }
  return details;
}
async function readCodexCaptureCapabilities(repoRoot3) {
  const hooksPath = join15(repoRoot3, ".codex", "hooks.json");
  if (!existsSync14(hooksPath)) return [];
  try {
    const content = await readFile12(hooksPath, "utf-8");
    const parsed = JSON.parse(content);
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName) => (hooks[eventName] ?? []).some(
      (group) => (group.hooks ?? []).some((hook2) => hook2.command?.includes("agent-note hook"))
    );
    const capabilities = [];
    if (hasAgentnoteHook("UserPromptSubmit")) capabilities.push("prompt");
    if (hasAgentnoteHook("Stop")) capabilities.push("response");
    if (hasAgentnoteHook("SessionStart")) capabilities.push("transcript");
    return capabilities;
  } catch {
    return [];
  }
}
async function readCursorCaptureCapabilities(repoRoot3) {
  const hooksPath = join15(repoRoot3, ".cursor", "hooks.json");
  if (!existsSync14(hooksPath)) return [];
  try {
    const content = await readFile12(hooksPath, "utf-8");
    const parsed = JSON.parse(content);
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName) => (hooks[eventName] ?? []).some((entry) => entry.command?.includes("agent-note hook"));
    const capabilities = [];
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
async function readGeminiCaptureCapabilities(repoRoot3) {
  const settingsPath = join15(repoRoot3, ".gemini", "settings.json");
  if (!existsSync14(settingsPath)) return [];
  try {
    const content = await readFile12(settingsPath, "utf-8");
    const parsed = JSON.parse(content);
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName) => (hooks[eventName] ?? []).some(
      (group) => (group.hooks ?? []).some((h) => h.command?.includes("agent-note hook"))
    );
    const capabilities = [];
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
async function readManagedGitHooks(repoRoot3) {
  const hookDir = await resolveHookDir2(repoRoot3);
  const active = [];
  for (const name of ["prepare-commit-msg", "post-commit", "pre-push"]) {
    const hookPath = join15(hookDir, name);
    if (!existsSync14(hookPath)) continue;
    try {
      const content = await readFile12(hookPath, "utf-8");
      if (content.includes(AGENTNOTE_HOOK_MARKER)) {
        active.push(name);
      }
    } catch {
    }
  }
  return active;
}
async function resolveHookDir2(repoRoot3) {
  const hooksPathConfig = (await gitSafe(["config", "--get", "core.hooksPath"])).stdout.trim();
  if (hooksPathConfig) {
    return isAbsolute4(hooksPathConfig) ? hooksPathConfig : join15(repoRoot3, hooksPathConfig);
  }
  const gitDir2 = (await gitSafe(["rev-parse", "--git-dir"])).stdout.trim();
  const resolvedGitDir = isAbsolute4(gitDir2) ? gitDir2 : join15(repoRoot3, gitDir2);
  return join15(resolvedGitDir, "hooks");
}

// src/cli.ts
var VERSION2 = "0.2.2";
var HELP = `
agent-note v${VERSION2} \u2014 remember why your code changed

usage:
  agent-note init --agent <name...> set up hooks, workflows, and notes auto-fetch (agents: claude, codex, cursor, gemini)
                                    [--dashboard] [--no-hooks] [--no-action] [--no-notes] [--no-git-hooks] [--hooks] [--action]
  agent-note deinit --agent <name...>
                                    remove hooks and config [--remove-workflow] [--keep-notes]
  agent-note show [commit]          show session details for a commit
  agent-note log [n]                list recent commits with session info
  agent-note pr [base] [--json] [--head <ref>] [--update <PR#>] [--output description|comment]
                                    generate PR report or update PR description/comment
  agent-note session <id>           show commits for a session
  agent-note commit [args]          git commit with session tracking
  agent-note status                 show current tracking state
  agent-note version                print version
  agent-note help                   show this help
`.trim();
var command = process.argv[2];
var args = process.argv.slice(3);
switch (command) {
  case "init":
    await init(args);
    break;
  case "deinit":
    await deinit(args);
    break;
  case "commit":
    await commit(args);
    break;
  case "show":
    await show(args[0]);
    break;
  case "log":
    await log(args[0] ? parseInt(args[0], 10) : 10);
    break;
  case "pr":
    await pr(args);
    break;
  case "status":
    await status();
    break;
  case "session":
    await session(args[0]);
    break;
  case "hook":
    await hook(args);
    break;
  case "record": {
    const sid = args[0];
    if (sid) {
      try {
        const { recordCommitEntry: recordCommitEntry2 } = await Promise.resolve().then(() => (init_record(), record_exports));
        const { agentnoteDir: agentnoteDir2 } = await Promise.resolve().then(() => (init_paths(), paths_exports));
        const dir = await agentnoteDir2();
        await recordCommitEntry2({ agentnoteDirPath: dir, sessionId: sid });
      } catch {
      }
    }
    break;
  }
  case "push-notes":
    await pushNotes(args);
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(`agent-note v${VERSION2}`);
    break;
  case "help":
  case "--help":
  case "-h":
  case void 0:
    console.log(HELP);
    break;
  default:
    console.error(`unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
}
