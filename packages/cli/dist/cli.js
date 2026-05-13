#!/usr/bin/env node

// src/commands/commit.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync9 } from "node:fs";
import { readFile as readFile9 } from "node:fs/promises";
import { join as join9 } from "node:path";

// src/core/constants.ts
var TRAILER_KEY = "Agentnote-Session";
var AGENTNOTE_HOOK_MARKER = "# agentnote-managed";
var AGENTNOTE_IGNORE_FILE = ".agentnoteignore";
var AGENTNOTE_HOOK_COMMAND = "agent-note hook";
var CLI_JS_HOOK_COMMAND = "cli.js hook";
var NOTES_REF = "agentnote";
var NOTES_REF_FULL = `refs/notes/${NOTES_REF}`;
var NOTES_FETCH_REFSPEC = `+${NOTES_REF_FULL}:${NOTES_REF_FULL}`;
var AGENTNOTE_DIR = "agentnote";
var SESSIONS_DIR = "sessions";
var GIT_HOOK_NAMES = ["prepare-commit-msg", "post-commit", "pre-push"];
var PROMPTS_FILE = "prompts.jsonl";
var CHANGES_FILE = "changes.jsonl";
var EVENTS_FILE = "events.jsonl";
var TRANSCRIPT_PATH_FILE = "transcript_path";
var TURN_FILE = "turn";
var PROMPT_ID_FILE = "prompt_id";
var SESSION_FILE = "session";
var SESSION_AGENT_FILE = "agent";
var PENDING_COMMIT_FILE = "pending_commit.json";
var POST_COMMIT_FALLBACK_FILE = "post_commit_fallback";
var POST_COMMIT_FALLBACK_HEAD = "head";
var MAX_COMMITS = 500;
var RECENT_STATUS_COMMIT_LIMIT = 20;
var DEFAULT_LOG_COUNT = 10;
var BAR_WIDTH_FULL = 20;
var TRUNCATE_PROMPT = 120;
var TRUNCATE_PROMPT_PR = 500;
var TRUNCATE_RESPONSE_SHOW = 200;
var TRUNCATE_RESPONSE_PR = 500;
var ARCHIVE_ID_RE = /^[0-9a-z]{6,}$/;
var HEARTBEAT_FILE = "heartbeat";
var HEARTBEAT_TTL_SECONDS = 60 * 60;
var MILLISECONDS_PER_SECOND = 1e3;
var PRE_BLOBS_FILE = "pre_blobs.jsonl";
var COMMITTED_PAIRS_FILE = "committed_pairs.jsonl";
var RECORDABLE_SESSION_FILES = [PROMPTS_FILE, CHANGES_FILE, PRE_BLOBS_FILE];
var TRAILER_SESSION_FILES = [CHANGES_FILE, PRE_BLOBS_FILE];
var EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
var SCHEMA_VERSION = 1;
var TEXT_ENCODING = "utf-8";

// src/core/record.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync7 } from "node:fs";
import { readdir, readFile as readFile7, unlink, writeFile as writeFile6 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join6 } from "node:path";

// src/agents/claude.ts
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

// src/git.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var GIT_BINARY = "git";
var GIT_COMMAND_COMMIT = "commit";
var GIT_COMMAND_ENV = "env";
var GIT_COMMAND_WRAPPER = "command";
var GIT_AMEND_FLAG = "--amend";
var GIT_END_OF_OPTIONS = "--";
var SHELL_AND_OPERATOR = "&";
var SHELL_PIPE_OPERATOR = "|";
var SHELL_SEMICOLON_OPERATOR = ";";
var SHELL_NEWLINE = "\n";
var SHELL_ESCAPE = "\\";
var SHELL_COMMENT = "#";
var SHELL_SINGLE_QUOTE = "'";
var SHELL_DOUBLE_QUOTE = '"';
var ENV_IGNORE_FLAGS = /* @__PURE__ */ new Set(["-i", "--ignore-environment"]);
var GIT_OPTIONS_WITH_VALUES = /* @__PURE__ */ new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
var GIT_OPTIONS_WITH_INLINE_VALUES = ["--git-dir=", "--work-tree=", "--namespace=", "-c="];
async function git(args2, options) {
  const { stdout } = await execFileAsync(GIT_BINARY, args2, {
    cwd: options?.cwd,
    encoding: TEXT_ENCODING,
    env: options?.env,
    timeout: options?.timeout
  });
  return stdout.trim();
}
async function gitSafe(args2, options) {
  try {
    const stdout = await git(args2, options);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err;
    return {
      stdout: typeof e.stdout === "string" ? e.stdout.trim() : "",
      stderr: typeof e.stderr === "string" ? e.stderr.trim() : "",
      exitCode: typeof e.code === "number" ? e.code : 1
    };
  }
}
async function repoRoot() {
  return git(["rev-parse", "--show-toplevel"]);
}
function isShellControlStart(command2, index) {
  const char = command2[index];
  const next = command2[index + 1];
  if (char === SHELL_AND_OPERATOR && next === SHELL_AND_OPERATOR) return 2;
  if (char === SHELL_PIPE_OPERATOR && next === SHELL_PIPE_OPERATOR) return 2;
  if (char === SHELL_SEMICOLON_OPERATOR || char === SHELL_PIPE_OPERATOR || char === SHELL_NEWLINE)
    return 1;
  return 0;
}
function isEnvAssignment(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}
function tokenizeShellCommand(command2) {
  const segments = [[]];
  let token = null;
  let quote = null;
  let escaped = false;
  let comment = false;
  const currentSegment = () => segments[segments.length - 1];
  const ensureToken = (index) => {
    token ??= { value: "", start: index, end: index };
    return token;
  };
  const finishToken = (index) => {
    if (!token) return;
    token.end = index;
    currentSegment().push(token);
    token = null;
  };
  const markTokenEnd = (index) => {
    if (!token) return;
    token.end = index;
  };
  const finishSegment = () => {
    if (currentSegment().length > 0) segments.push([]);
  };
  for (let index = 0; index < command2.length; index += 1) {
    const char = command2[index];
    if (comment) {
      if (char === SHELL_NEWLINE) {
        comment = false;
        finishSegment();
      }
      continue;
    }
    if (escaped) {
      ensureToken(index - 1).value += char;
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
        markTokenEnd(index + 1);
        continue;
      }
      if (quote === SHELL_DOUBLE_QUOTE && char === SHELL_ESCAPE) {
        escaped = true;
        continue;
      }
      ensureToken(index).value += char;
      continue;
    }
    if (char === SHELL_ESCAPE) {
      escaped = true;
      ensureToken(index);
      continue;
    }
    if (char === SHELL_SINGLE_QUOTE || char === SHELL_DOUBLE_QUOTE) {
      ensureToken(index);
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      finishToken(index);
      if (char === SHELL_NEWLINE) finishSegment();
      continue;
    }
    if (char === SHELL_COMMENT && !token) {
      comment = true;
      continue;
    }
    const controlLength = isShellControlStart(command2, index);
    if (controlLength > 0) {
      finishToken(index);
      finishSegment();
      index += controlLength - 1;
      continue;
    }
    ensureToken(index).value += char;
  }
  finishToken(command2.length);
  return segments.filter((segment) => segment.length > 0);
}
function findSimpleCommandIndex(tokens) {
  let index = 0;
  while (index < tokens.length && isEnvAssignment(tokens[index].value)) {
    index += 1;
  }
  if (tokens[index]?.value === GIT_COMMAND_ENV) {
    index += 1;
    while (index < tokens.length) {
      const value = tokens[index].value;
      if (isEnvAssignment(value)) {
        index += 1;
        continue;
      }
      if (ENV_IGNORE_FLAGS.has(value)) {
        index += 1;
        continue;
      }
      break;
    }
  }
  if (tokens[index]?.value === GIT_COMMAND_WRAPPER) {
    index += 1;
  }
  return index;
}
function gitOptionConsumesValue(value) {
  return GIT_OPTIONS_WITH_VALUES.has(value);
}
function findGitCommitToken(tokens) {
  let index = findSimpleCommandIndex(tokens);
  if (tokens[index]?.value !== GIT_BINARY) return null;
  index += 1;
  while (index < tokens.length) {
    const value = tokens[index].value;
    if (value === GIT_COMMAND_COMMIT) {
      const hasAmend = tokens.slice(index + 1).some((token) => {
        return token.value === GIT_AMEND_FLAG || token.value.startsWith(`${GIT_AMEND_FLAG}=`);
      });
      return hasAmend ? null : tokens[index];
    }
    if (value === GIT_END_OF_OPTIONS) return null;
    if (gitOptionConsumesValue(value)) {
      index += 2;
      continue;
    }
    if (GIT_OPTIONS_WITH_INLINE_VALUES.some((prefix) => value.startsWith(prefix))) {
      index += 1;
      continue;
    }
    if (value.startsWith("-")) {
      index += 1;
      continue;
    }
    return null;
  }
  return null;
}
function findGitCommitCommand(command2) {
  for (const segment of tokenizeShellCommand(command2)) {
    const commitToken = findGitCommitToken(segment);
    if (commitToken) return { insertAt: commitToken.end };
  }
  return null;
}
function injectGitCommitTrailer(command2, trailer) {
  const match = findGitCommitCommand(command2);
  if (!match) return null;
  return `${command2.slice(0, match.insertAt)} ${trailer}${command2.slice(match.insertAt)}`;
}

// src/agents/hook-command.ts
var AGENT_FLAG = "--agent";
var AGENT_FLAG_PREFIX = `${AGENT_FLAG}=`;
var AGENTNOTE_HOOK_TOKENS = AGENTNOTE_HOOK_COMMAND.split(" ");
var CLI_JS_HOOK_TOKENS = CLI_JS_HOOK_COMMAND.split(" ");
var NODE_COMMAND_NAMES = /* @__PURE__ */ new Set(["node", "nodejs"]);
var NPX_COMMAND_NAME = "npx";
var PATH_SEPARATOR_RE = /[\\/]/;
function tokenizeHookCommand(command2) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const char of command2) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (quote === null && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}
function tokenBasename(token) {
  return token.split(PATH_SEPARATOR_RE).pop() ?? token;
}
function hasHookTokenSequence(tokens, sequence) {
  if (sequence.length === 0) return false;
  return tokens.some((token, index) => {
    const firstMatches = token === sequence[0] || sequence[0] === CLI_JS_HOOK_TOKENS[0] && tokenBasename(token) === sequence[0];
    if (!firstMatches || index + sequence.length > tokens.length) return false;
    return sequence.slice(1).every((expectedToken, offset) => tokens[index + offset + 1] === expectedToken);
  });
}
function hasPublicHookCommand(tokens) {
  return tokens.some((token, index) => {
    if (token !== AGENTNOTE_HOOK_TOKENS[0]) return false;
    if (!hasHookTokenSequence(tokens.slice(index), AGENTNOTE_HOOK_TOKENS)) return false;
    if (index === 0) return true;
    if (tokenBasename(tokens[0]) !== NPX_COMMAND_NAME) return false;
    return tokens.slice(1, index).every((part) => part.startsWith("-"));
  });
}
function hasRepoLocalHookCommand(tokens) {
  return tokens.some((token, index) => {
    if (tokenBasename(token) !== CLI_JS_HOOK_TOKENS[0]) return false;
    if (!hasHookTokenSequence(tokens.slice(index), CLI_JS_HOOK_TOKENS)) return false;
    return index === 0 || index === 1 && NODE_COMMAND_NAMES.has(tokenBasename(tokens[0]));
  });
}
function readAgentFlag(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === AGENT_FLAG) return tokens[index + 1] ?? "";
    if (token.startsWith(AGENT_FLAG_PREFIX)) return token.slice(AGENT_FLAG_PREFIX.length);
  }
  return null;
}
function isAgentNoteHookCommand(command2, agentName, options = {}) {
  const tokens = tokenizeHookCommand(command2);
  const isPublicHook = hasPublicHookCommand(tokens);
  const isRepoLocalHook = hasRepoLocalHookCommand(tokens);
  if (!isPublicHook && !isRepoLocalHook) return false;
  const agentFlag = readAgentFlag(tokens);
  if (agentFlag === agentName) return true;
  return options.allowMissingAgent === true && agentFlag === null;
}

// src/agents/types.ts
var AGENT_NAMES = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  gemini: "gemini"
};
var NORMALIZED_EVENT_KINDS = {
  sessionStart: "session_start",
  stop: "stop",
  response: "response",
  prompt: "prompt",
  preEdit: "pre_edit",
  fileChange: "file_change",
  preCommit: "pre_commit",
  postCommit: "post_commit"
};

// src/agents/claude.ts
var HOOK_COMMAND = "npx --yes agent-note hook";
var CLAUDE_HOOK_COMMAND = `${HOOK_COMMAND} --agent ${AGENT_NAMES.claude}`;
var ENV_AGENTNOTE_CLAUDE_HOME = "AGENTNOTE_CLAUDE_HOME";
var CLAUDE_HOOK_EVENTS = {
  sessionStart: "SessionStart",
  stop: "Stop",
  userPromptSubmit: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse"
};
var CLAUDE_TOOLS = {
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  multiEdit: "MultiEdit",
  notebookEdit: "NotebookEdit"
};
var CLAUDE_EDIT_TOOLS = /* @__PURE__ */ new Set([
  CLAUDE_TOOLS.edit,
  CLAUDE_TOOLS.write,
  CLAUDE_TOOLS.multiEdit,
  CLAUDE_TOOLS.notebookEdit
]);
var CLAUDE_EDIT_TOOL_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";
var CLAUDE_POST_TOOL_MATCHER = `${CLAUDE_EDIT_TOOL_MATCHER}|${CLAUDE_TOOLS.bash}`;
var CLAUDE_GIT_COMMIT_FILTER = "Bash(*git commit*)";
var HOOKS_CONFIG = {
  [CLAUDE_HOOK_EVENTS.sessionStart]: [
    { hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] }
  ],
  [CLAUDE_HOOK_EVENTS.stop]: [
    { hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] }
  ],
  [CLAUDE_HOOK_EVENTS.userPromptSubmit]: [
    { hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }] }
  ],
  [CLAUDE_HOOK_EVENTS.preToolUse]: [
    {
      matcher: CLAUDE_EDIT_TOOL_MATCHER,
      hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }]
    },
    {
      matcher: CLAUDE_TOOLS.bash,
      hooks: [{ type: "command", if: CLAUDE_GIT_COMMIT_FILTER, command: CLAUDE_HOOK_COMMAND }]
    }
  ],
  [CLAUDE_HOOK_EVENTS.postToolUse]: [
    {
      matcher: CLAUDE_POST_TOOL_MATCHER,
      hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND, async: true }]
    }
  ]
};
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function claudeHome() {
  return process.env[ENV_AGENTNOTE_CLAUDE_HOME] ?? join(homedir(), ".claude");
}
function isValidSessionId(id) {
  return UUID_PATTERN.test(id);
}
function isValidTranscriptPath(p) {
  const base = resolve(claudeHome());
  const normalized = resolve(p);
  return normalized === base || normalized.startsWith(`${base}${sep}`);
}
var SYSTEM_PROMPT_PREFIXES = ["<task-notification", "<system-reminder", "<teammate-message"];
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
  return findGitCommitCommand(cmd) !== null;
}
function isManagedClaudeHook(hook2) {
  if (!hook2 || typeof hook2 !== "object") return false;
  const command2 = hook2.command;
  return typeof command2 === "string" && isAgentNoteHookCommand(command2, AGENT_NAMES.claude, { allowMissingAgent: true });
}
function removeManagedClaudeHooks(entry) {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) {
    return entry;
  }
  const group = entry;
  const hooks = group.hooks.filter((hook2) => !isManagedClaudeHook(hook2));
  return hooks.length > 0 ? { ...group, hooks } : null;
}
function hasManagedClaudeHook(entry) {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) {
    return false;
  }
  return entry.hooks.some((hook2) => {
    if (!hook2 || typeof hook2 !== "object") return false;
    const command2 = hook2.command;
    return typeof command2 === "string" && isAgentNoteHookCommand(command2, AGENT_NAMES.claude);
  });
}
var claude = {
  name: AGENT_NAMES.claude,
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
        settings = JSON.parse(await readFile(settingsPath, TEXT_ENCODING));
      } catch {
        settings = {};
      }
    }
    const hooks = settings.hooks ?? {};
    for (const [event, entries] of Object.entries(hooks)) {
      hooks[event] = entries.map(removeManagedClaudeHooks).filter((entry) => entry !== null);
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
      const settings = JSON.parse(await readFile(settingsPath, TEXT_ENCODING));
      if (!settings.hooks) return;
      for (const [event, entries] of Object.entries(settings.hooks)) {
        settings.hooks[event] = entries.map(removeManagedClaudeHooks).filter((entry) => entry !== null);
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
      const content = await readFile(settingsPath, TEXT_ENCODING);
      const settings = JSON.parse(content);
      return Object.values(settings.hooks ?? {}).some(
        (entries) => entries.some((entry) => hasManagedClaudeHook(entry))
      );
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
      case CLAUDE_HOOK_EVENTS.sessionStart:
        return {
          kind: NORMALIZED_EVENT_KINDS.sessionStart,
          sessionId: sid,
          timestamp: ts,
          model: e.model,
          transcriptPath: tp
        };
      case CLAUDE_HOOK_EVENTS.stop:
        return {
          kind: NORMALIZED_EVENT_KINDS.stop,
          sessionId: sid,
          timestamp: ts,
          transcriptPath: tp
        };
      case CLAUDE_HOOK_EVENTS.userPromptSubmit:
        if (!e.prompt || isSystemInjectedPrompt(e.prompt)) {
          return null;
        }
        return {
          kind: NORMALIZED_EVENT_KINDS.prompt,
          sessionId: sid,
          timestamp: ts,
          prompt: e.prompt
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
            toolUseId: e.tool_use_id
          };
        }
        if (tool === CLAUDE_TOOLS.bash && isGitCommit(cmd)) {
          return {
            kind: NORMALIZED_EVENT_KINDS.preCommit,
            sessionId: sid,
            timestamp: ts,
            commitCommand: cmd
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
            toolUseId: e.tool_use_id
          };
        }
        if (tool === CLAUDE_TOOLS.bash && isGitCommit(e.tool_input?.command ?? "")) {
          return {
            kind: NORMALIZED_EVENT_KINDS.postCommit,
            sessionId: sid,
            timestamp: ts,
            transcriptPath: tp
          };
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
      const content = await readFile(transcriptPath, TEXT_ENCODING);
      const lines = content.trim().split("\n");
      const interactions = [];
      let pendingPrompt = null;
      let pendingPromptTimestamp;
      let pendingResponseTexts = [];
      const flush = () => {
        if (pendingPrompt === null) return;
        const response = pendingResponseTexts.length > 0 ? pendingResponseTexts.join("\n") : null;
        const interaction = { prompt: pendingPrompt, response };
        if (pendingPromptTimestamp) interaction.timestamp = pendingPromptTimestamp;
        interactions.push(interaction);
        pendingPrompt = null;
        pendingPromptTimestamp = void 0;
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
              pendingPromptTimestamp = typeof entry.timestamp === "string" ? entry.timestamp : void 0;
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

// src/agents/codex.ts
import { createReadStream, existsSync as existsSync2, readdirSync as readdirSync2, readFileSync } from "node:fs";
import { mkdir as mkdir2, readFile as readFile2, writeFile as writeFile2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { isAbsolute, join as join2, relative, resolve as resolve2, sep as sep2 } from "node:path";
import { createInterface } from "node:readline";
var CONFIG_REL_PATH = ".codex/config.toml";
var ENV_CODEX_HOME = "CODEX_HOME";
var ENV_CODEX_THREAD_ID = "CODEX_THREAD_ID";
var HOOKS_REL_PATH = ".codex/hooks.json";
var HOOK_COMMAND2 = `npx --yes agent-note hook --agent ${AGENT_NAMES.codex}`;
var TRANSCRIPT_PREVIEW_CHARS = 4096;
var SHELL_MUTATION_COMMAND_RE = /(^|[;&|]\s*)(apply_patch|cat\s+>|cp\b|install\b|mkdir\b|mv\b|npm\s+(audit\s+fix|dedupe|install|update|version)\b|perl\s+-[^\n;&|]*i|pnpm\s+(add|install|update)\b|rm\b|sed\s+-[^\n;&|]*i|tee\b|touch\b|yarn\s+(add|install|upgrade)\b)|(\s|^)(>|>>)\s*\S+/;
var CODEX_HOOK_EVENTS = {
  sessionStart: "SessionStart",
  userPromptSubmit: "UserPromptSubmit",
  stop: "Stop"
};
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
function collectCommandStrings(value, seen = /* @__PURE__ */ new Set()) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const parsed = parseJsonString(value);
      if (parsed !== value) return collectCommandStrings(parsed, seen);
    }
    return [trimmed];
  }
  if (!value || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCommandStrings(item, seen));
  }
  if (!isRecord(value)) return [];
  return [
    ...collectCommandStrings(value.cmd, seen),
    ...collectCommandStrings(value.command, seen),
    ...collectCommandStrings(value.script, seen),
    ...collectCommandStrings(value.shell, seen)
  ];
}
function readTranscriptSessionId(candidate) {
  try {
    const preview = readFileSync(candidate, TEXT_ENCODING).slice(0, TRANSCRIPT_PREVIEW_CHARS);
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
  return process.env[ENV_CODEX_HOME] ?? join2(homedir2(), ".codex");
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
        hooks: group.hooks.filter(
          (hook2) => !isAgentNoteHookCommand(hook2.command, AGENT_NAMES.codex, {
            allowMissingAgent: true
          })
        )
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
function appendInteractionMutationTool(interaction, toolName) {
  if (!toolName) return;
  const tools = interaction.mutation_tools ?? [];
  if (tools.includes(toolName)) return;
  interaction.mutation_tools = [...tools, toolName];
}
function isMutatingShellCommand(command2) {
  return SHELL_MUTATION_COMMAND_RE.test(command2);
}
var codex = {
  name: AGENT_NAMES.codex,
  settingsRelPath: CONFIG_REL_PATH,
  async managedPaths() {
    return [CONFIG_REL_PATH, HOOKS_REL_PATH];
  },
  async installHooks(repoRoot3) {
    const codexDir = join2(repoRoot3, ".codex");
    const configPath = join2(repoRoot3, CONFIG_REL_PATH);
    const hooksPath = join2(repoRoot3, HOOKS_REL_PATH);
    await mkdir2(codexDir, { recursive: true });
    const configContent = existsSync2(configPath) ? await readFile2(configPath, TEXT_ENCODING) : "";
    await writeFile2(configPath, normalizeConfigToml(configContent));
    let hooksConfig = {};
    if (existsSync2(hooksPath)) {
      try {
        hooksConfig = JSON.parse(await readFile2(hooksPath, TEXT_ENCODING));
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
      const parsed = JSON.parse(await readFile2(hooksPath, TEXT_ENCODING));
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
        readFile2(configPath, TEXT_ENCODING),
        readFile2(hooksPath, TEXT_ENCODING)
      ]);
      const configOk = configContent.includes("features.codex_hooks = true") || configContent.includes("[features]") && configContent.match(/^\s*codex_hooks\s*=\s*true\s*$/m) !== null;
      const parsed = JSON.parse(hooksContent);
      const hasHook = Object.values(parsed.hooks ?? {}).some(
        (groups) => groups.some(
          (group) => group.hooks.some((hook2) => isAgentNoteHookCommand(hook2.command, AGENT_NAMES.codex))
        )
      );
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
      case CODEX_HOOK_EVENTS.sessionStart:
        return {
          kind: NORMALIZED_EVENT_KINDS.sessionStart,
          sessionId,
          timestamp,
          model: payload.model,
          transcriptPath
        };
      case CODEX_HOOK_EVENTS.userPromptSubmit:
        return payload.prompt ? {
          kind: NORMALIZED_EVENT_KINDS.prompt,
          sessionId,
          timestamp,
          prompt: payload.prompt,
          transcriptPath,
          model: payload.model
        } : null;
      case CODEX_HOOK_EVENTS.stop:
        return {
          kind: NORMALIZED_EVENT_KINDS.stop,
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
  readEnvironmentSessionId() {
    return process.env[ENV_CODEX_THREAD_ID] ?? null;
  },
  async extractInteractions(transcriptPath) {
    if (!isValidTranscriptPath2(transcriptPath)) {
      throw new Error(`Invalid Codex transcript path: ${transcriptPath}`);
    }
    if (!existsSync2(transcriptPath)) {
      throw new Error(`Codex transcript not found: ${transcriptPath}`);
    }
    const interactions = [];
    let current = null;
    let sessionCwd;
    const lines = createInterface({
      input: createReadStream(transcriptPath, { encoding: TEXT_ENCODING }),
      crlfDelay: Number.POSITIVE_INFINITY
    });
    try {
      for await (const rawLine of lines) {
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
          if (typeof entry.timestamp === "string") current.timestamp = entry.timestamp;
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
          if (toolName === "exec_command" && [
            ...collectCommandStrings(payload.input),
            ...collectCommandStrings(payload.arguments)
          ].some(isMutatingShellCommand)) {
            appendInteractionMutationTool(current, toolName);
          }
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
          appendInteractionMutationTool(current, toolName);
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
  }
};

// src/agents/cursor.ts
import { execFileSync } from "node:child_process";
import { existsSync as existsSync3, statSync } from "node:fs";
import { mkdir as mkdir3, readFile as readFile3, writeFile as writeFile3 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { join as join3, resolve as resolve3, sep as sep3 } from "node:path";
var HOOKS_REL_PATH2 = ".cursor/hooks.json";
var HOOK_COMMAND3 = `npx --yes agent-note hook --agent ${AGENT_NAMES.cursor}`;
var CURSOR_PROJECTS_DIR = join3(homedir3(), ".cursor", "projects");
var CURSOR_TRANSCRIPTS_DIR_ENV = "AGENTNOTE_CURSOR_TRANSCRIPTS_DIR";
var TRANSCRIPT_WAIT_MS = 1500;
var TRANSCRIPT_POLL_MS = 50;
var CURSOR_HOOK_EVENTS = {
  beforeSubmitPrompt: "beforeSubmitPrompt",
  afterAgentResponse: "afterAgentResponse",
  beforeShellExecution: "beforeShellExecution",
  afterFileEdit: "afterFileEdit",
  afterTabFileEdit: "afterTabFileEdit",
  afterShellExecution: "afterShellExecution",
  stop: "stop"
};
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
function extractTimestamp(value) {
  if (!isRecord2(value)) return void 0;
  return typeof value.timestamp === "string" ? value.timestamp : void 0;
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
function repoRoot2() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: TEXT_ENCODING
    }).trim();
  } catch {
    return resolve3(process.cwd());
  }
}
function cursorTranscriptDir() {
  const override = process.env[CURSOR_TRANSCRIPTS_DIR_ENV]?.trim();
  if (override) return resolve3(override);
  return join3(CURSOR_PROJECTS_DIR, sanitizePathForCursor(repoRoot2()), "agent-transcripts");
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
  let pendingPromptTimestamp;
  let pendingResponse = [];
  const flush = () => {
    if (!pendingPrompt?.trim()) return;
    const interaction = {
      prompt: pendingPrompt.trim(),
      response: pendingResponse.length > 0 ? pendingResponse.join("\n").trim() : null
    };
    if (pendingPromptTimestamp) interaction.timestamp = pendingPromptTimestamp;
    interactions.push(interaction);
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
      pendingPromptTimestamp = extractTimestamp(parsed);
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
      [CURSOR_HOOK_EVENTS.beforeSubmitPrompt]: [{ command: HOOK_COMMAND3 }],
      [CURSOR_HOOK_EVENTS.beforeShellExecution]: [{ command: HOOK_COMMAND3 }],
      [CURSOR_HOOK_EVENTS.afterAgentResponse]: [{ command: HOOK_COMMAND3 }],
      [CURSOR_HOOK_EVENTS.afterFileEdit]: [{ command: HOOK_COMMAND3 }],
      [CURSOR_HOOK_EVENTS.afterTabFileEdit]: [{ command: HOOK_COMMAND3 }],
      [CURSOR_HOOK_EVENTS.afterShellExecution]: [{ command: HOOK_COMMAND3 }],
      [CURSOR_HOOK_EVENTS.stop]: [{ command: HOOK_COMMAND3 }]
    }
  };
}
function isGitCommit2(command2) {
  return findGitCommitCommand(command2) !== null;
}
function stripAgentnoteHooks2(config) {
  if (!config.hooks) {
    return { version: config.version ?? 1, hooks: {} };
  }
  const hooks = Object.fromEntries(
    Object.entries(config.hooks).map(([event, entries]) => [
      event,
      entries.filter(
        (entry) => !isAgentNoteHookCommand(entry.command, AGENT_NAMES.cursor, { allowMissingAgent: true })
      )
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
var cursor = {
  name: AGENT_NAMES.cursor,
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
        hooksConfig = JSON.parse(await readFile3(hooksPath, TEXT_ENCODING));
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
      const parsed = JSON.parse(await readFile3(hooksPath, TEXT_ENCODING));
      await writeFile3(hooksPath, `${JSON.stringify(stripAgentnoteHooks2(parsed), null, 2)}
`);
    } catch {
    }
  },
  async isEnabled(repoRoot3) {
    const hooksPath = join3(repoRoot3, HOOKS_REL_PATH2);
    if (!existsSync3(hooksPath)) return false;
    try {
      const content = await readFile3(hooksPath, TEXT_ENCODING);
      const parsed = JSON.parse(content);
      return Object.values(parsed.hooks ?? {}).some(
        (entries) => entries.some((entry) => isAgentNoteHookCommand(entry.command, AGENT_NAMES.cursor))
      );
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
      case CURSOR_HOOK_EVENTS.beforeSubmitPrompt:
        return payload.prompt ? {
          kind: NORMALIZED_EVENT_KINDS.prompt,
          sessionId,
          timestamp,
          prompt: payload.prompt,
          model: payload.model
        } : null;
      case CURSOR_HOOK_EVENTS.afterAgentResponse: {
        const response = collectMessageText2(
          payload.response ?? payload.text ?? payload.content ?? payload.message ?? payload.output
        ).join("\n").trim();
        return response ? {
          kind: NORMALIZED_EVENT_KINDS.response,
          sessionId,
          timestamp,
          response
        } : null;
      }
      case CURSOR_HOOK_EVENTS.beforeShellExecution:
        return payload.command && isGitCommit2(payload.command) ? {
          kind: NORMALIZED_EVENT_KINDS.preCommit,
          sessionId,
          timestamp,
          commitCommand: payload.command
        } : null;
      case CURSOR_HOOK_EVENTS.afterFileEdit:
      case CURSOR_HOOK_EVENTS.afterTabFileEdit: {
        const filePath = payload.file_path ?? payload.filePath;
        const editStats = extractEditStats(payload.edits);
        return filePath ? {
          kind: NORMALIZED_EVENT_KINDS.fileChange,
          sessionId,
          timestamp,
          file: filePath,
          tool: payload.hook_event_name,
          ...editStats ? { editStats } : {}
        } : null;
      }
      case CURSOR_HOOK_EVENTS.afterShellExecution:
        return payload.command && isGitCommit2(payload.command) ? {
          kind: NORMALIZED_EVENT_KINDS.postCommit,
          sessionId,
          timestamp
        } : null;
      case CURSOR_HOOK_EVENTS.stop: {
        const response = collectMessageText2(
          payload.response ?? payload.text ?? payload.content ?? payload.message ?? payload.output
        ).join("\n").trim();
        return {
          kind: NORMALIZED_EVENT_KINDS.stop,
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
      content = await readFile3(transcriptPath, TEXT_ENCODING);
    } catch {
      return [];
    }
    if (!content.trim()) return [];
    const trimmed = content.trimStart();
    return trimmed.startsWith("{") ? extractJsonlInteractions(content) : extractPlainTextInteractions(content);
  }
};

// src/agents/gemini.ts
import { existsSync as existsSync4, readdirSync as readdirSync3, readFileSync as readFileSync2 } from "node:fs";
import { mkdir as mkdir4, readFile as readFile4, writeFile as writeFile4 } from "node:fs/promises";
import { homedir as homedir4 } from "node:os";
import { dirname, join as join4, resolve as resolve4, sep as sep4 } from "node:path";
var HOOK_COMMAND4 = `npx --yes agent-note hook --agent ${AGENT_NAMES.gemini}`;
var ENV_GEMINI_HOME = "GEMINI_HOME";
var HOOK_TIMEOUT_MS = 1e4;
var SETTINGS_REL_PATH = ".gemini/settings.json";
var TRANSCRIPT_PREVIEW_CHARS2 = 4096;
var GEMINI_TRANSCRIPT_MESSAGE_TYPE = "gemini";
var GEMINI_HOOK_EVENTS = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  beforeAgent: "BeforeAgent",
  afterAgent: "AfterAgent",
  beforeTool: "BeforeTool",
  afterTool: "AfterTool"
};
var GEMINI_EDIT_TOOL_NAMES = ["write_file", "replace"];
var GEMINI_SHELL_TOOL_NAMES = [
  "run_shell_command",
  "shell",
  "bash",
  "run_command",
  "execute_command"
];
var GEMINI_EDIT_TOOL_MATCHER = GEMINI_EDIT_TOOL_NAMES.join("|");
var GEMINI_SHELL_TOOL_MATCHER = GEMINI_SHELL_TOOL_NAMES.join("|");
var EDIT_TOOLS = new Set(GEMINI_EDIT_TOOL_NAMES);
var SHELL_TOOLS = new Set(GEMINI_SHELL_TOOL_NAMES);
var UUID_PATTERN2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HOOKS_CONFIG2 = {
  [GEMINI_HOOK_EVENTS.sessionStart]: [
    {
      matcher: "*",
      hooks: [
        {
          name: "agentnote-session-start",
          type: "command",
          command: HOOK_COMMAND4,
          timeout: HOOK_TIMEOUT_MS
        }
      ]
    }
  ],
  [GEMINI_HOOK_EVENTS.sessionEnd]: [
    {
      matcher: "*",
      hooks: [
        {
          name: "agentnote-session-end",
          type: "command",
          command: HOOK_COMMAND4,
          timeout: HOOK_TIMEOUT_MS
        }
      ]
    }
  ],
  [GEMINI_HOOK_EVENTS.beforeAgent]: [
    {
      matcher: "*",
      hooks: [
        {
          name: "agentnote-before-agent",
          type: "command",
          command: HOOK_COMMAND4,
          timeout: HOOK_TIMEOUT_MS
        }
      ]
    }
  ],
  [GEMINI_HOOK_EVENTS.afterAgent]: [
    {
      matcher: "*",
      hooks: [
        {
          name: "agentnote-after-agent",
          type: "command",
          command: HOOK_COMMAND4,
          timeout: HOOK_TIMEOUT_MS
        }
      ]
    }
  ],
  [GEMINI_HOOK_EVENTS.beforeTool]: [
    {
      matcher: GEMINI_EDIT_TOOL_MATCHER,
      hooks: [
        {
          name: "agentnote-before-edit",
          type: "command",
          command: HOOK_COMMAND4,
          timeout: HOOK_TIMEOUT_MS
        }
      ]
    },
    {
      matcher: GEMINI_SHELL_TOOL_MATCHER,
      hooks: [
        {
          name: "agentnote-before-shell",
          type: "command",
          command: HOOK_COMMAND4,
          timeout: HOOK_TIMEOUT_MS
        }
      ]
    }
  ],
  [GEMINI_HOOK_EVENTS.afterTool]: [
    {
      matcher: GEMINI_EDIT_TOOL_MATCHER,
      hooks: [
        {
          name: "agentnote-after-edit",
          type: "command",
          command: HOOK_COMMAND4,
          timeout: HOOK_TIMEOUT_MS
        }
      ]
    },
    {
      matcher: GEMINI_SHELL_TOOL_MATCHER,
      hooks: [
        {
          name: "agentnote-after-shell",
          type: "command",
          command: HOOK_COMMAND4,
          timeout: HOOK_TIMEOUT_MS
        }
      ]
    }
  ]
};
function geminiHome() {
  return process.env[ENV_GEMINI_HOME] ?? join4(homedir4(), ".gemini");
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
  return findGitCommitCommand(cmd) !== null;
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
    hooks: group.hooks.filter(
      (hook2) => !isAgentNoteHookCommand(hook2.command, AGENT_NAMES.gemini, { allowMissingAgent: true })
    )
  })).filter((group) => group.hooks.length > 0);
}
function readTranscriptSessionId2(candidate) {
  try {
    const preview = readFileSync2(candidate, TEXT_ENCODING).slice(0, TRANSCRIPT_PREVIEW_CHARS2);
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
var gemini = {
  name: AGENT_NAMES.gemini,
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
        settings = JSON.parse(await readFile4(settingsPath, TEXT_ENCODING));
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
      const settings = JSON.parse(
        await readFile4(settingsPath, TEXT_ENCODING)
      );
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
      const content = await readFile4(settingsPath, TEXT_ENCODING);
      const parsed = JSON.parse(content);
      return Object.values(parsed.hooks ?? {}).some(
        (groups) => groups.some(
          (group) => group.hooks.some((hook2) => isAgentNoteHookCommand(hook2.command, AGENT_NAMES.gemini))
        )
      );
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
      case GEMINI_HOOK_EVENTS.sessionStart:
        return {
          kind: NORMALIZED_EVENT_KINDS.sessionStart,
          sessionId: sid,
          timestamp: ts,
          model: e.model,
          transcriptPath: tp
        };
      case GEMINI_HOOK_EVENTS.sessionEnd:
        return {
          kind: NORMALIZED_EVENT_KINDS.stop,
          sessionId: sid,
          timestamp: ts,
          transcriptPath: tp
        };
      case GEMINI_HOOK_EVENTS.beforeAgent:
        return e.prompt ? {
          kind: NORMALIZED_EVENT_KINDS.prompt,
          sessionId: sid,
          timestamp: ts,
          prompt: e.prompt,
          model: e.model
        } : null;
      case GEMINI_HOOK_EVENTS.afterAgent:
        return e.prompt_response ? {
          kind: NORMALIZED_EVENT_KINDS.response,
          sessionId: sid,
          timestamp: ts,
          response: e.prompt_response
        } : null;
      case GEMINI_HOOK_EVENTS.beforeTool: {
        const toolName = e.tool_name?.toLowerCase() ?? "";
        const filePath = e.tool_input?.file_path;
        const cmd = e.tool_input?.command ?? "";
        if (EDIT_TOOLS.has(toolName) && filePath) {
          return {
            kind: NORMALIZED_EVENT_KINDS.preEdit,
            sessionId: sid,
            timestamp: ts,
            tool: e.tool_name,
            file: filePath
          };
        }
        if (SHELL_TOOLS.has(toolName) && isGitCommit3(cmd)) {
          return {
            kind: NORMALIZED_EVENT_KINDS.preCommit,
            sessionId: sid,
            timestamp: ts,
            commitCommand: cmd
          };
        }
        return null;
      }
      case GEMINI_HOOK_EVENTS.afterTool: {
        const toolName = e.tool_name?.toLowerCase() ?? "";
        const filePath = e.tool_input?.file_path;
        const cmd = e.tool_input?.command ?? "";
        if (EDIT_TOOLS.has(toolName) && filePath) {
          return {
            kind: NORMALIZED_EVENT_KINDS.fileChange,
            sessionId: sid,
            timestamp: ts,
            tool: e.tool_name,
            file: filePath
          };
        }
        if (SHELL_TOOLS.has(toolName) && isGitCommit3(cmd)) {
          return {
            kind: NORMALIZED_EVENT_KINDS.postCommit,
            sessionId: sid,
            timestamp: ts,
            transcriptPath: tp
          };
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
      content = await readFile4(transcriptPath, TEXT_ENCODING);
    } catch {
      return [];
    }
    const interactions = [];
    let current = null;
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      let record2;
      try {
        record2 = JSON.parse(line);
      } catch {
        continue;
      }
      const type = typeof record2.type === "string" ? record2.type : void 0;
      if (!type) continue;
      if (type === "user") {
        const prompt = extractPartText(record2.content);
        if (!prompt) continue;
        if (current) interactions.push(current);
        current = { prompt, response: null };
        if (typeof record2.timestamp === "string") current.timestamp = record2.timestamp;
        continue;
      }
      if (type === GEMINI_TRANSCRIPT_MESSAGE_TYPE && current) {
        const response = extractPartText(record2.content);
        if (response) {
          current.response = current.response ? `${current.response}
${response}` : response;
        }
        const toolCalls = Array.isArray(record2.toolCalls) ? record2.toolCalls : [];
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

// src/agents/index.ts
var AGENTS = /* @__PURE__ */ new Map([
  [claude.name, claude],
  [codex.name, codex],
  [cursor.name, cursor],
  [gemini.name, gemini]
]);
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

// src/core/entry.ts
var DEFAULT_PROMPT_DETAIL = "compact";
var LEGACY_PROMPT_SCORE = 100;
var PERCENT_DENOMINATOR = 100;
var PRIMARY_SCORE_FLOOR = 80;
var HIGH_SCORE_THRESHOLD = 75;
var MEDIUM_SCORE_THRESHOLD = 45;
var BRIDGE_SCORE_MAX_WITH_SUBSTANTIVE = 55;
var BRIDGE_SCORE_MAX_WITHOUT_SUBSTANTIVE = 44;
var ANCHORED_BRIDGE_SCORE_MAX = 65;
var UNANCHORED_TAIL_SCORE_MAX = 44;
var SHORT_PROMPT_MAX_CHARS = 120;
var SHORT_PROMPT_MAX_WORDS = 12;
var PROMPT_ROLE_BASE_SCORES = {
  primary: 90,
  direct_anchor: 75,
  scope: 60,
  tail: 45,
  anchored_bridge: 45,
  bridge: 25,
  background: 15
};
var PROMPT_ROLE_SCORE_CLAMPS = {
  primary: [80, 100],
  direct_anchor: [65, 95],
  scope: [50, 80],
  tail: [35, 70],
  anchored_bridge: [40, 65],
  bridge: [20, 55],
  background: [0, 30]
};
var PROMPT_SIGNAL_SCORES = {
  primary_edit_turn: 0,
  exact_commit_path: 30,
  commit_file_basename: 10,
  diff_identifier: 20,
  response_exact_commit_path: 18,
  response_basename_or_identifier: 10,
  commit_subject_overlap: 4,
  list_or_checklist_shape: 10,
  multi_line_instruction: 6,
  inline_code_or_path_shape: 6,
  substantive_prompt_shape: 12,
  before_commit_boundary: 5,
  between_non_excluded_prompts: 8
};
var GENERATED_DIR_SEGMENTS = /* @__PURE__ */ new Set([
  // Web / JS / TS build outputs
  ".next",
  ".nuxt",
  "coverage",
  // Monorepo / remote-cache build outputs
  ".turbo",
  ".yarn",
  "bazel-bin",
  "bazel-out",
  "bazel-testlogs",
  // Mobile / Flutter build caches
  ".dart_tool",
  "DerivedData"
]);
var GENERATED_FILE_NAMES = /* @__PURE__ */ new Set([
  // Flutter tool-managed dependency snapshot
  ".flutter-plugins-dependencies",
  // Flutter desktop / mobile plugin registrants
  "generated_plugin_registrant.dart",
  "GeneratedPluginRegistrant.java",
  "GeneratedPluginRegistrant.swift",
  "GeneratedPluginRegistrant.m",
  "GeneratedPluginRegistrant.h"
]);
var GENERATED_FILE_SUFFIXES = [
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
var GENERATED_CONTENT_PATTERNS = [
  // Cross-language generator banners used by protoc, sqlc, stringer, bindgen, etc.
  /\bcode generated\b[\s\S]{0,160}\bdo not edit\b/i,
  /\bautomatically generated by\b/i,
  /\bthis file was generated by\b/i,
  // Annotation-style banners commonly used in Java / Kotlin / JS ecosystems.
  /\B@generated\b/i,
  // Named generators across Web, mobile, backend, and protobuf toolchains.
  /\bgenerated by (?:swiftgen|sourcery|protoc|buf|sqlc|openapi(?:-generator)?|openapitools|wire|freezed|build_runner|mockgen|rust-bindgen|apollo|drift|flutterfire|ksp)\b/i
];
function isGeneratedArtifactPath(path) {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => GENERATED_DIR_SEGMENTS.has(segment))) {
    return true;
  }
  const basename3 = segments.at(-1) ?? normalized;
  if (GENERATED_FILE_NAMES.has(basename3)) return true;
  return GENERATED_FILE_SUFFIXES.some((suffix) => basename3.endsWith(suffix));
}
function hasGeneratedArtifactMarkers(content) {
  const header = content.slice(0, 2048).toLowerCase();
  return GENERATED_CONTENT_PATTERNS.some((pattern) => pattern.test(header));
}
function filterAiRatioEligibleFiles(files) {
  return files.filter(
    (file) => !file.generated && !file.ai_ratio_excluded && !isGeneratedArtifactPath(file.path)
  );
}
function countAiRatioEligibleFiles(files) {
  const eligible = filterAiRatioEligibleFiles(files);
  return {
    total: eligible.length,
    ai: eligible.filter((file) => file.by_ai).length
  };
}
function normalizeInteractionContexts(interaction) {
  const normalized = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (context) => {
    const text = context?.text.trim();
    if (!context || !text) return;
    const key = text;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({ kind: context.kind, source: context.source, text });
  };
  const legacy = interaction.context?.trim();
  if (legacy) {
    add({ kind: "reference", source: "previous_response", text: legacy });
  }
  for (const context of interaction.contexts ?? []) {
    add(context);
  }
  return normalized;
}
function parsePromptDetail(value) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return DEFAULT_PROMPT_DETAIL;
  if (normalized === "standard") return "compact";
  if (normalized === "compact" || normalized === "full") {
    return normalized;
  }
  throw new Error("prompt_detail must be one of: compact, full");
}
function shouldRenderInteractionByPromptDetail(interaction, detail) {
  const runtime = resolvePromptRuntimeSelection(interaction.selection, interaction);
  if (detail === "full") return true;
  return runtime.level !== "low";
}
function filterInteractionsByPromptDetail(interactions, detail) {
  if (detail === "full") return interactions;
  return interactions.filter((interaction, index) => {
    if (!shouldRenderInteractionByPromptDetail(interaction, detail)) return false;
    return !isAbsorbedExternalReviewPrompt(interaction, interactions.slice(index + 1));
  });
}
function resolvePromptRuntimeSelection(selection, interaction) {
  if (!selection) return { score: LEGACY_PROMPT_SCORE, role: "primary", level: "high" };
  const signals = runtimePromptSelectionSignals(selection.signals, interaction.prompt);
  const role = resolvePromptRuntimeRole(selection.source, signals, interaction.prompt);
  const score = scorePromptRuntime({ role, signals });
  return { score, role, level: resolvePromptRuntimeLevel({ score, role }) };
}
function resolvePromptRuntimeRole(source, signals, prompt) {
  if (source === "primary" || signals.includes("primary_edit_turn")) return "primary";
  if (signals.includes("exact_commit_path") || signals.includes("diff_identifier")) {
    return "direct_anchor";
  }
  if (isShortSelectionPrompt(prompt) && hasBridgeAnchorSignal(signals)) {
    return "anchored_bridge";
  }
  if (hasScopeSignal(signals)) return "scope";
  if (source === "tail") return "tail";
  if (isShortSelectionPrompt(prompt) && signals.includes("between_non_excluded_prompts")) {
    return "bridge";
  }
  return "background";
}
function scorePromptRuntime(opts) {
  let score = roleBaseScore(opts.role);
  for (const signal of opts.signals) score += signalScore(signal);
  const [min, max] = roleScoreClamp(opts.role);
  score = Math.max(min, Math.min(score, max));
  if (opts.role === "primary") return Math.max(score, PRIMARY_SCORE_FLOOR);
  if (opts.role === "bridge") {
    const maxBridgeScore = opts.signals.includes("substantive_prompt_shape") ? BRIDGE_SCORE_MAX_WITH_SUBSTANTIVE : BRIDGE_SCORE_MAX_WITHOUT_SUBSTANTIVE;
    return Math.min(score, maxBridgeScore);
  }
  if (opts.role === "anchored_bridge") return Math.min(score, ANCHORED_BRIDGE_SCORE_MAX);
  if (opts.role === "tail" && !hasTailStructuralAnchorSignal(opts.signals)) {
    return Math.min(score, UNANCHORED_TAIL_SCORE_MAX);
  }
  return score;
}
function resolvePromptRuntimeLevel(runtime) {
  if (runtime.role === "primary") return "high";
  if (runtime.role === "bridge") return runtime.score >= MEDIUM_SCORE_THRESHOLD ? "medium" : "low";
  if (runtime.role === "anchored_bridge") {
    return runtime.score >= MEDIUM_SCORE_THRESHOLD ? "medium" : "low";
  }
  if (runtime.score >= HIGH_SCORE_THRESHOLD) return "high";
  if (runtime.score >= MEDIUM_SCORE_THRESHOLD) return "medium";
  return "low";
}
function roleBaseScore(role) {
  return PROMPT_ROLE_BASE_SCORES[role];
}
function roleScoreClamp(role) {
  return [...PROMPT_ROLE_SCORE_CLAMPS[role]];
}
function signalScore(signal) {
  return PROMPT_SIGNAL_SCORES[signal];
}
function hasBridgeAnchorSignal(signals) {
  return signals.includes("exact_commit_path") || signals.includes("diff_identifier") || signals.includes("commit_file_basename");
}
function hasTailStructuralAnchorSignal(signals) {
  return signals.includes("exact_commit_path") || signals.includes("diff_identifier") || signals.includes("commit_file_basename") || signals.includes("inline_code_or_path_shape") || signals.includes("substantive_prompt_shape");
}
function hasScopeSignal(signals) {
  return signals.includes("list_or_checklist_shape") || signals.includes("multi_line_instruction");
}
function isShortSelectionPrompt(prompt) {
  const trimmed = prompt.trim();
  if (!trimmed) return true;
  return trimmed.length <= SHORT_PROMPT_MAX_CHARS && trimmed.split(/\s+/).length <= SHORT_PROMPT_MAX_WORDS;
}
function hasSubstantivePromptShape(text) {
  const trimmed = text.trim();
  const compact = trimmed.replace(/\s+/g, "");
  if (!compact) return false;
  const wordTokens = text.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const hasCjkOrHangul = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(trimmed);
  if (wordTokens.length >= 7) return true;
  if (wordTokens.length >= 4 && (/[?？]/.test(trimmed) || hasCjkOrHangul)) return true;
  return hasCjkOrHangul && [...compact].length >= 12;
}
function runtimePromptSelectionSignals(signals, prompt) {
  if (signals.includes("substantive_prompt_shape") || !hasSubstantivePromptShape(prompt)) {
    return signals;
  }
  return [...signals, "substantive_prompt_shape"];
}
function isAbsorbedExternalReviewPrompt(interaction, laterInteractions) {
  const selection = interaction.selection;
  if (!selection || selection.source !== "window") return false;
  if ((interaction.files_touched?.length ?? 0) > 0) return false;
  if (!hasExternalWorkReference(interaction.prompt)) return false;
  if (!hasResponseAnchorSignal(selection.signals)) return false;
  if (hasCurrentPromptAnchorSignal(selection.signals)) return false;
  return laterInteractions.some(hasPrimaryEditInteraction);
}
function hasExternalWorkReference(prompt) {
  return /https?:\/\/\S+\/(?:pull|issues)\/\d+\b/i.test(prompt);
}
function hasResponseAnchorSignal(signals) {
  return signals.includes("response_exact_commit_path") || signals.includes("response_basename_or_identifier");
}
function hasCurrentPromptAnchorSignal(signals) {
  return signals.includes("primary_edit_turn") || signals.includes("exact_commit_path") || signals.includes("commit_file_basename") || signals.includes("diff_identifier") || signals.includes("list_or_checklist_shape") || signals.includes("multi_line_instruction") || signals.includes("inline_code_or_path_shape");
}
function hasPrimaryEditInteraction(interaction) {
  if ((interaction.files_touched?.length ?? 0) > 0) return true;
  const selection = interaction.selection;
  return selection?.source === "primary" || selection?.signals.includes("primary_edit_turn") === true;
}
function calcAiRatio(files, lineCounts) {
  if (lineCounts && lineCounts.totalAddedLines > 0) {
    return Math.round(lineCounts.aiAddedLines / lineCounts.totalAddedLines * PERCENT_DENOMINATOR);
  }
  const eligible = countAiRatioEligibleFiles(files);
  if (eligible.total === 0) return 0;
  return Math.round(eligible.ai / eligible.total * PERCENT_DENOMINATOR);
}
function resolveMethod(files, lineCounts) {
  if (!lineCounts) return "file";
  if (lineCounts.totalAddedLines > 0) return "line";
  const eligible = countAiRatioEligibleFiles(files);
  return eligible.total > 0 ? "file" : "none";
}
function buildEntry(opts) {
  const generatedFiles = new Set(opts.generatedFiles ?? []);
  const aiRatioExcludedFiles = new Set(opts.aiRatioExcludedFiles ?? []);
  const files = opts.commitFiles.map((path) => ({
    path,
    by_ai: opts.aiFiles.includes(path),
    ...generatedFiles.has(path) ? { generated: true } : {},
    ...aiRatioExcludedFiles.has(path) ? { ai_ratio_excluded: true } : {}
  }));
  const method = resolveMethod(files, opts.lineCounts);
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
    const contexts = normalizeInteractionContexts(i);
    if (contexts.length > 0) {
      base.contexts = contexts;
    }
    if (i.files_touched && i.files_touched.length > 0) {
      base.files_touched = i.files_touched;
    }
    if (i.selection) {
      base.selection = {
        schema: i.selection.schema,
        source: i.selection.source,
        signals: [...i.selection.signals]
      };
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

// src/core/interaction-context.ts
var MAX_CONTEXT_CHARS = 900;
var MAX_SCOPE_PROMPT_CHARS = 120;
var MAX_SCOPE_LINES = 10;
var MAX_SCOPE_SENTENCES = 4;
var MAX_REFERENCE_PARAGRAPHS = 2;
var MAX_SCOPE_PROMPT_LINES = 3;
var MIN_SCOPE_SCORE = 2;
var REFERENCE_CONTEXT_RANK = 3;
var CONTEXT_SEPARATOR_CHARS = 2;
var SENTENCE_LOOKAHEAD_CHARS = 16;
var SUBJECT_TOKEN_SCOPE_THRESHOLD = 2;
var STRUCTURAL_SCOPE_WEIGHT = 2;
var GENERIC_SUBJECT_TOKEN_MIN_CHARS = 3;
var CONTEXT_KIND_ORDER = {
  reference: 0,
  scope: 1
};
var GENERIC_TOKENS = /* @__PURE__ */ new Set([
  "agent",
  "agentnote",
  "add",
  "added",
  "adds",
  "build",
  "case",
  "change",
  "commit",
  "context",
  "diff",
  "file",
  "files",
  "fix",
  "html",
  "http",
  "https",
  "implement",
  "implemented",
  "implements",
  "json",
  "note",
  "prompt",
  "record",
  "remove",
  "removed",
  "removes",
  "response",
  "test",
  "tests",
  "todo",
  "turn",
  "update",
  "updated",
  "updates",
  "utf8",
  "yaml"
]);
var CAMEL_OR_PASCAL_IDENTIFIER = /\b[A-Za-z_$]*[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*\b/g;
var SNAKE_IDENTIFIER = /\b[a-z][a-z0-9]*_[a-z][a-z0-9_]*[a-z0-9]\b/g;
var ALL_CAPS_IDENTIFIER = /\b[A-Z][A-Z0-9_]{2,}\b/g;
var ISSUE_OR_PR_REFERENCE = /\b(?:PR|Issue|GH)[\s#-]*\d+\b|#\d+\b/iu;
var MARKDOWN_FILE_REFERENCE = /(?:^|[\s("'`])(?:\.{0,2}\/)?[A-Za-z0-9_.-]+\/[^\s"'`]+\.[A-Za-z0-9]{1,8}\b/;
function buildCommitContextSignature(opts) {
  return {
    changedFiles: unique(opts.changedFiles.map((file) => normalizePath(file))),
    changedFileBasenames: unique(
      opts.changedFiles.map((file) => basename(normalizePath(file))).filter(Boolean)
    ),
    codeIdentifiers: extractCodeIdentifiers(opts.diffText),
    commitSubjectTokens: tokenizeSubject(opts.commitSubject)
  };
}
function extractCodeIdentifiers(diffText) {
  const identifiers = /* @__PURE__ */ new Set();
  for (const pattern of [CAMEL_OR_PASCAL_IDENTIFIER, SNAKE_IDENTIFIER, ALL_CAPS_IDENTIFIER]) {
    for (const match of diffText.matchAll(pattern)) {
      const identifier = match[0];
      if (isGenericIdentifier(identifier)) continue;
      identifiers.add(identifier);
    }
  }
  return identifiers;
}
function selectInteractionContext(candidate, signature) {
  if (candidate.previousTurnSelected) return void 0;
  if (!candidate.previousResponse) return void 0;
  if (hasStrongAnchor(candidate.prompt, signature)) return void 0;
  const scored = splitParagraphs(candidate.previousResponse).filter((paragraph) => !isRejectedParagraph(paragraph)).map((paragraph, index) => scoreParagraph(paragraph, index, signature)).filter((score) => hasStrongParagraphAnchor(score)).sort(compareParagraphScores);
  if (scored.length === 0) return void 0;
  const maxChars = Math.min(MAX_CONTEXT_CHARS, candidate.previousResponse.length);
  const selected = scored.slice(0, MAX_REFERENCE_PARAGRAPHS).sort((a, b) => a.index - b.index);
  const output = [];
  let length = 0;
  for (const item of selected) {
    const nextLength = length + item.paragraph.length + (output.length > 0 ? CONTEXT_SEPARATOR_CHARS : 0);
    if (nextLength > maxChars) continue;
    output.push(item.paragraph);
    length = nextLength;
  }
  return output.length > 0 ? output.join("\n\n") : void 0;
}
function toReferenceContext(context) {
  const text = context?.trim();
  if (!text) return void 0;
  return {
    kind: "reference",
    source: "previous_response",
    text,
    rank: REFERENCE_CONTEXT_RANK
  };
}
function selectInteractionScopeContext(candidate, signature) {
  if (!candidate.response) return void 0;
  if (!isShortPrompt(candidate.prompt)) return void 0;
  if (hasStrongAnchor(candidate.prompt, signature)) return void 0;
  const sentences = splitScopeSentences(candidate.response).map((sentence, index) => ({ sentence, index })).filter(({ sentence }) => !isRejectedParagraph(sentence));
  const scored = sentences.map(({ sentence, index }) => scoreScopeSentence(sentence, index, signature)).filter((score) => isValidScopeScore(score)).sort(compareScopeScores);
  return scored[0]?.context;
}
function composeInteractionContexts(contexts, maxChars = MAX_CONTEXT_CHARS) {
  const uniqueContexts = dedupeContexts(
    contexts.filter((context) => context !== void 0)
  );
  if (uniqueContexts.length === 0) return [];
  const fullLength = contextBlockLength(uniqueContexts);
  if (fullLength <= maxChars) return sortContextsForDisplay(uniqueContexts).map(stripRank);
  const selected = [];
  for (const context of [...uniqueContexts].sort(compareContextRanks)) {
    if (context.text.length > maxChars) continue;
    const next = [...selected, context];
    if (contextBlockLength(next) <= maxChars) {
      selected.push(context);
    }
  }
  return sortContextsForDisplay(selected).map(stripRank);
}
function scoreParagraph(paragraph, index, signature) {
  return {
    paragraph,
    index,
    exactPathHits: countLiteralHits(paragraph, signature.changedFiles),
    basenameHits: countLiteralHits(paragraph, signature.changedFileBasenames),
    codeIdentifierHits: countIdentifierHits(paragraph, signature.codeIdentifiers),
    subjectTokenHits: countSubjectTokenHits(paragraph, signature.commitSubjectTokens)
  };
}
function compareParagraphScores(a, b) {
  return b.exactPathHits - a.exactPathHits || b.basenameHits - a.basenameHits || b.codeIdentifierHits - a.codeIdentifierHits || b.subjectTokenHits - a.subjectTokenHits || a.index - b.index;
}
function hasStrongParagraphAnchor(score) {
  return score.exactPathHits > 0 || score.basenameHits > 0 || score.codeIdentifierHits > 0;
}
function hasStrongAnchor(text, signature) {
  return countLiteralHits(text, signature.changedFiles) > 0 || countLiteralHits(text, signature.changedFileBasenames) > 0 || countIdentifierHits(text, signature.codeIdentifiers) > 0;
}
function isShortPrompt(prompt) {
  const lines = prompt.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  return prompt.trim().length <= MAX_SCOPE_PROMPT_CHARS && lines.length <= MAX_SCOPE_PROMPT_LINES;
}
function splitScopeSentences(response) {
  const lines = response.split("\n").map((line) => stripListOrQuoteMarker(line.trim())).filter(Boolean).slice(0, MAX_SCOPE_LINES);
  const text = lines.join(" ");
  const sentences = [];
  let current = "";
  let inBacktick = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    current += char;
    if (char === "`") {
      inBacktick = !inBacktick;
      continue;
    }
    if (inBacktick) continue;
    if (isSentenceBoundary(text, index)) {
      const sentence = current.trim();
      if (sentence) sentences.push(sentence);
      current = "";
    }
  }
  const rest = current.trim();
  if (rest) sentences.push(rest);
  const leadingSentences = sentences.slice(0, MAX_SCOPE_SENTENCES);
  const windows = [];
  for (let index = 0; index < leadingSentences.length; index++) {
    windows.push(leadingSentences[index]);
    const next = leadingSentences[index + 1];
    if (next) windows.push(`${leadingSentences[index]} ${next}`);
  }
  return windows;
}
function stripListOrQuoteMarker(line) {
  return line.replace(/^>\s*/, "").replace(/^(?:[-*]|\d+[.)])\s+/, "").trim();
}
function isSentenceBoundary(text, index) {
  const char = text[index];
  if (char === "\u3002" || char === "\uFF01" || char === "\uFF1F") return true;
  if (char !== "." && char !== "!" && char !== "?") return false;
  const next = text[index + 1] ?? "";
  if (next && !/\s/.test(next)) return false;
  if (char === "." && isLikelyFileOrDomainDot(text, index)) return false;
  return true;
}
function isLikelyFileOrDomainDot(text, index) {
  const before = text.slice(Math.max(0, index - 32), index);
  const after = text.slice(index + 1, index + SENTENCE_LOOKAHEAD_CHARS);
  return /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(`${before}.${after}`) && /\w/.test(after);
}
function scoreScopeSentence(sentence, index, signature) {
  const fileHits = countLiteralHits(sentence, signature.changedFiles) + countLiteralHits(sentence, signature.changedFileBasenames);
  const codeIdentifierHits = countIdentifierHits(sentence, signature.codeIdentifiers);
  const subjectTokenHits = countSubjectTokenHits(sentence, signature.commitSubjectTokens);
  const issueRefHits = ISSUE_OR_PR_REFERENCE.test(sentence) ? 1 : 0;
  const scopedTitleHits = subjectTokenHits >= SUBJECT_TOKEN_SCOPE_THRESHOLD ? 1 : 0;
  const issueScopedTitleHits = issueRefHits > 0 && subjectTokenHits > 0 ? 1 : 0;
  const markdownIssueHits = issueRefHits > 0 && MARKDOWN_FILE_REFERENCE.test(sentence) ? 1 : 0;
  const structuralScore = codeIdentifierHits * STRUCTURAL_SCOPE_WEIGHT + scopedTitleHits * STRUCTURAL_SCOPE_WEIGHT + issueScopedTitleHits * STRUCTURAL_SCOPE_WEIGHT + markdownIssueHits * STRUCTURAL_SCOPE_WEIGHT + fileHits;
  return {
    context: {
      kind: "scope",
      source: "current_response",
      text: sentence,
      rank: structuralScore
    },
    fileHits,
    codeIdentifierHits,
    scopedTitleHits,
    issueScopedTitleHits,
    markdownIssueHits,
    subjectTokenHits,
    issueRefHits,
    index
  };
}
function isValidScopeScore(score) {
  if (score.context.rank < MIN_SCOPE_SCORE) return false;
  const hasScopedTitle = score.scopedTitleHits > 0 || score.issueScopedTitleHits > 0;
  const hasIssueCodeScope = score.issueRefHits > 0 && score.codeIdentifierHits > 0;
  const hasCodeSubjectScope = score.codeIdentifierHits > 0 && score.subjectTokenHits > 0;
  if (score.fileHits > 0) {
    return score.codeIdentifierHits > 0 || hasScopedTitle || score.markdownIssueHits > 0;
  }
  return hasScopedTitle || score.markdownIssueHits > 0 || hasIssueCodeScope || hasCodeSubjectScope;
}
function compareScopeScores(a, b) {
  return b.context.rank - a.context.rank || b.issueScopedTitleHits - a.issueScopedTitleHits || b.markdownIssueHits - a.markdownIssueHits || b.codeIdentifierHits - a.codeIdentifierHits || b.scopedTitleHits - a.scopedTitleHits || a.index - b.index;
}
function splitParagraphs(text) {
  const paragraphs = [];
  let current = [];
  let inFence = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      if (current.length > 0) {
        paragraphs.push(current.join("\n").trim());
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) paragraphs.push(current.join("\n").trim());
  return paragraphs.filter((paragraph) => paragraph.length > 0);
}
function isRejectedParagraph(paragraph) {
  return hasBrokenCodeFence(paragraph) || isIntroOnlyParagraph(paragraph) || isOperationalNoise(paragraph) || hasLocalAbsolutePath(paragraph);
}
function hasBrokenCodeFence(paragraph) {
  return (paragraph.match(/```/g) ?? []).length % 2 !== 0;
}
function isIntroOnlyParagraph(paragraph) {
  const trimmed = paragraph.trim();
  return /^#{1,6}\s+\S/.test(trimmed) || /[:：]\s*$/.test(trimmed);
}
function isOperationalNoise(paragraph) {
  const lower = paragraph.toLowerCase();
  return lower.includes("working tree") || lower.includes("ready for review") || /\bci\b/.test(lower) && /\b(pass|passed|green|failed|failure)\b/.test(lower) || lower.includes("git diff --check");
}
function hasLocalAbsolutePath(paragraph) {
  return /(?:^|[\s("'`])(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(paragraph);
}
function countLiteralHits(text, literals) {
  let count = 0;
  for (const literal of literals) {
    if (!literal) continue;
    if (containsLiteral(text, literal)) count += 1;
  }
  return count;
}
function containsLiteral(text, literal) {
  const escaped = escapeRegExp(literal);
  const pattern = new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}($|[^A-Za-z0-9_/-])`, "i");
  return pattern.test(text);
}
function countIdentifierHits(text, identifiers) {
  let count = 0;
  for (const identifier of identifiers) {
    if (containsIdentifier(text, identifier)) count += 1;
  }
  return count;
}
function containsIdentifier(text, identifier) {
  const escaped = escapeRegExp(identifier);
  return new RegExp(`\\b${escaped}\\b`).test(text);
}
function countSubjectTokenHits(text, tokens) {
  const textTokens = new Set(tokenizeSubject(text));
  return tokens.filter((token) => textTokens.has(token)).length;
}
function tokenizeSubject(text) {
  const tokens = text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).map((token) => token.trim()).filter(
    (token) => token.length >= GENERIC_SUBJECT_TOKEN_MIN_CHARS && !GENERIC_TOKENS.has(token)
  );
  return unique(tokens);
}
function isGenericIdentifier(identifier) {
  return GENERIC_TOKENS.has(identifier.toLowerCase());
}
function normalizePath(path) {
  return path.replaceAll("\\", "/");
}
function basename(path) {
  return path.split("/").pop() ?? path;
}
function unique(values) {
  return [...new Set(values.filter((value) => value.length > 0))];
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function dedupeContexts(contexts) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const context of contexts) {
    const text = context.text.trim();
    if (!text) continue;
    const key = text;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...context, text });
  }
  return result;
}
function contextBlockLength(contexts) {
  return contexts.reduce((length, context, index) => {
    return length + context.text.length + (index > 0 ? CONTEXT_SEPARATOR_CHARS : 0);
  }, 0);
}
function compareContextRanks(a, b) {
  return b.rank - a.rank || contextKindOrder(a.kind) - contextKindOrder(b.kind);
}
function sortContextsForDisplay(contexts) {
  return [...contexts].sort(
    (a, b) => contextKindOrder(a.kind) - contextKindOrder(b.kind) || b.rank - a.rank
  );
}
function contextKindOrder(kind) {
  return CONTEXT_KIND_ORDER[kind];
}
function stripRank(context) {
  return {
    kind: context.kind,
    source: context.source,
    text: context.text
  };
}

// src/core/jsonl.ts
import { existsSync as existsSync5 } from "node:fs";
import { appendFile, readFile as readFile5 } from "node:fs/promises";
async function readJsonlEntries(filePath) {
  if (!existsSync5(filePath)) return [];
  const content = await readFile5(filePath, TEXT_ENCODING);
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

// src/core/prompt-window.ts
var PROMPT_SELECTION_SOURCE = /* @__PURE__ */ Symbol("agentnotePromptSelectionSource");
var PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY = /* @__PURE__ */ Symbol(
  "agentnotePromptSelectionBeforeCommitBoundary"
);
var PROMPT_WINDOW_MAX_ENTRIES = 24;
var PROMPT_WINDOW_ANCHOR_TEXT_SCORE = 2;
var PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE = 5;
var PROMPT_WINDOW_ANCHOR_SHAPE_SCORE = 44;
var LOW_SHAPE_WINDOW_TEXT_SCORE_MAX = 2;
var LOW_SHAPE_WINDOW_SHAPE_SCORE_MAX = 20;
var PROMPT_SELECTION_SCHEMA = 1;
var QUOTED_HISTORY_MIN_PROMPT_CHARS = 300;
var QUOTED_HISTORY_MIN_INDENTED_LINES = 8;
var QUOTED_HISTORY_MIN_INDENTED_PROMPT_CHARS = 500;
var TEXT_SHAPE_LENGTH_DIVISOR = 4;
var TEXT_SHAPE_LENGTH_SCORE_MAX = 24;
var TEXT_SHAPE_NEWLINE_WEIGHT = 10;
var TEXT_SHAPE_NEWLINE_SCORE_MAX = 30;
var TEXT_SHAPE_INLINE_CODE_SCORE = 18;
var TEXT_SHAPE_PATH_SCORE = 16;
var TEXT_SHAPE_FLAG_SCORE = 14;
var TEXT_SHAPE_LIST_SCORE = 20;
var FILE_REF_EXACT_PATH_SCORE = 80;
var FILE_REF_SEGMENT_MIN_CHARS = 4;
var FILE_REF_SEGMENT_SCORE = 5;
var FILE_REF_BASENAME_SCORE = 20;
var TEXT_OVERLAP_PATH_TOKEN_SCORE = 4;
var TEXT_OVERLAP_WORD_TOKEN_SCORE = 1;
var TOKEN_MIN_CHARS = 2;
var TOKEN_PART_MIN_CHARS = 3;
function selectPromptWindowEntries(promptEntries, primaryTurns, editTurns, maxConsumedTurn, currentTurn, commitFiles, commitSubject, contextSignature, consumedPromptState, responsesByTurn) {
  if (primaryTurns.size === 0) return emptyPromptWindowSelection();
  const orderedPrimaryTurns = [...primaryTurns].filter((turn) => turn > 0).sort((a, b) => a - b);
  if (orderedPrimaryTurns.length === 0) return emptyPromptWindowSelection();
  return selectCommitPromptWindow(
    promptEntries,
    maxConsumedTurn,
    orderedPrimaryTurns[orderedPrimaryTurns.length - 1] ?? 0,
    currentTurn,
    primaryTurns,
    editTurns,
    commitFiles,
    commitSubject,
    contextSignature,
    consumedPromptState,
    responsesByTurn,
    "window"
  );
}
function selectPromptOnlyFallbackEntries(promptEntries, maxConsumedTurn, commitFiles, commitSubject, contextSignature, consumedPromptState, responsesByTurn, currentTurn = Number.POSITIVE_INFINITY) {
  const upperTurn = currentTurn > 0 ? currentTurn : Number.POSITIVE_INFINITY;
  const latestPromptTurn = promptEntries.reduce((latest, entry) => {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (turn > upperTurn) return latest;
    return turn > latest ? turn : latest;
  }, 0);
  if (latestPromptTurn <= maxConsumedTurn) return emptyPromptWindowSelection();
  return selectCommitPromptWindow(
    promptEntries,
    maxConsumedTurn,
    latestPromptTurn,
    latestPromptTurn,
    /* @__PURE__ */ new Set(),
    /* @__PURE__ */ new Set(),
    commitFiles,
    commitSubject,
    contextSignature,
    consumedPromptState,
    responsesByTurn,
    "fallback"
  );
}
function attachInteractionSelections(promptEntries, interactions, signature, commitSubject) {
  const candidates = interactions.map((interaction, index) => {
    const promptEntry = promptEntries[index];
    if (!interaction || !promptEntry) return null;
    return buildPromptSelectionCandidate(interaction, promptEntry, false, signature, commitSubject);
  });
  const nonExcludedIndexes = /* @__PURE__ */ new Set();
  candidates.forEach((candidate, index) => {
    if (candidate && !analyzePromptSelection(candidate).hardExcluded) {
      nonExcludedIndexes.add(index);
    }
  });
  for (let index = 0; index < interactions.length; index++) {
    const interaction = interactions[index];
    const promptEntry = promptEntries[index];
    if (!interaction || !promptEntry) continue;
    const candidate = buildPromptSelectionCandidate(
      interaction,
      promptEntry,
      hasAdjacentNonExcludedInteraction(index, nonExcludedIndexes),
      signature,
      commitSubject
    );
    const analysis = analyzePromptSelection(candidate);
    const selection = toPersistedSelection(analysis);
    if (selection) interaction.selection = selection;
  }
}
function analyzePromptSelection(candidate) {
  const hardExcluded = isHardExcludedPromptSelection(candidate);
  if (hardExcluded) {
    return {
      runtime: { score: 0, role: "background", level: "low" },
      source: candidate.source,
      signals: [],
      hardExcluded: true
    };
  }
  const signals = collectPromptSelectionSignals(candidate);
  const role = resolvePromptRuntimeRole(candidate.source, signals, candidate.prompt);
  const score = scorePromptRuntime({ role, signals });
  return {
    runtime: { score, role, level: resolvePromptRuntimeLevel({ score, role }) },
    source: candidate.source,
    signals,
    hardExcluded: false
  };
}
function toPersistedSelection(analysis) {
  if (analysis.hardExcluded) return null;
  return {
    schema: PROMPT_SELECTION_SCHEMA,
    source: analysis.source,
    signals: analysis.signals
  };
}
function readPromptSelectionSource(entry) {
  return entry?.[PROMPT_SELECTION_SOURCE] ?? "window";
}
function emptyPromptWindowSelection() {
  return { selected: [], consumed: [] };
}
function buildPromptSelectionCandidate(interaction, promptEntry, hasAdjacentNonExcludedPrompt, signature, commitSubject) {
  const source = readPromptSelectionSource(promptEntry);
  const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
  const promptId = typeof promptEntry.prompt_id === "string" ? promptEntry.prompt_id : void 0;
  return {
    prompt: interaction.prompt,
    response: interaction.response,
    turn,
    promptId,
    source,
    isPrimaryTurn: source === "primary",
    isTail: source === "tail",
    isBeforeCommitBoundary: readPromptSelectionBeforeCommitBoundary(promptEntry),
    hasAdjacentNonExcludedPrompt,
    commitFiles: signature.changedFiles,
    commitSubject,
    diffIdentifiers: signature.codeIdentifiers
  };
}
function hasAdjacentNonExcludedInteraction(index, nonExcludedIndexes) {
  return nonExcludedIndexes.has(index - 1) || nonExcludedIndexes.has(index + 1);
}
function isHardExcludedPromptSelection(candidate) {
  if (candidate.isPrimaryTurn) return false;
  return isQuotedPromptHistory(candidate.prompt) || isStructurallyTinyPrompt(candidate.prompt);
}
function collectPromptSelectionSignals(candidate) {
  const signals = [];
  const prompt = candidate.prompt;
  const response = candidate.response ?? "";
  const basenames = candidate.commitFiles.map((file) => fileBasename(file)).filter(Boolean);
  if (candidate.isPrimaryTurn) signals.push("primary_edit_turn");
  if (hasExactCommitPath(prompt, candidate.commitFiles)) signals.push("exact_commit_path");
  if (hasCommitFileBasename(prompt, basenames)) signals.push("commit_file_basename");
  if (hasDiffIdentifier(prompt, candidate.diffIdentifiers)) signals.push("diff_identifier");
  if (response && hasExactCommitPath(response, candidate.commitFiles)) {
    signals.push("response_exact_commit_path");
  }
  if (response && (hasCommitFileBasename(response, basenames) || hasDiffIdentifier(response, candidate.diffIdentifiers))) {
    signals.push("response_basename_or_identifier");
  }
  if (hasCommitSubjectOverlap(prompt, candidate.commitSubject)) {
    signals.push("commit_subject_overlap");
  }
  if (hasListOrChecklistShape(prompt)) signals.push("list_or_checklist_shape");
  if (hasMultiLineInstruction(prompt)) signals.push("multi_line_instruction");
  if (hasInlineCodeOrPathShape(prompt)) signals.push("inline_code_or_path_shape");
  if (hasSubstantivePromptShape(prompt)) signals.push("substantive_prompt_shape");
  if (candidate.isBeforeCommitBoundary) signals.push("before_commit_boundary");
  if (isShortSelectionPrompt(prompt) && candidate.hasAdjacentNonExcludedPrompt) {
    signals.push("between_non_excluded_prompts");
  }
  return [...new Set(signals)];
}
function hasExactCommitPath(text, commitFiles) {
  const lower = text.toLowerCase();
  return commitFiles.some((file) => lower.includes(file.toLowerCase()));
}
function hasCommitFileBasename(text, basenames) {
  const lower = text.toLowerCase();
  return basenames.some(
    (basename3) => basename3.length > 0 && lower.includes(basename3.toLowerCase())
  );
}
function fileBasename(path) {
  return path.split("/").pop() ?? path;
}
function hasDiffIdentifier(text, identifiers) {
  for (const identifier of identifiers) {
    if (new RegExp(`\\b${escapeRegExp2(identifier)}\\b`).test(text)) return true;
  }
  return false;
}
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function hasCommitSubjectOverlap(prompt, commitSubject) {
  const promptTokens = tokenizePromptSelectionText(prompt);
  const subjectTokens = tokenizePromptSelectionText(commitSubject);
  for (const token of promptTokens) {
    if (subjectTokens.has(token)) return true;
  }
  return false;
}
function hasListOrChecklistShape(text) {
  return /^\s*(?:[-*]|\d+\.)\s/m.test(text);
}
function hasMultiLineInstruction(text) {
  return text.trim().split("\n").filter((line) => line.trim().length > 0).length >= 2;
}
function hasInlineCodeOrPathShape(text) {
  return /`[^`]+`/.test(text) || /(^|\s)(?:\.{0,2}\/|~\/|[A-Za-z0-9_.-]+\/)[^\s]+/.test(text) || /--[a-z0-9-]+/i.test(text);
}
function selectCommitPromptWindow(promptEntries, lowerTurn, latestPrimaryTurn, upperTurn, primaryTurns, editTurns, commitFiles, commitSubject, contextSignature, consumedPromptState, responsesByTurn, defaultSource) {
  if (upperTurn <= lowerTurn && primaryTurns.size === 0) return emptyPromptWindowSelection();
  const rows = promptEntries.filter((entry) => {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    return turn > lowerTurn && turn <= upperTurn || primaryTurns.has(turn);
  }).sort((left, right) => {
    const leftTurn = typeof left.turn === "number" ? left.turn : 0;
    const rightTurn = typeof right.turn === "number" ? right.turn : 0;
    return leftTurn - rightTurn;
  }).map(
    (entry) => buildPromptWindowRow(
      entry,
      primaryTurns,
      editTurns,
      lowerTurn,
      latestPrimaryTurn,
      upperTurn,
      commitFiles,
      commitSubject,
      contextSignature,
      consumedPromptState,
      responsesByTurn,
      defaultSource
    )
  );
  const hasCurrentWindowExplanation = rows.some(
    (row) => row.isWithinCommitWindow && isPromptWindowAnchor(row)
  );
  const hadStalePrimaryBeforeWindow = rows.some(
    (row) => row.isPrimaryTurn && !row.isWithinCommitWindow
  );
  const boundedRows = rows.filter(
    (row) => shouldKeepTaskBoundaryPromptRow(row, hasCurrentWindowExplanation)
  );
  const taskBoundedRows = hadStalePrimaryBeforeWindow && hasCurrentWindowExplanation ? trimLeadingStaleWindowRows(boundedRows) : boundedRows;
  markPostPrimaryEditBarriers(taskBoundedRows);
  if (taskBoundedRows.length === 0) return emptyPromptWindowSelection();
  let hardStartIndex = 0;
  while (hardStartIndex < taskBoundedRows.length - 1 && isHardTrimPromptRow(taskBoundedRows[hardStartIndex])) {
    hardStartIndex += 1;
  }
  const hardTrimmedRows = taskBoundedRows.slice(0, hardStartIndex);
  const hasQuotedHardTrim = hardTrimmedRows.some((row) => row.isQuotedHistory);
  const firstAnchorIndex = taskBoundedRows.findIndex(
    (row, index) => index >= hardStartIndex && isPromptWindowAnchor(row)
  );
  let startIndex = firstAnchorIndex >= 0 ? firstAnchorIndex : hardStartIndex;
  const softLeadingRows = firstAnchorIndex >= 0 ? taskBoundedRows.slice(hardStartIndex, firstAnchorIndex) : [];
  const preserveShortLeadingContext = firstAnchorIndex >= 0 && !hasQuotedHardTrim && firstAnchorIndex - hardStartIndex <= 2 && softLeadingRows.every(isLowShapePromptRow);
  if (preserveShortLeadingContext) {
    startIndex = hardStartIndex;
  }
  const consumed = taskBoundedRows.map((row) => attachPromptSelectionMetadata(row));
  const selectedRows = taskBoundedRows.slice(startIndex).filter(shouldKeepPromptWindowRow);
  const selected = selectedRows.length > PROMPT_WINDOW_MAX_ENTRIES ? trimLongPromptWindow(selectedRows).map(attachPromptSelectionMetadata) : selectedRows.map(attachPromptSelectionMetadata);
  return { selected, consumed };
}
function trimLeadingStaleWindowRows(rows) {
  const taskStartIndex = rows.findIndex(isCurrentTaskBoundaryRow);
  return taskStartIndex > 0 ? rows.slice(taskStartIndex) : rows;
}
function isCurrentTaskBoundaryRow(row) {
  return row.isPrimaryTurn || row.windowShapeScore >= PROMPT_WINDOW_ANCHOR_SHAPE_SCORE;
}
function shouldKeepTaskBoundaryPromptRow(row, hasCurrentWindowExplanation) {
  if (row.isWithinCommitWindow) return true;
  if (!row.isPrimaryTurn) return false;
  return !hasCurrentWindowExplanation;
}
function buildPromptWindowRow(entry, primaryTurns, editTurns, lowerTurn, latestPrimaryTurn, upperTurn, commitFiles, commitSubject, contextSignature, consumedPromptState, responsesByTurn, defaultSource) {
  const prompt = typeof entry.prompt === "string" ? entry.prompt : "";
  const turn = typeof entry.turn === "number" ? entry.turn : 0;
  const response = responsesByTurn.get(turn) ?? null;
  const isQuotedHistory = isQuotedPromptHistory(prompt);
  const rawTextScore = scorePromptTextOverlap(prompt, commitFiles, commitSubject);
  const isPrimaryTurn = primaryTurns.has(turn);
  const isTail = defaultSource !== "fallback" && !isPrimaryTurn && turn > latestPrimaryTurn;
  const source = resolvePromptSelectionSource(defaultSource, isPrimaryTurn, isTail);
  const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
  const hasConsumedTailPrompt = !!promptId && consumedPromptState.tailPromptIds.has(promptId);
  const analysis = analyzePromptSelection({
    prompt,
    response,
    turn,
    promptId,
    source,
    isPrimaryTurn,
    isTail,
    isBeforeCommitBoundary: turn === upperTurn,
    hasAdjacentNonExcludedPrompt: false,
    commitFiles,
    commitSubject,
    diffIdentifiers: contextSignature.codeIdentifiers
  });
  return {
    entry,
    source,
    windowFileRefScore: scorePromptFileRefs(prompt, commitFiles),
    windowShapeScore: scoreTextShape(prompt),
    windowTextScore: isQuotedHistory ? Math.floor(rawTextScore * 0.25) : rawTextScore,
    hasResponseAnchor: !!response && hasResponsePromptWindowAnchor(response, commitFiles, contextSignature),
    isQuotedHistory,
    isTinyPrompt: analysis.hardExcluded,
    isPrimaryTurn,
    isTail,
    isWithinCommitWindow: turn > lowerTurn && turn <= upperTurn,
    isBeforeCommitBoundary: turn === upperTurn,
    isNonPrimaryEditTurn: editTurns.has(turn) && !isPrimaryTurn,
    // A tail marker is only a display dedupe marker, not edit ownership.
    // Re-evaluate it if the same prompt later owns a committed edit or if
    // Codex needs the prompt-only fallback path. For ordinary prompt windows,
    // do not let an old commit/PR boundary prompt come back as context for a
    // later primary turn.
    isConsumedTailPrompt: defaultSource !== "fallback" && hasConsumedTailPrompt && !isPrimaryTurn,
    hasPostPrimaryEditBarrier: false
  };
}
function markPostPrimaryEditBarriers(rows) {
  let seenNonPrimaryTailEdit = false;
  for (const row of rows) {
    if (row.isTail) row.hasPostPrimaryEditBarrier = seenNonPrimaryTailEdit;
    if (row.isTail && row.isNonPrimaryEditTurn) seenNonPrimaryTailEdit = true;
  }
}
function shouldKeepPromptWindowRow(row) {
  if (row.isPrimaryTurn) return true;
  if (row.isQuotedHistory || row.isTinyPrompt || row.isNonPrimaryEditTurn) return false;
  if (row.isConsumedTailPrompt) return false;
  if (row.isTail) return shouldKeepTailPromptWindowRow(row);
  return true;
}
function shouldKeepTailPromptWindowRow(row) {
  if (row.hasResponseAnchor) return true;
  if (row.hasPostPrimaryEditBarrier) {
    return row.windowFileRefScore >= PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE || row.windowTextScore >= PROMPT_WINDOW_ANCHOR_TEXT_SCORE;
  }
  return row.isBeforeCommitBoundary || row.windowFileRefScore >= PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE || row.windowTextScore >= PROMPT_WINDOW_ANCHOR_TEXT_SCORE || row.windowShapeScore >= PROMPT_WINDOW_ANCHOR_SHAPE_SCORE;
}
function isPromptWindowAnchor(row) {
  if (row.isPrimaryTurn) return true;
  if (!shouldKeepPromptWindowRow(row)) return false;
  if (row.hasResponseAnchor) return true;
  return row.windowTextScore >= PROMPT_WINDOW_ANCHOR_TEXT_SCORE || row.windowFileRefScore >= PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE || row.windowShapeScore >= PROMPT_WINDOW_ANCHOR_SHAPE_SCORE;
}
function hasResponsePromptWindowAnchor(response, commitFiles, contextSignature) {
  const basenames = commitFiles.map(fileBasename).filter(Boolean);
  return hasExactCommitPath(response, commitFiles) || hasCommitFileBasename(response, basenames) || hasDiffIdentifier(response, contextSignature.codeIdentifiers);
}
function resolvePromptSelectionSource(defaultSource, isPrimaryTurn, isTail) {
  if (defaultSource === "fallback") return "fallback";
  if (isPrimaryTurn) return "primary";
  if (isTail) return "tail";
  return "window";
}
function attachPromptSelectionMetadata(row) {
  const entry = row.entry;
  entry[PROMPT_SELECTION_SOURCE] = row.source;
  entry[PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY] = row.isBeforeCommitBoundary;
  return row.entry;
}
function readPromptSelectionBeforeCommitBoundary(entry) {
  return !!entry?.[PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY];
}
function isHardTrimPromptRow(row) {
  if (row.isPrimaryTurn) return false;
  return row.isQuotedHistory || row.isTinyPrompt || row.isNonPrimaryEditTurn || row.isConsumedTailPrompt;
}
function isLowShapePromptRow(row) {
  return row.windowTextScore < LOW_SHAPE_WINDOW_TEXT_SCORE_MAX && row.windowFileRefScore < PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE && row.windowShapeScore < LOW_SHAPE_WINDOW_SHAPE_SCORE_MAX;
}
function trimLongPromptWindow(rows) {
  const first = rows[0];
  const selected = /* @__PURE__ */ new Map();
  if (first) selected.set(promptRowTurn(first), first);
  for (const row of rows) {
    if (row.isPrimaryTurn) selected.set(promptRowTurn(row), row);
  }
  const remainingSlots = Math.max(PROMPT_WINDOW_MAX_ENTRIES - selected.size, 0);
  const tail = remainingSlots > 0 ? rows.filter((row) => !selected.has(promptRowTurn(row))).slice(-remainingSlots) : [];
  for (const row of tail) selected.set(promptRowTurn(row), row);
  return [...selected.values()].sort((left, right) => promptRowTurn(left) - promptRowTurn(right));
}
function promptRowTurn(row) {
  return typeof row.entry.turn === "number" ? row.entry.turn : 0;
}
function isStructurallyTinyPrompt(prompt) {
  return prompt.trim().length <= 1;
}
function isQuotedPromptHistory(prompt) {
  if (/🧑\s*Prompt/.test(prompt) && /🤖\s*Response/.test(prompt)) return true;
  if (/\bPrompt:\s/.test(prompt) && /\bResponse:\s/.test(prompt) && prompt.length > QUOTED_HISTORY_MIN_PROMPT_CHARS)
    return true;
  const indentedQuoteLines = prompt.match(/^\s{2,}\S/gm)?.length ?? 0;
  return prompt.length > QUOTED_HISTORY_MIN_INDENTED_PROMPT_CHARS && indentedQuoteLines >= QUOTED_HISTORY_MIN_INDENTED_LINES;
}
function scoreTextShape(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  let score = Math.min(
    Math.floor(trimmed.length / TEXT_SHAPE_LENGTH_DIVISOR),
    TEXT_SHAPE_LENGTH_SCORE_MAX
  );
  const newlines = (trimmed.match(/\n/g) ?? []).length;
  score += Math.min(newlines * TEXT_SHAPE_NEWLINE_WEIGHT, TEXT_SHAPE_NEWLINE_SCORE_MAX);
  if (/`[^`]+`/.test(trimmed)) score += TEXT_SHAPE_INLINE_CODE_SCORE;
  if (/(^|\s)(?:\.{0,2}\/|~\/|[A-Za-z0-9_.-]+\/)[^\s]+/.test(trimmed)) {
    score += TEXT_SHAPE_PATH_SCORE;
  }
  if (/--[a-z0-9-]+/i.test(trimmed)) score += TEXT_SHAPE_FLAG_SCORE;
  if (/^\s*(?:[-*]|\d+\.)\s/m.test(trimmed)) score += TEXT_SHAPE_LIST_SCORE;
  return score;
}
function scorePromptTextOverlap(prompt, commitFiles, commitSubject) {
  const promptTokens = tokenizePromptSelectionText(prompt);
  const commitTokens = tokenizePromptSelectionText(`${commitSubject}
${commitFiles.join("\n")}`);
  let score = 0;
  for (const token of promptTokens) {
    if (commitTokens.has(token)) {
      score += token.includes("/") || token.includes(".") ? TEXT_OVERLAP_PATH_TOKEN_SCORE : TEXT_OVERLAP_WORD_TOKEN_SCORE;
    }
  }
  return score;
}
function scorePromptFileRefs(prompt, commitFiles) {
  const lowerPrompt = prompt.toLowerCase();
  let score = 0;
  for (const file of commitFiles) {
    const lowerFile = file.toLowerCase();
    if (lowerPrompt.includes(lowerFile)) score += FILE_REF_EXACT_PATH_SCORE;
    const segments = file.split(/[/.]/).filter((segment) => segment.length >= FILE_REF_SEGMENT_MIN_CHARS);
    for (const segment of segments) {
      if (lowerPrompt.includes(segment.toLowerCase())) score += FILE_REF_SEGMENT_SCORE;
    }
    const basename3 = file.split("/").pop();
    if (basename3 && lowerPrompt.includes(basename3.toLowerCase())) score += FILE_REF_BASENAME_SCORE;
  }
  return score;
}
function tokenizePromptSelectionText(text) {
  const tokens = /* @__PURE__ */ new Set();
  const normalized = text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[^\p{L}\p{N}_\-./]+/gu, " ").toLowerCase();
  for (const raw of normalized.split(/\s+/)) {
    if (!raw || raw.length < TOKEN_MIN_CHARS) continue;
    tokens.add(raw);
    for (const part of raw.split(/[./_-]/)) {
      if (part.length >= TOKEN_PART_MIN_CHARS) tokens.add(part);
    }
  }
  return tokens;
}

// src/core/session.ts
import { existsSync as existsSync6 } from "node:fs";
import { readFile as readFile6, stat, writeFile as writeFile5 } from "node:fs/promises";
import { join as join5 } from "node:path";
async function writeSessionAgent(sessionDir, agentName) {
  await writeFile5(join5(sessionDir, SESSION_AGENT_FILE), `${agentName}
`);
}
async function readSessionAgent(sessionDir) {
  const agentPath = join5(sessionDir, SESSION_AGENT_FILE);
  if (!existsSync6(agentPath)) return null;
  const agent = (await readFile6(agentPath, TEXT_ENCODING)).trim();
  return agent || null;
}
async function writeSessionTranscriptPath(sessionDir, transcriptPath) {
  await writeFile5(join5(sessionDir, TRANSCRIPT_PATH_FILE), `${transcriptPath}
`);
}
async function readSessionTranscriptPath(sessionDir) {
  const saved = join5(sessionDir, TRANSCRIPT_PATH_FILE);
  if (!existsSync6(saved)) return null;
  const transcriptPath = (await readFile6(saved, TEXT_ENCODING)).trim();
  return transcriptPath || null;
}
async function hasRecordableSessionData(sessionDir) {
  for (const fileName of RECORDABLE_SESSION_FILES) {
    try {
      const stats = await stat(join5(sessionDir, fileName));
      if (stats.isFile() && stats.size > 0) return true;
    } catch {
    }
  }
  return false;
}

// src/core/storage.ts
async function writeNote(commitSha, data) {
  const body = JSON.stringify(data, null, 2);
  const result = await gitSafe(["notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", body, commitSha]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "failed to write Agent Note git note");
  }
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

// src/core/record.ts
var AGENTNOTE_IGNORE_MAX_PATTERN_LENGTH = 200;
var AGENTNOTE_IGNORE_MAX_WILDCARD_TOKENS = 10;
var AGENTNOTE_IGNORE_OVERLAPPING_WILDCARD_RE = /\*{3,}|\*\.\*/;
var TRANSCRIPT_COMMIT_FUTURE_TOLERANCE_MS = 30 * 1e3;
var TRANSCRIPT_COMMIT_PAST_TOLERANCE_MS = 30 * 1e3;
var ENV_FALLBACK_CONTEXT_BEFORE_MATCH_LIMIT = 12;
var ENV_FALLBACK_CONTEXT_MAX_GAP_MS = 45 * 60 * 1e3;
async function recordCommitEntry(opts) {
  const sessionDir = join6(opts.agentnoteDirPath, SESSIONS_DIR, opts.sessionId);
  const sessionAgent = await readSessionAgent(sessionDir);
  const agentName = sessionAgent && hasAgent(sessionAgent) ? sessionAgent : AGENT_NAMES.claude;
  const adapter = getAgent(agentName);
  const commitSha = await git(["rev-parse", "HEAD"]);
  const existingNote = await readNote(commitSha);
  if (existingNote) return { promptCount: 0, aiRatio: 0 };
  let commitFiles = [];
  try {
    const raw = await git([
      "diff-tree",
      "-z",
      "--root",
      "--no-commit-id",
      "--name-only",
      "-r",
      "HEAD"
    ]);
    commitFiles = raw.split("\0").filter(Boolean);
  } catch {
  }
  const commitFileSet = new Set(commitFiles);
  let commitSubject = "";
  try {
    commitSubject = await git(["show", "-s", "--format=%s", "HEAD"]);
  } catch {
  }
  const commitTimestampMs = await readHeadCommitTimestampMs();
  const parentCommitTimestampMs = await readHeadParentCommitTimestampMs();
  let commitDiffText = "";
  try {
    commitDiffText = await git(["show", "--format=", "--patch", "--unified=0", "HEAD"]);
  } catch {
  }
  const contextSignature = buildCommitContextSignature({
    changedFiles: commitFiles,
    diffText: commitDiffText,
    commitSubject
  });
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
  const consumedPromptState = await readConsumedPromptState(sessionDir);
  const responsesByTurn = await readResponsesByTurn(sessionDir);
  const maxConsumedTurn = await readMaxConsumedTurn(sessionDir);
  const currentTurn = await readCurrentTurn(sessionDir);
  const hasTurnData = promptEntries.some((e) => typeof e.turn === "number" && e.turn > 0);
  const unconsumedEditTurns = collectSessionEditTurns(changeEntries, preBlobEntriesForTurnFix);
  const commitFileTurns = collectCommitFileTurns(
    changeEntries,
    preBlobEntriesForTurnFix,
    commitFileSet
  );
  let aiFiles;
  let prompts;
  let relevantPromptEntries;
  let promptWindowConsumedEntries = [];
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
  const aiRatioIgnoredFiles = await detectAgentnoteIgnoredFiles(commitFiles);
  const attributionCommitFileSet = new Set(
    commitFiles.filter((file) => !generatedFiles.includes(file))
  );
  const lineCountCommitFileSet = new Set(
    commitFiles.filter(
      (file) => !generatedFiles.includes(file) && !aiRatioIgnoredFiles.includes(file)
    )
  );
  const lineAttribution = hasTurnData ? await computeLineAttribution({
    sessionDir,
    commitFileSet,
    aiFileSet: new Set(aiFiles),
    aiRatioExcludedFileSet: /* @__PURE__ */ new Set([...generatedFiles, ...aiRatioIgnoredFiles]),
    relevantTurns,
    hasTurnData,
    changeEntries
  }) : { counts: null, contributingTurns: /* @__PURE__ */ new Set() };
  if (hasTurnData) {
    const fileFallbackTurns = selectFileFallbackPrimaryTurns(commitFileTurns);
    primaryTurns = lineAttribution.contributingTurns.size > 0 ? lineAttribution.contributingTurns : fileFallbackTurns.size > 0 ? fileFallbackTurns : new Set(relevantTurns);
    const promptWindow = selectPromptWindowEntries(
      promptEntries,
      primaryTurns,
      unconsumedEditTurns,
      maxConsumedTurn,
      currentTurn,
      commitFiles,
      commitSubject,
      contextSignature,
      consumedPromptState,
      responsesByTurn
    );
    relevantPromptEntries = promptWindow.selected;
    promptWindowConsumedEntries = promptWindow.consumed;
    prompts = relevantPromptEntries.map((e) => e.prompt);
  }
  const transcriptPath = opts.transcriptPath ?? await readSessionTranscriptPath(sessionDir) ?? adapter.findTranscript(opts.sessionId);
  let crossTurnCommit = false;
  if (hasTurnData && relevantTurns.size > 0) {
    const minRelevantTurn = Math.min(...relevantTurns);
    crossTurnCommit = minRelevantTurn < currentTurn;
  }
  let interactions;
  let transcriptLineCounts;
  let useCommitLevelAttribution = false;
  let consumedPromptEntries = [];
  let consumedTranscriptPromptFiles = [];
  let allInteractions = [];
  if (transcriptPath) {
    try {
      allInteractions = await adapter.extractInteractions(transcriptPath);
      allInteractions = filterTranscriptInteractionsForCommitWindow(
        allInteractions,
        null,
        commitTimestampMs
      );
    } catch (err) {
      if (!crossTurnCommit) throw err;
    }
  }
  const transcriptCorrelationStartMs = await readTranscriptCorrelationStartMs(sessionDir);
  correlatePromptIds(allInteractions, promptEntries, transcriptCorrelationStartMs);
  const interactionsById = /* @__PURE__ */ new Map();
  for (const i of allInteractions) {
    if (i.prompt_id) interactionsById.set(i.prompt_id, i);
  }
  const currentUnattributedToolPromptIds = collectCurrentUnattributedToolPromptIds(
    allInteractions,
    promptEntries,
    maxConsumedTurn,
    currentTurn
  );
  const transcriptEditsCommit = allInteractions.some(
    (i) => (i.files_touched ?? []).some((f) => commitFileSet.has(f))
  );
  const transcriptEditsOthers = allInteractions.some((i) => {
    const touched = i.files_touched ?? [];
    return touched.length > 0 && !touched.some((f) => commitFileSet.has(f));
  });
  const promptOnlyFallbackEntries = agentName === AGENT_NAMES.codex && hasTurnData && aiFiles.length === 0 && relevantPromptEntries.length === 0 && maxConsumedTurn > 0 && !transcriptEditsCommit && transcriptEditsOthers ? selectPromptOnlyFallbackEntries(
    promptEntries,
    maxConsumedTurn,
    commitFiles,
    commitSubject,
    contextSignature,
    consumedPromptState,
    responsesByTurn,
    currentTurn
  ) : { selected: [], consumed: [] };
  const canUsePromptOnlyFallback = promptOnlyFallbackEntries.selected.length >= 2 && promptOnlyFallbackEntries.selected.some((entry2) => {
    const id = typeof entry2.prompt_id === "string" ? entry2.prompt_id : void 0;
    return !!id && interactionsById.has(id);
  });
  if (hasTurnData && prompts.length === 0 && aiFiles.length === 0 && !transcriptEditsCommit && transcriptEditsOthers && !canUsePromptOnlyFallback && currentUnattributedToolPromptIds.size === 0) {
    interactions = [];
  } else if (relevantPromptEntries.length > 0) {
    interactions = relevantPromptEntries.map((entry2) => {
      const id = typeof entry2.prompt_id === "string" ? entry2.prompt_id : void 0;
      const matched = id ? interactionsById.get(id) : void 0;
      if (matched) return toRecordedInteraction(matched, commitFileSet, consumedPromptState);
      return { prompt: entry2.prompt ?? "", response: null };
    });
    consumedPromptEntries = promptWindowConsumedEntries.length > 0 ? promptWindowConsumedEntries : relevantPromptEntries;
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
            (i) => filterInteractionCommitFiles(i, commitFileSet, consumedPromptState)
          )
        )
      ];
      transcriptLineCounts = await resolveTranscriptLineCounts(
        lineCountCommitFileSet,
        transcriptMatched,
        consumedPromptState
      );
    }
  } else if (canUsePromptOnlyFallback) {
    relevantPromptEntries = promptOnlyFallbackEntries.selected;
    prompts = promptOnlyFallbackEntries.selected.map((entry2) => entry2.prompt ?? "");
    interactions = promptOnlyFallbackEntries.selected.map((entry2) => {
      const id = typeof entry2.prompt_id === "string" ? entry2.prompt_id : void 0;
      const matched = id ? interactionsById.get(id) : void 0;
      if (matched) return toRecordedInteraction(matched, commitFileSet, consumedPromptState);
      return { prompt: entry2.prompt ?? "", response: null };
    });
    consumedPromptEntries = promptOnlyFallbackEntries.consumed;
    useCommitLevelAttribution = true;
  } else if (transcriptPath && allInteractions.length > 0) {
    const transcriptMatched = allInteractions.filter(
      (i) => (i.files_touched ?? []).some((f) => commitFileSet.has(f))
    );
    const selectableTranscriptMatched = filterSelectableTranscriptInteractions(
      transcriptMatched,
      promptEntries,
      attributionCommitFileSet,
      consumedPromptState,
      currentTurn
    );
    let attributionTranscriptMatched = selectableTranscriptMatched;
    const transcriptPrimaryTurns = await selectTranscriptPrimaryTurns(
      selectableTranscriptMatched,
      promptEntries,
      attributionCommitFileSet
    );
    const transcriptEditTurns = collectTranscriptEditTurns(allInteractions, promptEntries);
    let promptWindow = { selected: [], consumed: [] };
    let useSelectableTranscriptAttribution = false;
    if (transcriptPrimaryTurns.size > 0) {
      promptWindow = selectPromptWindowEntries(
        promptEntries,
        transcriptPrimaryTurns,
        transcriptEditTurns,
        maxConsumedTurn,
        currentTurn,
        commitFiles,
        commitSubject,
        contextSignature,
        consumedPromptState,
        responsesByTurn
      );
    } else if (hasUnlinkedCurrentTranscriptEdit(
      allInteractions,
      selectableTranscriptMatched,
      promptEntries,
      maxConsumedTurn,
      currentTurn
    )) {
      promptWindow = selectPromptOnlyFallbackEntries(
        promptEntries,
        maxConsumedTurn,
        commitFiles,
        commitSubject,
        contextSignature,
        consumedPromptState,
        responsesByTurn,
        currentTurn
      );
    }
    relevantPromptEntries = promptWindow.selected;
    promptWindowConsumedEntries = promptWindow.consumed;
    prompts = relevantPromptEntries.map((entry2) => entry2.prompt ?? "");
    if (relevantPromptEntries.length > 0) {
      interactions = relevantPromptEntries.map((entry2) => {
        const id = typeof entry2.prompt_id === "string" ? entry2.prompt_id : void 0;
        const matched = id ? interactionsById.get(id) : void 0;
        if (matched) return toRecordedInteraction(matched, commitFileSet, consumedPromptState);
        return { prompt: entry2.prompt ?? "", response: null };
      });
      consumedPromptEntries = promptWindowConsumedEntries.length > 0 ? promptWindowConsumedEntries : relevantPromptEntries;
      useSelectableTranscriptAttribution = true;
    } else if (opts.allowEnvironmentTranscriptFallback && transcriptMatched.length > 0) {
      const envTranscriptSource = selectEnvironmentTranscriptSourceInteractions(
        allInteractions,
        parentCommitTimestampMs
      );
      const envTranscriptMatched = selectEnvironmentTranscriptSourceInteractions(
        transcriptMatched,
        parentCommitTimestampMs
      );
      const envMatched = selectEnvironmentTranscriptMatchedInteractions(
        envTranscriptMatched,
        commitFileSet,
        consumedPromptState
      );
      const envDisplay = selectEnvironmentTranscriptDisplayInteractions(
        envTranscriptSource,
        envMatched,
        commitFileSet,
        consumedPromptState
      );
      interactions = envDisplay.map(
        (i) => toRecordedInteraction(i, commitFileSet, consumedPromptState)
      );
      attributionTranscriptMatched = envMatched;
      useSelectableTranscriptAttribution = true;
    } else if (selectableTranscriptMatched.length > 0 && (promptEntries.length === 0 || transcriptPrimaryTurns.size > 0)) {
      interactions = selectableTranscriptMatched.map(
        (i) => toRecordedInteraction(i, commitFileSet, consumedPromptState)
      );
      useSelectableTranscriptAttribution = true;
    } else if (!crossTurnCommit && transcriptMatched.length === 0 && canUseUnmatchedTranscriptFallback(opts.allowEnvironmentTranscriptFallback, allInteractions)) {
      const fallbackSourceInteractions = opts.allowEnvironmentTranscriptFallback ? filterTranscriptInteractionsAfterParent(allInteractions, parentCommitTimestampMs) : allInteractions;
      interactions = selectTranscriptFallbackInteractions(
        fallbackSourceInteractions,
        commitFileSet,
        currentUnattributedToolPromptIds,
        { requireMutationTool: opts.allowEnvironmentTranscriptFallback === true }
      );
      useCommitLevelAttribution = interactions.length > 0;
    } else {
      interactions = [];
    }
    if (useSelectableTranscriptAttribution && attributionTranscriptMatched.length > 0) {
      aiFiles = [
        ...new Set(
          attributionTranscriptMatched.flatMap(
            (i) => filterInteractionCommitFiles(i, commitFileSet, consumedPromptState)
          )
        )
      ];
      transcriptLineCounts = await resolveTranscriptLineCounts(
        lineCountCommitFileSet,
        attributionTranscriptMatched,
        consumedPromptState
      );
      consumedTranscriptPromptFiles = collectConsumedTranscriptPromptFiles(
        attributionTranscriptMatched,
        promptEntries,
        commitFileSet,
        consumedPromptState
      );
    }
  } else {
    interactions = prompts.map((p) => ({ prompt: p, response: null }));
  }
  if (useCommitLevelAttribution && aiFiles.length === 0 && interactions.length > 0) {
    aiFiles = commitFiles;
  }
  await fillInteractionResponsesFromEvents(sessionDir, relevantPromptEntries, interactions);
  await attachInteractionContexts(
    sessionDir,
    promptEntries,
    relevantPromptEntries,
    interactions,
    contextSignature,
    interactionsById
  );
  attachInteractionSelections(relevantPromptEntries, interactions, contextSignature, commitSubject);
  if (hasTurnData) {
    attachFilesTouched(changeEntries, relevantPromptEntries, interactions, commitFileSet);
  }
  const model = await readSessionModel(sessionDir);
  const interactionTools = buildInteractionTools(
    changeEntries,
    relevantPromptEntries,
    commitFileSet
  );
  if (opts.requireAiFileEvidence && aiFiles.length === 0 || interactions.length === 0 && aiFiles.length === 0) {
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
    aiRatioExcludedFiles: aiRatioIgnoredFiles,
    lineCounts: lineAttribution.counts ?? transcriptLineCounts,
    interactionTools
  });
  await writeNote(commitSha, entry);
  await recordConsumedPairs(
    sessionDir,
    changeEntries,
    preBlobEntriesForTurnFix,
    commitFileSet,
    consumedPromptEntries,
    consumedTranscriptPromptFiles
  );
  return { promptCount: interactions.length, aiRatio: entry.attribution.ai_ratio };
}
async function hasSessionHeadBlobEvidence(sessionDir, committedBlobs) {
  if (committedBlobs.size === 0) return false;
  const changeEntries = await readAllSessionJsonl(sessionDir, CHANGES_FILE);
  return changeEntries.some((entry) => {
    const file = typeof entry.file === "string" ? entry.file : "";
    const blob = typeof entry.blob === "string" ? entry.blob : "";
    return file !== "" && blob !== "" && committedBlobs.get(file) === blob;
  });
}
function correlatePromptIds(interactions, sessionPromptEntries, transcriptCorrelationStartMs = null) {
  const effectiveCorrelationStartMs = hasTranscriptCandidateAtOrAfter(
    interactions,
    transcriptCorrelationStartMs
  ) ? transcriptCorrelationStartMs : null;
  const sessionTextToIds = /* @__PURE__ */ new Map();
  for (const entry of sessionPromptEntries) {
    const text = typeof entry.prompt === "string" ? entry.prompt : void 0;
    const id = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
    if (!text || !id) continue;
    if (!sessionTextToIds.has(text)) sessionTextToIds.set(text, []);
    sessionTextToIds.get(text)?.push(id);
  }
  const txTextToIndices = /* @__PURE__ */ new Map();
  const txTextToUntimestampedIndices = /* @__PURE__ */ new Map();
  for (let idx = 0; idx < interactions.length; idx++) {
    if (!isTranscriptCorrelationCandidate(interactions[idx], effectiveCorrelationStartMs)) {
      continue;
    }
    const text = interactions[idx].prompt;
    const interactionMs = parseTimestampMs(interactions[idx].timestamp);
    const map = effectiveCorrelationStartMs !== null && interactionMs === null ? txTextToUntimestampedIndices : txTextToIndices;
    if (!map.has(text)) map.set(text, []);
    map.get(text)?.push(idx);
  }
  for (const [text, ids] of sessionTextToIds) {
    const indices = selectTranscriptIndicesForText(
      txTextToIndices.get(text) ?? [],
      txTextToUntimestampedIndices.get(text) ?? [],
      ids.length,
      effectiveCorrelationStartMs
    );
    if (indices.length < ids.length) continue;
    for (let i = 0; i < ids.length; i++) {
      interactions[indices[i]].prompt_id = ids[i];
    }
  }
}
function selectTranscriptIndicesForText(timestampedIndices, untimestampedIndices, expectedCount, transcriptCorrelationStartMs) {
  if (transcriptCorrelationStartMs === null) return timestampedIndices;
  if (timestampedIndices.length >= expectedCount) return timestampedIndices;
  if (timestampedIndices.length === 0) return untimestampedIndices;
  return [];
}
function hasTranscriptCandidateAtOrAfter(interactions, transcriptCorrelationStartMs) {
  if (transcriptCorrelationStartMs === null) return true;
  return interactions.some((interaction) => {
    const interactionMs = parseTimestampMs(interaction.timestamp);
    return interactionMs !== null && interactionMs >= transcriptCorrelationStartMs;
  });
}
function isTranscriptCorrelationCandidate(interaction, transcriptCorrelationStartMs) {
  if (transcriptCorrelationStartMs === null) return true;
  const interactionMs = parseTimestampMs(interaction.timestamp);
  if (interactionMs === null) return true;
  return interactionMs >= transcriptCorrelationStartMs;
}
function parseTimestampMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
async function readHeadCommitTimestampMs() {
  try {
    return parseTimestampMs(await git(["show", "-s", "--format=%cI", "HEAD"]));
  } catch {
    return null;
  }
}
async function readHeadParentCommitTimestampMs() {
  try {
    return parseTimestampMs(await git(["show", "-s", "--format=%cI", "HEAD^"]));
  } catch {
    return null;
  }
}
function filterTranscriptInteractionsForCommitWindow(interactions, parentCommitTimestampMs, commitTimestampMs) {
  const lowerBoundMs = parentCommitTimestampMs === null ? null : parentCommitTimestampMs - TRANSCRIPT_COMMIT_PAST_TOLERANCE_MS;
  const upperBoundMs = commitTimestampMs === null ? null : commitTimestampMs + TRANSCRIPT_COMMIT_FUTURE_TOLERANCE_MS;
  return interactions.filter((interaction) => {
    const interactionMs = parseTimestampMs(interaction.timestamp);
    if (interactionMs === null) return true;
    if (lowerBoundMs !== null && interactionMs < lowerBoundMs) return false;
    return upperBoundMs === null || interactionMs <= upperBoundMs;
  });
}
function selectEnvironmentTranscriptSourceInteractions(interactions, parentCommitTimestampMs) {
  const bounded = filterTranscriptInteractionsAfterParent(interactions, parentCommitTimestampMs);
  return bounded.length > 0 ? bounded : interactions;
}
function filterTranscriptInteractionsAfterParent(interactions, parentCommitTimestampMs) {
  if (parentCommitTimestampMs === null) return interactions;
  const lowerBoundMs = parentCommitTimestampMs - TRANSCRIPT_COMMIT_PAST_TOLERANCE_MS;
  return interactions.filter((interaction) => {
    const interactionMs = parseTimestampMs(interaction.timestamp);
    return interactionMs === null || interactionMs >= lowerBoundMs;
  });
}
function canUseUnmatchedTranscriptFallback(allowEnvironmentTranscriptFallback, interactions) {
  if (!allowEnvironmentTranscriptFallback) return true;
  return !interactions.some((interaction) => (interaction.files_touched ?? []).length > 0);
}
function toRecordedInteraction(interaction, commitFileSet, consumedPromptState) {
  const recorded = {
    prompt: interaction.prompt,
    response: interaction.response
  };
  const filesTouched = filterInteractionCommitFiles(
    interaction,
    commitFileSet,
    consumedPromptState
  );
  if (filesTouched && filesTouched.length > 0) {
    recorded.files_touched = [...new Set(filesTouched)];
  }
  if (interaction.tools !== void 0) {
    recorded.tools = interaction.tools;
  }
  return recorded;
}
function filterInteractionCommitFiles(interaction, commitFileSet, consumedPromptState) {
  const files = (interaction.files_touched ?? []).filter((file) => commitFileSet.has(file));
  if (!consumedPromptState || !interaction.prompt_id) return files;
  const promptId = interaction.prompt_id;
  return files.filter(
    (file) => !consumedPromptState.promptFilePairs.has(promptFilePairKey(promptId, file))
  );
}
function selectTranscriptFallbackInteractions(interactions, commitFileSet, preferredPromptIds = /* @__PURE__ */ new Set(), opts = {}) {
  const isEligible = (interaction) => (interaction.tools?.length ?? 0) > 0 && (!opts.requireMutationTool || hasMutationToolEvidence(interaction));
  const preferredToolBacked = preferredPromptIds.size > 0 ? [...interactions].reverse().find(
    (interaction) => !!interaction.prompt_id && preferredPromptIds.has(interaction.prompt_id) && isEligible(interaction)
  ) : void 0;
  if (preferredToolBacked) return [toRecordedInteraction(preferredToolBacked, commitFileSet)];
  const latestToolBacked = [...interactions].reverse().find(isEligible);
  return latestToolBacked ? [toRecordedInteraction(latestToolBacked, commitFileSet)] : [];
}
function hasMutationToolEvidence(interaction) {
  return (interaction.mutation_tools?.length ?? 0) > 0;
}
function selectEnvironmentTranscriptMatchedInteractions(interactions, commitFileSet, consumedPromptState) {
  const uncoveredFiles = new Set(commitFileSet);
  const selected = [];
  for (const interaction of [...interactions].reverse()) {
    const files = filterInteractionCommitFiles(interaction, commitFileSet, consumedPromptState);
    if (!files.some((file) => uncoveredFiles.has(file))) continue;
    selected.push(interaction);
    for (const file of files) uncoveredFiles.delete(file);
    if (uncoveredFiles.size === 0) break;
  }
  return selected.reverse();
}
function selectEnvironmentTranscriptDisplayInteractions(sourceInteractions, matchedInteractions, commitFileSet, consumedPromptState) {
  if (matchedInteractions.length === 0) return [];
  const matchedSet = new Set(matchedInteractions);
  const firstMatchIndex = sourceInteractions.findIndex(
    (interaction) => matchedSet.has(interaction)
  );
  if (firstMatchIndex < 0) return matchedInteractions;
  const selected = new Set(matchedInteractions);
  let includedBeforeMatch = 0;
  let nextInteraction = sourceInteractions[firstMatchIndex];
  for (let index = firstMatchIndex - 1; index >= 0; index--) {
    if (includedBeforeMatch >= ENV_FALLBACK_CONTEXT_BEFORE_MATCH_LIMIT) break;
    const candidate = sourceInteractions[index];
    if (shouldStopEnvironmentTranscriptContext(
      candidate,
      nextInteraction,
      commitFileSet,
      consumedPromptState
    )) {
      break;
    }
    selected.add(candidate);
    includedBeforeMatch++;
    nextInteraction = candidate;
  }
  return sourceInteractions.filter((interaction) => selected.has(interaction));
}
function shouldStopEnvironmentTranscriptContext(candidate, nextInteraction, commitFileSet, consumedPromptState) {
  if (hasLargeTranscriptContextGap(candidate, nextInteraction)) return true;
  const touched = candidate.files_touched ?? [];
  if (touched.length === 0) return false;
  return filterInteractionCommitFiles(candidate, commitFileSet, consumedPromptState).length === 0;
}
function hasLargeTranscriptContextGap(previous, next) {
  const previousMs = parseTimestampMs(previous.timestamp);
  const nextMs = parseTimestampMs(next.timestamp);
  if (previousMs === null || nextMs === null) return false;
  return nextMs - previousMs > ENV_FALLBACK_CONTEXT_MAX_GAP_MS;
}
function collectCurrentUnattributedToolPromptIds(interactions, promptEntries, maxConsumedTurn, currentTurn) {
  const candidatePromptIds = /* @__PURE__ */ new Set();
  for (const entry of promptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (!promptId || turn <= maxConsumedTurn) continue;
    if (currentTurn > 0 && turn > currentTurn) continue;
    candidatePromptIds.add(promptId);
  }
  const unattributedToolPromptIds = /* @__PURE__ */ new Set();
  for (const interaction of interactions) {
    if (!interaction.prompt_id || !candidatePromptIds.has(interaction.prompt_id)) continue;
    if ((interaction.tools?.length ?? 0) === 0) continue;
    if ((interaction.files_touched ?? []).length > 0) continue;
    unattributedToolPromptIds.add(interaction.prompt_id);
  }
  return unattributedToolPromptIds;
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
async function attachInteractionContexts(sessionDir, allPromptEntries, promptEntries, interactions, signature, interactionsById) {
  if (interactions.length === 0 || promptEntries.length === 0) return;
  const responsesByTurn = await readResponsesByTurn(sessionDir);
  for (const entry of allPromptEntries) {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (!turn || responsesByTurn.has(turn)) continue;
    const id = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
    const response = id ? interactionsById.get(id)?.response?.trim() : "";
    if (response) responsesByTurn.set(turn, response);
  }
  const selectedTurns = new Set(
    promptEntries.map((entry) => typeof entry.turn === "number" ? entry.turn : 0).filter((turn) => turn > 0)
  );
  for (let index = 0; index < interactions.length; index++) {
    const interaction = interactions[index];
    const promptEntry = promptEntries[index];
    if (!interaction || !promptEntry) continue;
    const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
    const reference = turn > 1 ? selectInteractionContext(
      {
        prompt: interaction.prompt,
        previousResponse: responsesByTurn.get(turn - 1) ?? null,
        previousTurnSelected: selectedTurns.has(turn - 1)
      },
      signature
    ) : void 0;
    const scope = selectInteractionScopeContext(
      {
        prompt: interaction.prompt,
        response: interaction.response
      },
      signature
    );
    const contexts = composeInteractionContexts([
      toReferenceContext(interaction.context ?? reference),
      scope
    ]);
    if (contexts.length > 0) {
      interaction.contexts = contexts;
      delete interaction.context;
    }
  }
}
async function resolveTranscriptLineCounts(commitFileSet, interactions, consumedPromptState) {
  const transcriptStats = /* @__PURE__ */ new Map();
  for (const interaction of interactions) {
    const eligibleFiles = new Set(
      filterInteractionCommitFiles(interaction, commitFileSet, consumedPromptState)
    );
    for (const [file, stats] of Object.entries(interaction.line_stats ?? {})) {
      if (!eligibleFiles.has(file)) continue;
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
  const promptTurnById = buildPromptTurnById(promptEntries);
  const turns = /* @__PURE__ */ new Set();
  for (const interaction of interactions) {
    if (!interaction.prompt_id || (interaction.files_touched?.length ?? 0) === 0) continue;
    const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
    if (turn > 0) turns.add(turn);
  }
  return turns;
}
function buildPromptTurnById(promptEntries) {
  const promptTurnById = /* @__PURE__ */ new Map();
  for (const entry of promptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (promptId && turn > 0) promptTurnById.set(promptId, turn);
  }
  return promptTurnById;
}
function promptFilePairKey(promptId, file) {
  return `${promptId}\0${file}`;
}
function filterSelectableTranscriptInteractions(interactions, promptEntries, commitFileSet, consumedPromptState, currentTurn) {
  const promptTurnById = buildPromptTurnById(promptEntries);
  return interactions.filter((interaction) => {
    if (!transcriptTouchesCommitFile(interaction, commitFileSet)) return false;
    if (!interaction.prompt_id) return true;
    const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
    if (currentTurn > 0 && turn > currentTurn) return false;
    return !isTranscriptPromptConsumedForCommit(interaction, commitFileSet, consumedPromptState);
  });
}
function transcriptTouchesCommitFile(interaction, commitFileSet) {
  return (interaction.files_touched ?? []).some((file) => commitFileSet.has(file));
}
function isTranscriptPromptConsumedForCommit(interaction, commitFileSet, consumedPromptState) {
  const promptId = interaction.prompt_id;
  if (!promptId) return false;
  if (consumedPromptState.legacyPromptIds.has(promptId)) return true;
  const files = (interaction.files_touched ?? []).filter((file) => commitFileSet.has(file));
  return files.length > 0 && files.every(
    (file) => consumedPromptState.promptFilePairs.has(promptFilePairKey(promptId, file))
  );
}
function hasUnlinkedCurrentTranscriptEdit(allInteractions, interactions, promptEntries, maxConsumedTurn, currentTurn) {
  const unlinkedMatches = new Set(interactions.filter((interaction) => !interaction.prompt_id));
  if (unlinkedMatches.size === 0) return false;
  const currentPromptIds = /* @__PURE__ */ new Set();
  for (const entry of promptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (promptId && turn > maxConsumedTurn && (currentTurn <= 0 || turn <= currentTurn)) {
      currentPromptIds.add(promptId);
    }
  }
  if (currentPromptIds.size === 0) return false;
  let sawCurrentPrompt = false;
  for (const interaction of allInteractions) {
    if (interaction.prompt_id && currentPromptIds.has(interaction.prompt_id)) {
      sawCurrentPrompt = true;
    }
    if (sawCurrentPrompt && unlinkedMatches.has(interaction)) return true;
  }
  return false;
}
function collectConsumedTranscriptPromptFiles(interactions, promptEntries, commitFileSet, consumedPromptState) {
  const promptTurnById = buildPromptTurnById(promptEntries);
  const consumed = [];
  const seen = /* @__PURE__ */ new Set();
  for (const interaction of interactions) {
    if (!interaction.prompt_id) continue;
    const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
    if (turn <= 0) continue;
    for (const file of filterInteractionCommitFiles(
      interaction,
      commitFileSet,
      consumedPromptState
    )) {
      const key = promptFilePairKey(interaction.prompt_id, file);
      if (seen.has(key)) continue;
      seen.add(key);
      consumed.push({ turn, promptId: interaction.prompt_id, file });
    }
  }
  return consumed;
}
async function selectTranscriptPrimaryTurns(transcriptMatched, promptEntries, commitFileSet) {
  const promptTurnById = buildPromptTurnById(promptEntries);
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
async function detectAgentnoteIgnoredFiles(commitFiles) {
  const patterns = await readAgentnoteIgnorePatterns();
  if (patterns.length === 0) return [];
  return commitFiles.filter((file) => isAgentnoteIgnoredPath(file, patterns));
}
async function readAgentnoteIgnorePatterns() {
  let repoRoot3 = "";
  try {
    repoRoot3 = await git(["rev-parse", "--show-toplevel"]);
  } catch {
    return [];
  }
  let content = "";
  try {
    content = await readFile7(join6(repoRoot3, AGENTNOTE_IGNORE_FILE), TEXT_ENCODING);
  } catch {
    return [];
  }
  return content.split(/\r?\n/).map(compileAgentnoteIgnorePattern).filter((pattern) => pattern !== null);
}
function compileAgentnoteIgnorePattern(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const negated = trimmed.startsWith("!");
  const rawPattern = negated ? trimmed.slice(1).trim() : trimmed;
  if (!rawPattern || rawPattern.startsWith("#")) return null;
  const directoryOnly = rawPattern.endsWith("/");
  const anchored = rawPattern.startsWith("/");
  const pattern = rawPattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!pattern) return null;
  if (isAgentnoteIgnorePatternTooComplex(pattern)) return null;
  const hasSlash = pattern.includes("/");
  const prefix = anchored || hasSlash ? "^" : "(?:^|/)";
  const suffix = directoryOnly || !hasSlash ? "(?:/.*)?$" : "$";
  return {
    negated,
    regex: new RegExp(`${prefix}${globPatternToRegex(pattern)}${suffix}`)
  };
}
function isAgentnoteIgnorePatternTooComplex(pattern) {
  if (pattern.length > AGENTNOTE_IGNORE_MAX_PATTERN_LENGTH) return true;
  const wildcardTokens = pattern.match(/\*\*|\*/g)?.length ?? 0;
  if (wildcardTokens > AGENTNOTE_IGNORE_MAX_WILDCARD_TOKENS) return true;
  return AGENTNOTE_IGNORE_OVERLAPPING_WILDCARD_RE.test(pattern);
}
function globPatternToRegex(pattern) {
  let regex = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        regex += ".*";
        index += 1;
      } else {
        regex += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    regex += escapeRegExp3(char);
  }
  return regex;
}
function isAgentnoteIgnoredPath(path, patterns) {
  const normalized = path.replaceAll("\\", "/");
  let ignored = false;
  for (const pattern of patterns) {
    if (pattern.regex.test(normalized)) ignored = !pattern.negated;
  }
  return ignored;
}
function escapeRegExp3(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      finish(Buffer.concat(chunks).toString(TEXT_ENCODING));
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
    aiRatioExcludedFileSet,
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
    if (aiRatioExcludedFileSet.has(file)) continue;
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
    if (aiRatioExcludedFileSet.has(file)) continue;
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
    if (e.prompt_scope === "tail") continue;
    const turn = typeof e.turn === "number" ? e.turn : 0;
    if (turn > max) max = turn;
  }
  return max;
}
async function readCurrentTurn(sessionDir) {
  const file = join6(sessionDir, TURN_FILE);
  if (!existsSync7(file)) return 0;
  return Number.parseInt((await readFile7(file, TEXT_ENCODING)).trim(), 10) || 0;
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
async function readConsumedPromptState(sessionDir) {
  const file = join6(sessionDir, COMMITTED_PAIRS_FILE);
  const state = {
    legacyPromptIds: /* @__PURE__ */ new Set(),
    promptFilePairs: /* @__PURE__ */ new Set(),
    tailPromptIds: /* @__PURE__ */ new Set()
  };
  if (!existsSync7(file)) return state;
  const entries = await readJsonlEntries(file);
  for (const entry of entries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : void 0;
    if (!promptId) continue;
    if (entry.prompt_scope === "tail") {
      state.tailPromptIds.add(promptId);
      continue;
    }
    const filePath = typeof entry.file === "string" ? entry.file : void 0;
    if (filePath) {
      state.promptFilePairs.add(promptFilePairKey(promptId, filePath));
      continue;
    }
    if (entry.prompt_scope !== "window") {
      state.legacyPromptIds.add(promptId);
    }
  }
  return state;
}
function consumedKey(entry) {
  if (typeof entry.change_id === "string" && entry.change_id) {
    return `change:${entry.change_id}`;
  }
  if (entry.tool_use_id) return `id:${entry.tool_use_id}`;
  return `${entry.turn}:${entry.file}`;
}
async function recordConsumedPairs(sessionDir, changeEntries, preBlobEntries, commitFileSet, consumedPromptEntries = [], consumedTranscriptPromptFiles = []) {
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
  const promptFileSeen = /* @__PURE__ */ new Set();
  for (const entry of consumedTranscriptPromptFiles) {
    if (!entry.promptId || !entry.file || !commitFileSet.has(entry.file)) continue;
    const key = promptFilePairKey(entry.promptId, entry.file);
    if (promptFileSeen.has(key) || seen.has(key)) continue;
    promptFileSeen.add(key);
    await appendJsonl(pairsFile, {
      turn: entry.turn,
      prompt_id: entry.promptId,
      file: entry.file,
      change_id: null,
      tool_use_id: null
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
      prompt_scope: readPromptSelectionSource(entry) === "tail" ? "tail" : "window",
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
    if (entry.event !== NORMALIZED_EVENT_KINDS.response && entry.event !== NORMALIZED_EVENT_KINDS.stop)
      continue;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const response = typeof entry.response === "string" ? entry.response.trim() : "";
    if (!turn || !response) continue;
    const priority = entry.event === NORMALIZED_EVENT_KINDS.response ? 2 : 1;
    const current = responsesByTurn.get(turn);
    if (current && current.priority > priority) continue;
    responsesByTurn.set(turn, { response, priority });
  }
  return new Map([...responsesByTurn.entries()].map(([turn, value]) => [turn, value.response]));
}
async function readTranscriptCorrelationStartMs(sessionDir) {
  const eventsFile = join6(sessionDir, EVENTS_FILE);
  if (!existsSync7(eventsFile)) return null;
  const entries = await readJsonlEntries(eventsFile);
  let latestSessionStartMs = null;
  for (const entry of entries) {
    if (entry.event !== NORMALIZED_EVENT_KINDS.sessionStart) continue;
    const timestampMs = parseTimestampMs(entry.timestamp);
    if (timestampMs === null) continue;
    if (latestSessionStartMs === null || timestampMs > latestSessionStartMs) {
      latestSessionStartMs = timestampMs;
    }
  }
  return latestSessionStartMs;
}
async function readSessionModel(sessionDir) {
  const eventsFile = join6(sessionDir, EVENTS_FILE);
  if (!existsSync7(eventsFile)) return null;
  const entries = await readJsonlEntries(eventsFile);
  let fallbackModel = null;
  for (const e of entries) {
    if (e.event === NORMALIZED_EVENT_KINDS.sessionStart && typeof e.model === "string" && e.model) {
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

// src/paths.ts
import { join as join7 } from "node:path";
var _root = null;
var _gitDir = null;
async function root() {
  if (!_root) {
    try {
      _root = await repoRoot();
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

// src/commands/record.ts
import { existsSync as existsSync8 } from "node:fs";
import { mkdir as mkdir5, readFile as readFile8, stat as stat2 } from "node:fs/promises";
import { join as join8 } from "node:path";
var FALLBACK_HEAD_FLAG = "--fallback-head";
var FALLBACK_ENV_FLAG = "--fallback-env";
var ENV_AGENTNOTE_DEBUG = "AGENTNOTE_DEBUG";
var SESSION_ID_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
var UUID_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var RAW_DIFF_STATUS_RE = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) ([A-Z][0-9]*)$/;
var RAW_DIFF_RENAME_OR_COPY_PREFIXES = ["R", "C"];
async function record(args2) {
  try {
    if (args2[0] === FALLBACK_HEAD_FLAG) {
      await recordHeadFallback();
      return;
    }
    if (args2[0] === FALLBACK_ENV_FLAG) {
      await recordEnvironmentFallback();
      return;
    }
    const sessionId = args2[0];
    if (!sessionId) return;
    await recordCommitEntry({ agentnoteDirPath: await agentnoteDir(), sessionId });
  } catch (err) {
    console.error(`agent-note: warning: recording failed: ${err.message}`);
  }
}
async function recordHeadFallback() {
  if (await readHeadTrailerSessionId()) return;
  const agentnoteDirPath = await agentnoteDir();
  const sessionId = await readActiveSessionId(agentnoteDirPath);
  if (!sessionId) return;
  const sessionDir = join8(agentnoteDirPath, SESSIONS_DIR, sessionId);
  if (!await hasRecordableSessionData(sessionDir)) return;
  const headBlobs = await readHeadCommittedBlobs();
  if (!await hasSessionHeadBlobEvidence(sessionDir, headBlobs)) return;
  await recordCommitEntry({
    agentnoteDirPath,
    sessionId,
    requireAiFileEvidence: true
  });
}
async function recordEnvironmentFallback() {
  if (await hasHeadAgentNote()) {
    debugRecord("env fallback skipped: HEAD already has an Agent Note");
    return;
  }
  if (await readHeadTrailerSessionId())
    debugRecord("env fallback continuing after empty trailer record");
  const agentnoteDirPath = await agentnoteDir();
  const sessionId = await resolveEnvironmentSessionId(agentnoteDirPath);
  if (!sessionId) {
    debugRecord("env fallback skipped: no fresh environment session");
    return;
  }
  const result = await recordCommitEntry({
    agentnoteDirPath,
    sessionId,
    allowEnvironmentTranscriptFallback: true
  });
  debugRecord(`env fallback recorded ${result.promptCount} prompt(s), aiRatio=${result.aiRatio}`);
}
async function readActiveSessionId(agentnoteDirPath) {
  const activeSessionPath = join8(agentnoteDirPath, SESSION_FILE);
  if (!existsSync8(activeSessionPath)) return null;
  const sessionId = (await readFile8(activeSessionPath, TEXT_ENCODING)).trim();
  if (sessionId === "." || sessionId === "..") return null;
  return SESSION_ID_SEGMENT_RE.test(sessionId) ? sessionId : null;
}
async function hasHeadAgentNote() {
  const result = await gitSafe(["notes", `--ref=${NOTES_REF}`, "show", "HEAD"]);
  return result.exitCode === 0 && result.stdout.trim() !== "";
}
async function resolveEnvironmentSessionId(agentnoteDirPath) {
  for (const agentName of listAgents()) {
    const candidate = await resolveAgentEnvironmentSession(agentnoteDirPath, agentName);
    if (candidate) return candidate;
  }
  return null;
}
async function resolveAgentEnvironmentSession(agentnoteDirPath, agentName) {
  const adapter = getAgent(agentName);
  const sessionId = sanitizeSessionId(adapter.readEnvironmentSessionId?.() ?? void 0);
  if (!sessionId) return null;
  const sessionDir = join8(agentnoteDirPath, SESSIONS_DIR, sessionId);
  const existingAgent = await readSessionAgent(sessionDir);
  if (existingAgent && existingAgent !== agentName) return null;
  const savedTranscriptPath = await readSessionTranscriptPath(sessionDir);
  const transcriptPath = savedTranscriptPath ?? adapter.findTranscript(sessionId);
  if (!await hasFreshEnvironmentEvidence(sessionDir, transcriptPath)) {
    debugRecord(`env fallback skipped: no fresh evidence for ${agentName} ${sessionId}`);
    return null;
  }
  await mkdir5(sessionDir, { recursive: true });
  if (!existingAgent) await writeSessionAgent(sessionDir, agentName);
  if (!savedTranscriptPath && transcriptPath)
    await writeSessionTranscriptPath(sessionDir, transcriptPath);
  return sessionId;
}
function debugRecord(message) {
  if (process.env[ENV_AGENTNOTE_DEBUG]) console.error(`agent-note: debug: ${message}`);
}
function sanitizeSessionId(value) {
  const sessionId = value?.trim();
  if (!sessionId || sessionId === "." || sessionId === "..") return null;
  return UUID_SESSION_ID_RE.test(sessionId) ? sessionId.toLowerCase() : null;
}
async function hasFreshEnvironmentEvidence(sessionDir, transcriptPath) {
  if (await hasRecordableSessionData(sessionDir) && await isFreshFile(join8(sessionDir, HEARTBEAT_FILE))) {
    return true;
  }
  if (transcriptPath && await isFreshFile(transcriptPath)) return true;
  return false;
}
async function isFreshFile(filePath) {
  try {
    const stats = await stat2(filePath);
    if (!stats.isFile()) return false;
    const ageMs = Date.now() - stats.mtimeMs;
    return ageMs >= 0 && ageMs <= HEARTBEAT_TTL_SECONDS * MILLISECONDS_PER_SECOND;
  } catch {
    return false;
  }
}
async function readHeadCommittedBlobs() {
  const raw = await git(["diff-tree", "-z", "--raw", "--root", "--no-commit-id", "-r", "HEAD"]);
  return parseCommittedBlobs(raw);
}
async function readHeadTrailerSessionId() {
  return (await git(["log", "-1", `--format=%(trailers:key=${TRAILER_KEY},valueonly)`, "HEAD"])).trim();
}
function parseCommittedBlobs(output) {
  const blobs = /* @__PURE__ */ new Map();
  const fields = output.split("\0");
  for (let index = 0; index < fields.length; ) {
    const metadata = fields[index++];
    if (!metadata) continue;
    const match = metadata.match(RAW_DIFF_STATUS_RE);
    if (!match) continue;
    const [, blob, status2] = match;
    const pathCount = RAW_DIFF_RENAME_OR_COPY_PREFIXES.some((prefix) => status2.startsWith(prefix)) ? 2 : 1;
    let path = "";
    for (let pathIndex = 0; pathIndex < pathCount && index < fields.length; pathIndex++) {
      path = fields[index++] ?? "";
    }
    if (path) blobs.set(path, blob);
  }
  return blobs;
}

// src/commands/commit.ts
var AMEND_LIKE_COMMIT_ARGS = /* @__PURE__ */ new Set([
  "--amend",
  "-c",
  "-C",
  "--reuse-message",
  "--reedit-message"
]);
var AMEND_LIKE_COMMIT_ARG_PREFIXES = ["--reuse-message=", "--reedit-message="];
function isAmendLikeCommitArg(arg) {
  return AMEND_LIKE_COMMIT_ARGS.has(arg) || AMEND_LIKE_COMMIT_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix));
}
async function commit(args2) {
  const sf = await sessionFile();
  let sessionId = "";
  const skipAgentNoteRecording = args2.some((arg) => isAmendLikeCommitArg(arg));
  if (!skipAgentNoteRecording && existsSync9(sf)) {
    sessionId = (await readFile9(sf, TEXT_ENCODING)).trim();
    if (sessionId) {
      const dir = await agentnoteDir();
      const hbPath = join9(dir, SESSIONS_DIR, sessionId, HEARTBEAT_FILE);
      try {
        const hb = Number.parseInt((await readFile9(hbPath, TEXT_ENCODING)).trim(), 10);
        if (hb === 0 || Number.isNaN(hb)) {
          sessionId = "";
        } else {
          const ageSeconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND) - Math.floor(hb / MILLISECONDS_PER_SECOND);
          if (ageSeconds > HEARTBEAT_TTL_SECONDS) sessionId = "";
        }
      } catch {
        sessionId = "";
      }
      if (sessionId && !await hasRecordableSessionData(join9(dir, SESSIONS_DIR, sessionId))) {
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
  } else if (!skipAgentNoteRecording) {
    try {
      await recordHeadFallback();
      await recordEnvironmentFallback();
    } catch (err) {
      console.error(`agent-note: warning: fallback recording failed: ${err.message}`);
    }
  }
}

// src/commands/deinit.ts
import { existsSync as existsSync11 } from "node:fs";
import { readFile as readFile11, rename, unlink as unlink2 } from "node:fs/promises";
import { join as join11 } from "node:path";

// src/commands/init.ts
import { existsSync as existsSync10 } from "node:fs";
import { chmod, mkdir as mkdir6, readFile as readFile10, writeFile as writeFile7 } from "node:fs/promises";
import { isAbsolute as isAbsolute2, join as join10, resolve as resolve5 } from "node:path";
var PR_REPORT_WORKFLOW_FILENAME = "agentnote-pr-report.yml";
var DASHBOARD_WORKFLOW_FILENAME = "agentnote-dashboard.yml";
var [PREPARE_COMMIT_MSG_HOOK, POST_COMMIT_HOOK, PRE_PUSH_HOOK] = GIT_HOOK_NAMES;
var TRAILER_SESSION_FILE_LIST = TRAILER_SESSION_FILES.join(" ");
var ENV_CODEX_THREAD_ID2 = "CODEX_THREAD_ID";
var SHELL_CODEX_THREAD_ID = `$${ENV_CODEX_THREAD_ID2}`;
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
      - uses: wasabeef/AgentNote@v1
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
      should_deploy: \${{ steps.dashboard.outputs.should_deploy }}
    steps:
      - name: Build Dashboard bundle
        id: dashboard
        uses: wasabeef/AgentNote@v1
        with:
          dashboard: true

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
# Fail closed: no session file, no heartbeat, or no file evidence \u2192 skip.
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
FALLBACK_FILE="$GIT_DIR/agentnote/${POST_COMMIT_FALLBACK_FILE}"
rm -f "$FALLBACK_FILE" 2>/dev/null || true
case "$2" in commit) exit 0;; esac
SESSION_FILE="$GIT_DIR/agentnote/session"
if [ ! -f "$SESSION_FILE" ]; then exit 0; fi
SESSION_ID=$(cat "$SESSION_FILE" 2>/dev/null | tr -d '\\n')
if [ -z "$SESSION_ID" ]; then exit 0; fi
SESSION_DIR="$GIT_DIR/agentnote/sessions/$SESSION_ID"
# Check freshness via this session's heartbeat (< 1 hour).
HEARTBEAT_FILE="$SESSION_DIR/heartbeat"
if [ ! -f "$HEARTBEAT_FILE" ]; then exit 0; fi
NOW=$(date +%s)
HB=$(cat "$HEARTBEAT_FILE" 2>/dev/null | tr -d '\\n')
HB_SEC=\${HB%???}
AGE=$((NOW - HB_SEC))
HAS_TRAILER_DATA=0
for FILE_NAME in ${TRAILER_SESSION_FILE_LIST}; do
  if [ -s "$SESSION_DIR/$FILE_NAME" ]; then
    HAS_TRAILER_DATA=1
    break
  fi
done
if [ "$HAS_TRAILER_DATA" -ne 1 ]; then exit 0; fi
if [ "$AGE" -gt ${HEARTBEAT_TTL_SECONDS} ] 2>/dev/null; then
  printf '%s\\n' '${POST_COMMIT_FALLBACK_HEAD}' > "$FALLBACK_FILE" 2>/dev/null || true
  exit 0
fi
if ! grep -q "${TRAILER_KEY}" "$1" 2>/dev/null; then
  echo "" >> "$1"
  echo "${TRAILER_KEY}: $SESSION_ID" >> "$1"
fi
`;
var POST_COMMIT_SCRIPT = `#!/bin/sh
${AGENTNOTE_HOOK_MARKER}
# Record agentnote entry as a git note on HEAD.
# Prefer the finalized trailer as the source of truth. If no trailer was
# injected because the session heartbeat was stale, the CLI may use a strict
# HEAD fallback that only records when session file evidence matches HEAD.
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
SESSION_ID=$(git log -1 --format='%(trailers:key=${TRAILER_KEY},valueonly)' HEAD 2>/dev/null | tr -d '\\n')
if [ -z "$SESSION_ID" ]; then
  FALLBACK_FILE="$GIT_DIR/agentnote/${POST_COMMIT_FALLBACK_FILE}"
  if [ -f "$FALLBACK_FILE" ] && [ "$(cat "$FALLBACK_FILE" 2>/dev/null | tr -d '\\n')" = "${POST_COMMIT_FALLBACK_HEAD}" ]; then
    SESSION_ID="--fallback-head"
  elif [ -n "${SHELL_CODEX_THREAD_ID}" ]; then
    SESSION_ID="--fallback-env"
  else
    exit 0
  fi
  rm -f "$FALLBACK_FILE" 2>/dev/null || true
fi
record_agentnote() {
  RECORD_SESSION_ID="$1"
  if [ -z "$RECORD_SESSION_ID" ]; then return; fi
  # Prefer the repo-local shim created at init time so post-commit uses the
  # exact CLI version that generated these hooks.
  if [ -x "$GIT_DIR/agentnote/bin/agent-note" ]; then
    "$GIT_DIR/agentnote/bin/agent-note" record "$RECORD_SESSION_ID" 2>/dev/null || true
    return
  fi
  # Fall back to stable local/global binaries only.
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -f "$REPO_ROOT/node_modules/.bin/agent-note" ]; then
    "$REPO_ROOT/node_modules/.bin/agent-note" record "$RECORD_SESSION_ID" 2>/dev/null || true
  elif command -v agent-note >/dev/null 2>&1; then
    agent-note record "$RECORD_SESSION_ID" 2>/dev/null || true
  fi
}

record_agentnote "$SESSION_ID"
if [ "$SESSION_ID" != "--fallback-env" ] && [ -n "${SHELL_CODEX_THREAD_ID}" ] && ! git notes --ref=${NOTES_REF} show HEAD >/dev/null 2>&1; then
  record_agentnote "--fallback-env"
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
  await mkdir6(await agentnoteDir(), { recursive: true });
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
    await mkdir6(hookDir, { recursive: true });
    const installed = await installGitHook(
      hookDir,
      PREPARE_COMMIT_MSG_HOOK,
      PREPARE_COMMIT_MSG_SCRIPT
    );
    results.push(
      installed ? `  \u2713 git hook: ${PREPARE_COMMIT_MSG_HOOK}` : `  \xB7 git hook: ${PREPARE_COMMIT_MSG_HOOK} (exists)`
    );
    const installed2 = await installGitHook(hookDir, POST_COMMIT_HOOK, POST_COMMIT_SCRIPT);
    results.push(
      installed2 ? `  \u2713 git hook: ${POST_COMMIT_HOOK}` : `  \xB7 git hook: ${POST_COMMIT_HOOK} (exists)`
    );
    const installed3 = await installGitHook(hookDir, PRE_PUSH_HOOK, PRE_PUSH_SCRIPT);
    results.push(
      installed3 ? `  \u2713 git hook: ${PRE_PUSH_HOOK} (auto-push notes)` : `  \xB7 git hook: ${PRE_PUSH_HOOK} (exists)`
    );
  }
  if (!skipAction && !hooksOnly) {
    const workflowDir = join10(repoRoot3, ".github", "workflows");
    const prReportWorkflowPath = join10(workflowDir, PR_REPORT_WORKFLOW_FILENAME);
    await mkdir6(workflowDir, { recursive: true });
    if (existsSync10(prReportWorkflowPath)) {
      results.push(
        `  \xB7 workflow already exists at .github/workflows/${PR_REPORT_WORKFLOW_FILENAME}`
      );
    } else {
      await writeFile7(prReportWorkflowPath, PR_REPORT_WORKFLOW_TEMPLATE);
      results.push(`  \u2713 workflow created at .github/workflows/${PR_REPORT_WORKFLOW_FILENAME}`);
    }
    if (dashboard) {
      const dashboardWorkflowPath = join10(workflowDir, DASHBOARD_WORKFLOW_FILENAME);
      if (existsSync10(dashboardWorkflowPath)) {
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
    const prReportWorkflowPath = join10(
      repoRoot3,
      ".github",
      "workflows",
      PR_REPORT_WORKFLOW_FILENAME
    );
    if (existsSync10(prReportWorkflowPath)) {
      toCommit.push(`.github/workflows/${PR_REPORT_WORKFLOW_FILENAME}`);
    }
    if (dashboard) {
      const dashboardWorkflowPath = join10(
        repoRoot3,
        ".github",
        "workflows",
        DASHBOARD_WORKFLOW_FILENAME
      );
      if (existsSync10(dashboardWorkflowPath)) {
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
    if (agents.includes(AGENT_NAMES.cursor)) {
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
    if (hooksPath) return isAbsolute2(hooksPath) ? hooksPath : join10(repoRoot3, hooksPath);
  } catch {
  }
  const gitDir2 = await git(["rev-parse", "--git-dir"]);
  return join10(gitDir2, "hooks");
}
function shellSingleQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
async function installLocalCliShim(agentnoteDirPath) {
  if (!process.argv[1]) return;
  const shimDir = join10(agentnoteDirPath, "bin");
  const shimPath = join10(shimDir, "agent-note");
  const cliPath = resolve5(process.argv[1]);
  const shim = `#!/bin/sh
exec ${shellSingleQuote(process.execPath)} ${shellSingleQuote(cliPath)} "$@"
`;
  await mkdir6(shimDir, { recursive: true });
  await writeFile7(shimPath, shim);
  await chmod(shimPath, 493);
}
async function installGitHook(hookDir, name, script) {
  const hookPath = join10(hookDir, name);
  if (existsSync10(hookPath)) {
    const existing = await readFile10(hookPath, TEXT_ENCODING);
    if (existing.includes(AGENTNOTE_HOOK_MARKER)) {
      const backupPath2 = `${hookPath}.agentnote-backup`;
      const target = existsSync10(backupPath2) ? script.replace(
        "#!/bin/sh",
        `#!/bin/sh
# Chain to original hook \u2014 preserve exit status.
if [ -f ${shellSingleQuote(backupPath2)} ]; then ${shellSingleQuote(backupPath2)} "$@" || exit $?; fi`
      ) : script;
      if (existing.trim() === target.trim()) return false;
      await writeFile7(hookPath, target);
      await chmod(hookPath, 493);
      return true;
    }
    const backupPath = `${hookPath}.agentnote-backup`;
    if (!existsSync10(backupPath)) {
      await writeFile7(backupPath, existing);
      await chmod(backupPath, 493);
    }
    const chainedScript = script.replace(
      "#!/bin/sh",
      `#!/bin/sh
# Chain to original hook \u2014 preserve exit status.
if [ -f ${shellSingleQuote(backupPath)} ]; then ${shellSingleQuote(backupPath)} "$@" || exit $?; fi`
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
async function removeGitHook(hookDir, name) {
  const hookPath = join11(hookDir, name);
  if (!existsSync11(hookPath)) return false;
  const content = await readFile11(hookPath, TEXT_ENCODING);
  if (!content.includes(AGENTNOTE_HOOK_MARKER)) return false;
  const backupPath = `${hookPath}.agentnote-backup`;
  if (existsSync11(backupPath)) {
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
    const binDir = join11(await agentnoteDir(), "bin");
    const shimPath = join11(binDir, "agent-note");
    if (existsSync11(shimPath)) {
      await unlink2(shimPath);
      results.push("  \u2713 removed local CLI shim");
    }
    if (removeWorkflow) {
      const workflowPaths = [
        join11(repoRoot3, ".github", "workflows", PR_REPORT_WORKFLOW_FILENAME),
        join11(repoRoot3, ".github", "workflows", DASHBOARD_WORKFLOW_FILENAME)
      ];
      for (const workflowPath of workflowPaths) {
        if (!existsSync11(workflowPath)) continue;
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
import { randomUUID } from "node:crypto";
import { existsSync as existsSync13 } from "node:fs";
import { mkdir as mkdir7, readFile as readFile12, realpath, unlink as unlink3, writeFile as writeFile8 } from "node:fs/promises";
import { isAbsolute as isAbsolute3, join as join13, relative as relative2 } from "node:path";

// src/core/rotate.ts
import { existsSync as existsSync12 } from "node:fs";
import { rename as rename2 } from "node:fs/promises";
import { join as join12 } from "node:path";
async function rotateLogs(sessionDir, rotateId, fileNames = [PROMPTS_FILE, CHANGES_FILE]) {
  for (const name of fileNames) {
    const src = join12(sessionDir, name);
    if (existsSync12(src)) {
      const base = name.replace(".jsonl", "");
      await rename2(src, join12(sessionDir, `${base}-${rotateId}.jsonl`));
    }
  }
}

// src/commands/hook.ts
var CLAUDE_PRE_TOOL_USE_EVENT = "PreToolUse";
var CURSOR_BEFORE_SUBMIT_PROMPT_EVENT = "beforeSubmitPrompt";
var CURSOR_BEFORE_SHELL_EXECUTION_EVENT = "beforeShellExecution";
var GEMINI_BEFORE_TOOL_EVENT = "BeforeTool";
var GEMINI_ALLOW_DECISION = "allow";
var JSON_INDENT_SPACES = 2;
var PRE_BLOB_EVENT = "pre_blob";
var SYNCHRONOUS_HOOK_EVENTS = /* @__PURE__ */ new Set([
  CLAUDE_PRE_TOOL_USE_EVENT,
  CURSOR_BEFORE_SUBMIT_PROMPT_EVENT,
  CURSOR_BEFORE_SHELL_EXECUTION_EVENT,
  GEMINI_BEFORE_TOOL_EVENT
]);
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSynchronousHookEvent(value) {
  if (!isRecord4(value) || typeof value.hook_event_name !== "string") return false;
  return SYNCHRONOUS_HOOK_EVENTS.has(value.hook_event_name);
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
    if (!existsSync13(absPath)) return EMPTY_BLOB;
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
  return Buffer.concat(chunks).toString(TEXT_ENCODING);
}
async function readCurrentTurn2(sessionDir) {
  const turnPath = join13(sessionDir, TURN_FILE);
  if (!existsSync13(turnPath)) return 0;
  const raw = (await readFile12(turnPath, TEXT_ENCODING)).trim();
  return Number.parseInt(raw, 10) || 0;
}
async function readCurrentPromptId(sessionDir) {
  const p = join13(sessionDir, PROMPT_ID_FILE);
  if (!existsSync13(p)) return null;
  const raw = (await readFile12(p, TEXT_ENCODING)).trim();
  return raw || null;
}
async function readCurrentHead() {
  try {
    return (await git(["rev-parse", "HEAD"])).trim();
  } catch {
    return null;
  }
}
async function refreshHeartbeat(agentnoteDirPath, sessionId, opts = {}) {
  const heartbeatPath = join13(agentnoteDirPath, SESSIONS_DIR, sessionId, HEARTBEAT_FILE);
  if (opts.onlyIfExists && !existsSync13(heartbeatPath)) return;
  await writeFile8(heartbeatPath, String(Date.now()));
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
        await refreshHeartbeat(dir, peekSid, { onlyIfExists: true });
      } catch {
      }
    }
    if (adapter.name === AGENT_NAMES.gemini && input.sync) {
      if (isRecord4(peek) && peek.hook_event_name === GEMINI_BEFORE_TOOL_EVENT) {
        process.stdout.write(JSON.stringify({ decision: GEMINI_ALLOW_DECISION }));
      }
    }
    return;
  }
  const agentnoteDirPath = await agentnoteDir();
  const sessionDir = join13(agentnoteDirPath, SESSIONS_DIR, event.sessionId);
  await mkdir7(sessionDir, { recursive: true });
  if (!(adapter.name === AGENT_NAMES.gemini && event.kind === NORMALIZED_EVENT_KINDS.stop)) {
    await refreshHeartbeat(agentnoteDirPath, event.sessionId);
  }
  switch (event.kind) {
    case NORMALIZED_EVENT_KINDS.sessionStart: {
      await writeFile8(join13(agentnoteDirPath, SESSION_FILE), event.sessionId);
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      await appendJsonl(join13(sessionDir, EVENTS_FILE), {
        event: NORMALIZED_EVENT_KINDS.sessionStart,
        session_id: event.sessionId,
        timestamp: event.timestamp,
        agent: adapter.name,
        model: event.model ?? null
      });
      break;
    }
    case NORMALIZED_EVENT_KINDS.stop: {
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      const turn = await readCurrentTurn2(sessionDir);
      await appendJsonl(join13(sessionDir, EVENTS_FILE), {
        event: NORMALIZED_EVENT_KINDS.stop,
        session_id: event.sessionId,
        timestamp: event.timestamp,
        turn,
        response: event.response ?? null
      });
      if (adapter.name === AGENT_NAMES.gemini) {
        try {
          await unlink3(join13(sessionDir, HEARTBEAT_FILE));
        } catch {
        }
      }
      break;
    }
    case NORMALIZED_EVENT_KINDS.prompt: {
      await writeFile8(join13(agentnoteDirPath, SESSION_FILE), event.sessionId);
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      const eventsPath = join13(sessionDir, EVENTS_FILE);
      if (!existsSync13(eventsPath)) {
        await appendJsonl(eventsPath, {
          event: NORMALIZED_EVENT_KINDS.sessionStart,
          session_id: event.sessionId,
          timestamp: event.timestamp,
          agent: adapter.name,
          model: event.model ?? null
        });
      }
      const rotateId = Date.now().toString(36);
      await rotateLogs(sessionDir, rotateId, [PROMPTS_FILE, CHANGES_FILE, PRE_BLOBS_FILE]);
      const turnPath = join13(sessionDir, TURN_FILE);
      let turn = await readCurrentTurn2(sessionDir);
      turn += 1;
      await writeFile8(turnPath, String(turn));
      const promptId = randomUUID();
      await writeFile8(join13(sessionDir, PROMPT_ID_FILE), promptId);
      await appendJsonl(join13(sessionDir, PROMPTS_FILE), {
        event: NORMALIZED_EVENT_KINDS.prompt,
        timestamp: event.timestamp,
        prompt: event.prompt,
        prompt_id: promptId,
        turn
      });
      await appendJsonl(eventsPath, {
        event: NORMALIZED_EVENT_KINDS.prompt,
        session_id: event.sessionId,
        timestamp: event.timestamp,
        prompt_id: promptId,
        turn,
        model: event.model ?? null
      });
      if (adapter.name === AGENT_NAMES.cursor) {
        process.stdout.write(JSON.stringify({ continue: true }));
      }
      break;
    }
    case NORMALIZED_EVENT_KINDS.response: {
      const turn = await readCurrentTurn2(sessionDir);
      await appendJsonl(join13(sessionDir, EVENTS_FILE), {
        event: NORMALIZED_EVENT_KINDS.response,
        session_id: event.sessionId,
        timestamp: event.timestamp,
        turn,
        response: event.response ?? null
      });
      break;
    }
    case NORMALIZED_EVENT_KINDS.preEdit: {
      const absPath = event.file ?? "";
      const filePath = await normalizeToRepoRelative(absPath);
      const turn = await readCurrentTurn2(sessionDir);
      const promptId = await readCurrentPromptId(sessionDir);
      const preBlob = isAbsolute3(absPath) ? await blobHash(absPath) : EMPTY_BLOB;
      await appendJsonl(join13(sessionDir, PRE_BLOBS_FILE), {
        event: PRE_BLOB_EVENT,
        turn,
        prompt_id: promptId,
        file: filePath,
        blob: preBlob,
        // tool_use_id links this pre-blob to its PostToolUse counterpart,
        // enabling correct pairing even when async hooks fire out of order.
        tool_use_id: event.toolUseId ?? null
      });
      if (adapter.name === AGENT_NAMES.gemini) {
        process.stdout.write(JSON.stringify({ decision: GEMINI_ALLOW_DECISION }));
      }
      break;
    }
    case NORMALIZED_EVENT_KINDS.fileChange: {
      const absPath = event.file ?? "";
      const filePath = await normalizeToRepoRelative(absPath);
      const turn = await readCurrentTurn2(sessionDir);
      const promptId = await readCurrentPromptId(sessionDir);
      const postBlob = isAbsolute3(absPath) ? await blobHash(absPath) : EMPTY_BLOB;
      const changeId = adapter.name === AGENT_NAMES.cursor ? `${event.timestamp}:${event.tool ?? NORMALIZED_EVENT_KINDS.fileChange}:${filePath}:${postBlob}` : null;
      await appendJsonl(join13(sessionDir, CHANGES_FILE), {
        event: NORMALIZED_EVENT_KINDS.fileChange,
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
    case NORMALIZED_EVENT_KINDS.preCommit: {
      if (adapter.name === AGENT_NAMES.gemini) {
        const headBefore = await readCurrentHead();
        await writeFile8(
          join13(sessionDir, PENDING_COMMIT_FILE),
          `${JSON.stringify(
            {
              command: event.commitCommand ?? "",
              head_before: headBefore,
              timestamp: event.timestamp
            },
            null,
            JSON_INDENT_SPACES
          )}
`
        );
        process.stdout.write(JSON.stringify({ decision: GEMINI_ALLOW_DECISION }));
        break;
      }
      if (adapter.name === AGENT_NAMES.cursor) {
        const headBefore = await readCurrentHead();
        await writeFile8(
          join13(sessionDir, PENDING_COMMIT_FILE),
          `${JSON.stringify(
            {
              command: event.commitCommand ?? "",
              head_before: headBefore,
              timestamp: event.timestamp
            },
            null,
            JSON_INDENT_SPACES
          )}
`
        );
        process.stdout.write(JSON.stringify({ continue: true }));
        break;
      }
      const cmd = event.commitCommand ?? "";
      if (!cmd.includes(TRAILER_KEY) && event.sessionId && await hasRecordableSessionData(sessionDir)) {
        const trailer = `--trailer '${TRAILER_KEY}: ${event.sessionId}'`;
        const updatedCmd = injectGitCommitTrailer(cmd, trailer);
        if (updatedCmd) {
          process.stdout.write(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: CLAUDE_PRE_TOOL_USE_EVENT,
                updatedInput: {
                  command: updatedCmd
                }
              }
            })
          );
        }
      }
      break;
    }
    case NORMALIZED_EVENT_KINDS.postCommit: {
      if (adapter.name === AGENT_NAMES.cursor || adapter.name === AGENT_NAMES.gemini) {
        const pendingPath = join13(sessionDir, PENDING_COMMIT_FILE);
        if (!existsSync13(pendingPath)) break;
        let headBefore = null;
        try {
          const pending = JSON.parse(await readFile12(pendingPath, TEXT_ENCODING));
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
async function log(count = DEFAULT_LOG_COUNT) {
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
var GITHUB_REPOSITORY_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/;
var GITHUB_CLI_BINARY = "gh";
var GITHUB_CLI_API_COMMAND = "api";
var GITHUB_CLI_PR_COMMAND = "pr";
var GITHUB_CLI_PR_COMMENT_COMMAND = "comment";
var GITHUB_CLI_PR_VIEW_COMMAND = "view";
var GITHUB_CLI_JSON_FLAG = "--json";
var GITHUB_CLI_BODY_FLAG = "--body";
var PR_QUERY_PARAM = "pr";
var TEXT_ENCODING2 = "utf-8";
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
function inferDashboardUrl(repoUrl, prNumber) {
  if (!repoUrl) return null;
  const normalized = repoUrl.replace(/\.git$/, "");
  const match = normalized.match(GITHUB_REPOSITORY_URL_PATTERN);
  if (!match) return null;
  const [, owner, repo] = match;
  const pagesRoot = `https://${owner}.github.io`;
  const dashboardUrl = repo === `${owner}.github.io` ? `${pagesRoot}/dashboard/` : `${pagesRoot}/${repo}/dashboard/`;
  return appendPrNumber(dashboardUrl, prNumber);
}
function appendPrNumber(dashboardUrl, prNumber) {
  if (prNumber == null || prNumber === "") return dashboardUrl;
  const normalized = Number(prNumber);
  if (!Number.isInteger(normalized) || normalized <= 0) return dashboardUrl;
  const url = new URL(dashboardUrl);
  url.searchParams.set(PR_QUERY_PARAM, String(normalized));
  return url.toString();
}
async function updatePrDescription(prNumber, markdown) {
  const currentBody = await readPrBody(prNumber);
  const newBody = upsertDescription(currentBody, markdown);
  await execFileAsync2("gh", ["pr", "edit", prNumber, "--body", newBody], {
    encoding: TEXT_ENCODING2
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
      { encoding: TEXT_ENCODING2 }
    );
    const commentId = stdout.trim().split("\n")[0];
    if (commentId) {
      await execFileAsync2(
        GITHUB_CLI_BINARY,
        [
          GITHUB_CLI_API_COMMAND,
          "-X",
          "PATCH",
          `/repos/{owner}/{repo}/issues/comments/${commentId}`,
          "-f",
          `body=${body}`
        ],
        { encoding: TEXT_ENCODING2 }
      );
      return;
    }
  } catch {
  }
  await execFileAsync2(
    GITHUB_CLI_BINARY,
    [GITHUB_CLI_PR_COMMAND, GITHUB_CLI_PR_COMMENT_COMMAND, prNumber, GITHUB_CLI_BODY_FLAG, body],
    {
      encoding: TEXT_ENCODING2
    }
  );
}
async function readPrBody(prNumber) {
  const { stdout } = await execFileAsync2(
    GITHUB_CLI_BINARY,
    [GITHUB_CLI_PR_COMMAND, GITHUB_CLI_PR_VIEW_COMMAND, prNumber, GITHUB_CLI_JSON_FLAG, "body"],
    { encoding: TEXT_ENCODING2 }
  );
  return JSON.parse(stdout).body ?? "";
}

// ../pr-report/src/report.ts
import { existsSync as existsSync14 } from "node:fs";
import { join as join14 } from "node:path";
var AI_RATIO_HEADER_BAR_WIDTH = 8;
var AI_RATIO_TABLE_BAR_WIDTH = 5;
var PERCENT_DENOMINATOR2 = 100;
var DEFAULT_PROGRESS_BAR_WIDTH = AI_RATIO_HEADER_BAR_WIDTH;
var DEFAULT_BASE_BRANCH_CANDIDATES = ["main", "master", "develop"];
var OVERALL_METHODS = {
  line: "line",
  file: "file",
  mixed: "mixed",
  none: "none"
};
var CONTEXT_KIND_ORDER2 = {
  reference: 0,
  scope: 1
};
var MIN_PROMPT_BODY_LINE_CHARS = 10;
var REVIEWER_CONTEXT_MAX_CHANGED_AREAS = 4;
var REVIEWER_CONTEXT_MAX_AREA_FILES = 3;
var REVIEWER_CONTEXT_MAX_COMMIT_INTENT_SIGNALS = 2;
var REVIEWER_CONTEXT_MAX_INTENT_SIGNALS = 4;
var REVIEWER_CONTEXT_MAX_REVIEW_FOCUS = 4;
var REVIEWER_CONTEXT_SNIPPET_MAX_LENGTH = 150;
var REVIEWER_CONTEXT_COMMENT_BEGIN = "<!-- agentnote-reviewer-context";
var REVIEWER_CONTEXT_COMMENT_END = "-->";
var REVIEWER_AREA_RULES = [
  {
    id: "tests",
    label: "Tests",
    matches: (path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes("/__tests__/") || path.includes("/test/") || path.includes("/tests/") || path.startsWith("test/") || path.startsWith("tests/")
  },
  {
    id: "workflow",
    label: "Workflows",
    matches: (path) => path === "action.yml" || path === "action.yaml" || path.startsWith(".github/workflows/") || path.startsWith(".github/actions/") || path === ".github/dependabot.yml"
  },
  {
    id: "docs",
    label: "Documentation",
    matches: (path) => path === "README.md" || /^README\.[a-z-]+\.md$/i.test(path) || path.startsWith("docs/") || path.startsWith("website/src/content/docs/") || /\.(md|mdx|rst|adoc)$/i.test(path)
  },
  {
    id: "dependencies",
    label: "Dependencies",
    matches: (path) => path === "package.json" || path === "package-lock.json" || path === "pnpm-lock.yaml" || path === "yarn.lock" || path === "bun.lock" || path === "Cargo.toml" || path === "Cargo.lock" || path === "go.mod" || path === "go.sum" || path === "Gemfile" || path === "Gemfile.lock" || path === "pyproject.toml" || path === "poetry.lock" || path.endsWith("/package.json") || path.endsWith("/package-lock.json")
  },
  {
    id: "config",
    label: "Configuration",
    matches: (path) => /(^|\/)(tsconfig|jsconfig|eslint|prettier|biome|vite|webpack|rollup|astro|next|nuxt|tailwind|postcss|babel|jest|vitest|playwright|cypress|docker-compose)(\.|$)/i.test(
      path
    ) || path === "Dockerfile" || path.endsWith(".config.js") || path.endsWith(".config.ts") || path.endsWith(".config.mjs") || path.endsWith(".config.cjs")
  },
  {
    id: "generated",
    label: "Generated outputs",
    matches: (path) => path.includes("/dist/") || path.startsWith("dist/") || path.includes("/build/") || path.startsWith("build/") || path.endsWith(".generated.ts") || path.endsWith(".generated.js") || path.includes("/generated/")
  },
  {
    id: "scripts",
    label: "Scripts",
    matches: (path) => path.startsWith("scripts/") || path.startsWith("tools/") || path.startsWith("bin/") || path.includes("/scripts/")
  },
  {
    id: "frontend",
    label: "Frontend",
    matches: (path) => path.startsWith("src/components/") || path.startsWith("src/pages/") || path.startsWith("src/app/") || path.startsWith("src/styles/") || path.startsWith("public/") || path.includes("/components/") || path.includes("/pages/") || path.includes("/app/") || path.includes("/styles/") || /\.(css|scss|sass|less|astro|svelte|vue)$/i.test(path)
  },
  {
    id: "backend",
    label: "Backend",
    matches: (path) => path.startsWith("api/") || path.startsWith("server/") || path.startsWith("routes/") || path.startsWith("controllers/") || path.startsWith("models/") || path.includes("/api/") || path.includes("/server/") || path.includes("/routes/") || path.includes("/controllers/") || path.includes("/models/")
  },
  {
    id: "source",
    label: "Source",
    matches: () => true
  }
];
var REVIEW_FOCUS_BY_AREA = {
  docs: "Check that docs and examples match the implemented behavior without exposing internal development terminology.",
  tests: "Check that tests cover behavior, edge cases, and regression risks rather than only snapshots.",
  workflow: "Check that automation is safe for forks, retries, permissions, and existing deployment workflows.",
  dependencies: "Check that dependency or package metadata changes are intentional and compatible with release expectations.",
  config: "Check that configuration changes are scoped, documented, and consistent with the affected tooling.",
  generated: "Check that generated outputs are consistent with source changes and were not hand-edited accidentally.",
  scripts: "Check that scripts remain safe, idempotent, and clear about the files or services they touch.",
  frontend: "Check user-facing behavior, accessibility, layout, and build output for the changed UI paths.",
  backend: "Check API or server behavior, data handling, error paths, and compatibility with existing clients.",
  source: "Compare the stated intent with the changed source files and the prompt evidence below."
};
async function collectReport(base, headRef = "HEAD", opts = {}) {
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
    (commit2) => commit2.attribution?.method === OVERALL_METHODS.line && commit2.attribution.lines && commit2.attribution.lines.total_added > 0
  );
  const fileOnly = tracked.filter((commit2) => commit2.attribution?.method === OVERALL_METHODS.file);
  const excluded = tracked.filter((commit2) => commit2.attribution?.method === OVERALL_METHODS.none);
  const eligible = [...lineEligible, ...fileOnly];
  let overallMethod;
  if (tracked.length > 0 && excluded.length === tracked.length) {
    overallMethod = OVERALL_METHODS.none;
  } else if (eligible.length === 0) {
    overallMethod = OVERALL_METHODS.none;
  } else if (fileOnly.length === 0 && lineEligible.length > 0) {
    overallMethod = OVERALL_METHODS.line;
  } else if (lineEligible.length === 0) {
    overallMethod = OVERALL_METHODS.file;
  } else {
    overallMethod = OVERALL_METHODS.mixed;
  }
  let overallAiRatio;
  if (overallMethod === OVERALL_METHODS.line) {
    const aiAdded = lineEligible.reduce(
      (sum, commit2) => sum + (commit2.attribution?.lines?.ai_added ?? 0),
      0
    );
    const totalAdded = lineEligible.reduce(
      (sum, commit2) => sum + (commit2.attribution?.lines?.total_added ?? 0),
      0
    );
    overallAiRatio = totalAdded > 0 ? Math.round(aiAdded / totalAdded * PERCENT_DENOMINATOR2) : 0;
  } else if (overallMethod === OVERALL_METHODS.file) {
    const eligibleFiles = eligible.reduce((sum, commit2) => sum + commit2.files_total, 0);
    const eligibleFilesAi = eligible.reduce((sum, commit2) => sum + commit2.files_ai, 0);
    overallAiRatio = eligibleFiles > 0 ? Math.round(eligibleFilesAi / eligibleFiles * PERCENT_DENOMINATOR2) : 0;
  } else if (overallMethod === OVERALL_METHODS.mixed) {
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
  const hasDashboardWorkflow = existsSync14(
    join14(repoRoot3, ".github", "workflows", "agentnote-dashboard.yml")
  );
  const dashboardUrl = hasDashboardWorkflow ? inferDashboardUrl(repoUrl, opts.dashboardPrNumber) : null;
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
function renderProgressBar(ratio, width = DEFAULT_PROGRESS_BAR_WIDTH) {
  const normalizedRatio = Math.min(PERCENT_DENOMINATOR2, Math.max(0, ratio));
  const filled = Math.round(normalizedRatio / PERCENT_DENOMINATOR2 * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}
function renderRatioWithBar(ratio, width) {
  return `${renderProgressBar(ratio, width)} ${ratio}%`;
}
function renderHeader(report) {
  if (report.total_commits > 0 && report.tracked_commits === 0) {
    return ["**Total AI Ratio:** \u2014", "**Agent Note data:** No tracked commits"];
  }
  const line1 = `**Total AI Ratio:** ${renderRatioWithBar(
    report.overall_ai_ratio,
    AI_RATIO_HEADER_BAR_WIDTH
  )}`;
  const lines = [line1];
  if (report.model) {
    lines.push(`**Model:** \`${report.model}\``);
  }
  return lines;
}
function renderMarkdown(report, opts = {}) {
  const promptDetail = opts.promptDetail ?? DEFAULT_PROMPT_DETAIL;
  const lines = [];
  const visibleInteractionsBySha = /* @__PURE__ */ new Map();
  let visiblePromptCount = 0;
  for (const commit2 of report.commits) {
    const interactions = filterInteractionsByPromptDetail(
      mergePromptOnlyDisplayInteractions(commit2.interactions),
      promptDetail
    );
    visibleInteractionsBySha.set(commit2.sha, interactions);
    visiblePromptCount += interactions.length;
  }
  lines.push("## \u{1F9D1}\u{1F4AC}\u{1F916} Agent Note");
  lines.push("");
  lines.push(...renderHeader(report));
  lines.push("");
  const reviewerContext = renderReviewerContext(report, visibleInteractionsBySha);
  if (reviewerContext.length > 0) {
    lines.push(...reviewerContext);
  }
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
      commit2.files.map((file) => `${basename2(file.path)} ${file.by_ai ? "\u{1F916}" : "\u{1F464}"}`).join(", ")
    );
    const aiRatioCell = renderRatioWithBar(commit2.ai_ratio, AI_RATIO_TABLE_BAR_WIDTH);
    lines.push(
      `| ${commitCell} | ${aiRatioCell} | ${commit2.prompts_count} | ${fileList} |`
    );
  }
  lines.push("");
  if (report.dashboard_url) {
    lines.push(
      `<div align="right"><a href="${report.dashboard_url}" target="_blank" rel="noopener noreferrer">Open Dashboard \u2197</a></div>`
    );
    if (report.dashboard_preview_help_url) {
      lines.push(
        `<div align="right"><sub><a href="${report.dashboard_preview_help_url}">About PR previews</a></sub></div>`
      );
    }
    lines.push("");
  }
  const withPrompts = report.commits.filter(
    (commit2) => (visibleInteractionsBySha.get(commit2.sha)?.length ?? 0) > 0
  );
  if (report.total_prompts > 0) {
    lines.push("<details>");
    lines.push(
      `<summary>\u{1F4AC} Prompts & Responses (${renderPromptSummary(visiblePromptCount, report.total_prompts, promptDetail)})</summary>`
    );
    lines.push("");
    if (withPrompts.length === 0) {
      lines.push(
        `_No prompts are shown at the current \`prompt_detail\` setting. Use \`full\` to show every stored prompt._`
      );
      lines.push("");
    } else {
      for (const commit2 of withPrompts) {
        lines.push(`### ${commitLink(commit2, report.repo_url)} ${commit2.message}`);
        lines.push("");
        for (const interaction of visibleInteractionsBySha.get(commit2.sha) ?? []) {
          const context = renderInteractionContext(interaction);
          if (context) {
            pushBlockquoteSection(lines, "\u{1F4DD} Context", cleanContext(context));
            lines.push(">");
          }
          const cleaned = cleanPrompt(interaction.prompt, TRUNCATE_PROMPT_PR);
          pushBlockquoteSection(lines, "\u{1F9D1} Prompt", cleaned);
          if (interaction.response) {
            const truncated = interaction.response.length > TRUNCATE_RESPONSE_PR ? `${interaction.response.slice(0, TRUNCATE_RESPONSE_PR)}\u2026` : interaction.response;
            lines.push(">");
            pushBlockquoteSection(lines, "\u{1F916} Response", truncated);
          }
          lines.push("");
        }
      }
    }
    lines.push("</details>");
  }
  return lines.join("\n");
}
function renderReviewerContext(report, visibleInteractionsBySha) {
  if (report.tracked_commits === 0) return [];
  const changedAreas = collectReviewerChangedAreas(report);
  const reviewFocus = collectReviewerFocus(changedAreas);
  const intentSignals = collectReviewerIntentSignals(report, visibleInteractionsBySha);
  if (changedAreas.length === 0 && reviewFocus.length === 0 && intentSignals.length === 0) {
    return [];
  }
  const body = [
    "Generated from Agent Note data. Use this as intent and review focus, not as proof that the implementation is correct.",
    ""
  ];
  if (changedAreas.length > 0) {
    body.push("Changed areas:", "");
    for (const area of changedAreas) {
      body.push(`- ${area.label}: ${formatReviewerAreaFiles(area)}`);
    }
    body.push("");
  }
  if (reviewFocus.length > 0) {
    body.push("Review focus:", "");
    for (const focus of reviewFocus) {
      body.push(`- ${focus}`);
    }
    body.push("");
  }
  if (intentSignals.length > 0) {
    body.push("Author intent signals:", "");
    for (const signal of intentSignals) {
      body.push(`- ${signal}`);
    }
    body.push("");
  }
  return [
    REVIEWER_CONTEXT_COMMENT_BEGIN,
    ...body.map(sanitizeReviewerCommentLine),
    REVIEWER_CONTEXT_COMMENT_END,
    ""
  ];
}
function collectReviewerChangedAreas(report) {
  const areaFiles = /* @__PURE__ */ new Map();
  for (const commit2 of report.commits) {
    if (commit2.session_id === null) continue;
    for (const file of commit2.files) {
      const rule = REVIEWER_AREA_RULES.find((candidate) => candidate.matches(file.path));
      const id = rule?.id ?? "source";
      const files = areaFiles.get(id) ?? /* @__PURE__ */ new Set();
      files.add(file.path);
      areaFiles.set(id, files);
    }
  }
  return [...areaFiles].map(([id, files]) => {
    const rule = REVIEWER_AREA_RULES.find((candidate) => candidate.id === id);
    return {
      id,
      label: rule?.label ?? "Source",
      files: [...files].sort().slice(0, REVIEWER_CONTEXT_MAX_AREA_FILES),
      totalFiles: files.size
    };
  }).sort((left, right) => right.totalFiles - left.totalFiles || left.label.localeCompare(right.label)).slice(0, REVIEWER_CONTEXT_MAX_CHANGED_AREAS).map(({ id, label, files, totalFiles }) => ({
    id,
    label,
    files,
    moreCount: Math.max(0, totalFiles - files.length)
  }));
}
function collectReviewerFocus(areas) {
  const focus = [];
  const seen = /* @__PURE__ */ new Set();
  for (const area of areas) {
    const text = REVIEW_FOCUS_BY_AREA[area.id];
    if (!seen.has(text)) {
      focus.push(text);
      seen.add(text);
    }
    if (focus.length >= REVIEWER_CONTEXT_MAX_REVIEW_FOCUS) break;
  }
  return focus;
}
function collectReviewerIntentSignals(report, visibleInteractionsBySha) {
  const signals = [];
  const seen = /* @__PURE__ */ new Set();
  const primarySignals = [];
  const fallbackSignals = [];
  let commitSignalCount = 0;
  const trackedCommitsNewestFirst = report.commits.filter((commit2) => commit2.session_id !== null).toReversed();
  for (const commit2 of trackedCommitsNewestFirst) {
    if (commitSignalCount < REVIEWER_CONTEXT_MAX_COMMIT_INTENT_SIGNALS) {
      pushReviewerSignal(signals, seen, `Commit: ${commit2.message}`);
      commitSignalCount += 1;
    }
    for (const interaction of visibleInteractionsBySha.get(commit2.sha) ?? []) {
      const target = isPrimaryReviewerInteraction(interaction) ? primarySignals : fallbackSignals;
      const context = renderInteractionContext(interaction);
      if (context) {
        target.push(`Context: ${context}`);
      }
      target.push(`Prompt: ${interaction.prompt}`);
    }
  }
  for (const signal of [...primarySignals, ...fallbackSignals]) {
    pushReviewerSignal(signals, seen, signal);
    if (signals.length >= REVIEWER_CONTEXT_MAX_INTENT_SIGNALS) return signals;
  }
  return signals;
}
function isPrimaryReviewerInteraction(interaction) {
  const signals = interaction.selection?.signals ?? [];
  return interaction.selection?.source === "primary" || signals.includes("primary_edit_turn") || signals.includes("exact_commit_path") || signals.includes("diff_identifier");
}
function pushReviewerSignal(signals, seen, rawSignal) {
  const signal = formatReviewerSnippet(rawSignal);
  if (!signal || seen.has(signal)) return;
  signals.push(signal);
  seen.add(signal);
}
function formatReviewerSnippet(value) {
  const compact = value.replaceAll("\n", " ").replace(/\s+/g, " ").replace(/^#+\s*/, "").trim();
  if (!compact) return "";
  const clipped = compact.length > REVIEWER_CONTEXT_SNIPPET_MAX_LENGTH ? `${compact.slice(0, REVIEWER_CONTEXT_SNIPPET_MAX_LENGTH)}\u2026` : compact;
  return escapeInlineText(clipped);
}
function escapeInlineText(value) {
  return value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function sanitizeReviewerCommentLine(value) {
  return escapeInlineText(value).replaceAll("--", "- -");
}
function formatInlineCode(value) {
  return `\`${value.replaceAll("`", "\\`")}\``;
}
function formatReviewerAreaFiles(area) {
  const files = area.files.map(formatInlineCode);
  if (area.moreCount > 0) {
    files.push(`${area.moreCount} more`);
  }
  return files.join(", ");
}
function renderPromptSummary(visible, total, detail) {
  if (detail === "full" || visible === total) return `${total} total`;
  return `${visible} shown / ${total} total`;
}
async function detectBaseBranch() {
  for (const name of DEFAULT_BASE_BRANCH_CANDIDATES) {
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
function mergePromptOnlyDisplayInteractions(interactions) {
  const result = [];
  let pendingPrompts = [];
  for (const interaction of interactions) {
    if (isPromptOnlyDisplayPrefix(interaction)) {
      pendingPrompts.push(interaction.prompt);
      continue;
    }
    if (pendingPrompts.length > 0) {
      result.push({
        ...interaction,
        prompt: [...pendingPrompts, interaction.prompt].join("\n\n")
      });
      pendingPrompts = [];
      continue;
    }
    result.push(interaction);
  }
  for (const prompt of pendingPrompts) {
    result.push({ prompt, response: null });
  }
  return result;
}
function isPromptOnlyDisplayPrefix(interaction) {
  return interaction.response === null && !interaction.context && (!interaction.contexts || interaction.contexts.length === 0) && (!interaction.files_touched || interaction.files_touched.length === 0) && !interaction.selection && interaction.tools === void 0;
}
function cleanContext(context) {
  return context.trim();
}
function cleanPrompt(prompt, maxLen) {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return "";
  const lines = trimmed.split("\n");
  const firstLine = lines[0] ?? "";
  let body = trimmed;
  if (firstLine.startsWith("## ") || firstLine.startsWith("# ")) {
    const userStart = lines.findIndex(
      (line, index) => index > 0 && !line.startsWith("#") && !line.startsWith("```") && line.trim().length > MIN_PROMPT_BODY_LINE_CHARS
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
function pushBlockquoteSection(lines, label, body) {
  lines.push(`> **${label}**`);
  lines.push(`> ${body.split("\n").join("\n> ")}`);
}
function renderInteractionContext(interaction) {
  return normalizeInteractionContexts(interaction).sort((left, right) => contextKindOrder2(left.kind) - contextKindOrder2(right.kind)).map((context) => context.text).join("\n\n").trim();
}
function contextKindOrder2(kind) {
  return CONTEXT_KIND_ORDER2[kind];
}
function basename2(path) {
  return path.split("/").pop() ?? path;
}

// src/commands/pr.ts
var DEFAULT_HEAD_REF = "HEAD";
var JSON_INDENT_SPACES2 = 2;
var PR_FLAG_PREFIX = "--";
var PR_FLAG_HEAD = "--head";
var PR_FLAG_JSON = "--json";
var PR_FLAG_OUTPUT = "--output";
var PR_FLAG_PROMPT_DETAIL = "--prompt-detail";
var PR_FLAG_UPDATE = "--update";
var PR_OUTPUT_DESCRIPTION = "description";
async function pr(args2) {
  const isJson = args2.includes(PR_FLAG_JSON);
  const outputIdx = args2.indexOf(PR_FLAG_OUTPUT);
  const updateIdx = args2.indexOf(PR_FLAG_UPDATE);
  const headIdx = args2.indexOf(PR_FLAG_HEAD);
  const promptDetailIdx = args2.indexOf(PR_FLAG_PROMPT_DETAIL);
  const prNumber = updateIdx !== -1 ? args2[updateIdx + 1] : null;
  const headRef = headIdx !== -1 ? args2[headIdx + 1] : DEFAULT_HEAD_REF;
  if (promptDetailIdx !== -1 && !args2[promptDetailIdx + 1]) {
    console.error("error: --prompt-detail requires compact or full");
    process.exit(1);
  }
  const promptDetail = promptDetailIdx !== -1 ? parsePromptDetail(args2[promptDetailIdx + 1]) : parsePromptDetail(null);
  const positional = args2.filter(
    (arg, index) => !arg.startsWith(PR_FLAG_PREFIX) && (outputIdx === -1 || index !== outputIdx + 1) && (updateIdx === -1 || index !== updateIdx + 1) && (headIdx === -1 || index !== headIdx + 1) && (promptDetailIdx === -1 || index !== promptDetailIdx + 1)
  );
  const base = positional[0] ?? await detectBaseBranch();
  if (!base) {
    console.error("error: could not detect base branch. pass it as argument: agent-note pr <base>");
    process.exit(1);
  }
  const outputMode = outputIdx !== -1 ? args2[outputIdx + 1] : PR_OUTPUT_DESCRIPTION;
  const report = await collectReport(base, headRef, { dashboardPrNumber: prNumber });
  if (!report) {
    if (isJson) {
      console.log(JSON.stringify({ error: "no commits found" }));
    } else {
      console.log(`no commits found between HEAD and ${base}`);
    }
    return;
  }
  if (isJson) {
    console.log(JSON.stringify(report, null, JSON_INDENT_SPACES2));
    return;
  }
  const rendered = renderMarkdown(report, { promptDetail });
  if (!prNumber) {
    console.log(rendered);
    return;
  }
  if (outputMode === PR_OUTPUT_DESCRIPTION) {
    await updatePrDescription(prNumber, rendered);
    console.log(`agent-note: PR #${prNumber} description updated`);
    return;
  }
  await postPrComment(prNumber, rendered);
  console.log(`agent-note: PR #${prNumber} comment posted`);
}

// src/commands/push-notes.ts
var NOTES_PUSH_TIMEOUT_MS = 1e4;
var ENV_AGENTNOTE_PUSHING = "AGENTNOTE_PUSHING";
var ENV_GIT_TERMINAL_PROMPT = "GIT_TERMINAL_PROMPT";
var ENV_TRUE = "1";
var ENV_FALSE = "0";
async function pushNotes(args2) {
  const remote = args2[0]?.trim() || "origin";
  const { exitCode } = await gitSafe(["rev-parse", "--verify", NOTES_REF_FULL]);
  if (exitCode !== 0) return;
  try {
    await git(["push", remote, NOTES_REF_FULL], {
      timeout: NOTES_PUSH_TIMEOUT_MS,
      env: {
        ...process.env,
        [ENV_AGENTNOTE_PUSHING]: ENV_TRUE,
        [ENV_GIT_TERMINAL_PROMPT]: ENV_FALSE
      }
    });
  } catch {
  }
}

// src/commands/session.ts
var PERCENT_DENOMINATOR3 = 100;
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
    overallRatio = lineTotalAdded > 0 ? Math.round(lineAiAdded / lineTotalAdded * PERCENT_DENOMINATOR3) : 0;
    lineDetail = ` (${lineAiAdded}/${lineTotalAdded} lines)`;
  } else if (lineCount === 0 && fileCount > 0) {
    _overallMethod = "file";
    overallRatio = fileFilesTotal > 0 ? Math.round(fileFilesAi / fileFilesTotal * PERCENT_DENOMINATOR3) : 0;
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
import { stat as stat3 } from "node:fs/promises";
import { join as join15 } from "node:path";
var DEFAULT_COMMIT_REF = "HEAD";
var COMMIT_REF_PATTERN = /^(HEAD|[0-9a-f]{7,40})$/i;
var BYTES_PER_KILOBYTE = 1024;
var PERCENT_DENOMINATOR4 = 100;
async function show(commitRef) {
  if (commitRef && !COMMIT_REF_PATTERN.test(commitRef)) {
    console.error("usage: agent-note show [commit]");
    console.error("commit must be HEAD or a 7-40 character commit SHA");
    process.exit(1);
  }
  const ref = commitRef ?? DEFAULT_COMMIT_REF;
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
  const sessionDir = join15(await agentnoteDir(), SESSIONS_DIR, sessionId);
  const sessionAgent = await readSessionAgent(sessionDir) ?? entry.agent ?? AGENT_NAMES.claude;
  const adapter = hasAgent(sessionAgent) ? getAgent(sessionAgent) : getAgent(AGENT_NAMES.claude);
  const transcriptPath = await readSessionTranscriptPath(sessionDir) ?? adapter.findTranscript(sessionId);
  if (transcriptPath) {
    console.log();
    const stats = await stat3(transcriptPath);
    const sizeKb = (stats.size / BYTES_PER_KILOBYTE).toFixed(1);
    console.log(`transcript: ${transcriptPath} (${sizeKb} KB)`);
  }
}
function renderRatioBar(ratio) {
  const width = BAR_WIDTH_FULL;
  const filled = Math.round(ratio / PERCENT_DENOMINATOR4 * width);
  const empty = width - filled;
  return `[${"\u2588".repeat(filled)}${"\u2591".repeat(empty)}]`;
}
function truncateLines(text, maxLen) {
  const firstLine = text.split("\n")[0];
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, maxLen)}\u2026`;
}

// src/commands/status.ts
import { existsSync as existsSync15 } from "node:fs";
import { readFile as readFile13 } from "node:fs/promises";
import { isAbsolute as isAbsolute4, join as join16 } from "node:path";
var VERSION = "1.0.2";
var CAPABILITY_LABELS = {
  edits: "edits",
  prompt: "prompt",
  response: "response",
  shell: "shell",
  transcript: "transcript"
};
var CODEX_STATUS_HOOK_EVENTS = {
  sessionStart: "SessionStart",
  stop: "Stop",
  userPromptSubmit: "UserPromptSubmit"
};
var CURSOR_STATUS_HOOK_EVENTS = {
  beforeSubmitPrompt: "beforeSubmitPrompt",
  afterAgentResponse: "afterAgentResponse",
  afterFileEdit: "afterFileEdit",
  afterTabFileEdit: "afterTabFileEdit",
  beforeShellExecution: "beforeShellExecution",
  afterShellExecution: "afterShellExecution",
  stop: "stop"
};
var GEMINI_STATUS_HOOK_EVENTS = {
  beforeAgent: "BeforeAgent",
  afterAgent: "AfterAgent",
  beforeTool: "BeforeTool",
  afterTool: "AfterTool"
};
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
  } else if (enabledAgents.includes(AGENT_NAMES.cursor)) {
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
  if (existsSync15(sessionPath)) {
    const sid = (await readFile13(sessionPath, TEXT_ENCODING)).trim();
    if (sid) {
      const dir = await agentnoteDir();
      const sessionDir = join16(dir, SESSIONS_DIR, sid);
      const hbPath = join16(sessionDir, HEARTBEAT_FILE);
      if (existsSync15(hbPath)) {
        try {
          const hb = Number.parseInt((await readFile13(hbPath, TEXT_ENCODING)).trim(), 10);
          const ageSeconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND) - Math.floor(hb / MILLISECONDS_PER_SECOND);
          if (hb > 0 && ageSeconds <= HEARTBEAT_TTL_SECONDS) {
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
    `-${RECENT_STATUS_COMMIT_LIMIT}`,
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
  console.log(`linked:  ${linked}/${RECENT_STATUS_COMMIT_LIMIT} recent commits`);
}
async function readAgentCaptureDetails(repoRoot3, enabledAgents) {
  const details = [];
  if (enabledAgents.includes(AGENT_NAMES.codex)) {
    const codexCapabilities = await readCodexCaptureCapabilities(repoRoot3);
    if (codexCapabilities.length > 0) {
      details.push(`${AGENT_NAMES.codex}(${codexCapabilities.join(", ")})`);
    }
  }
  if (enabledAgents.includes(AGENT_NAMES.cursor)) {
    const cursorCapabilities = await readCursorCaptureCapabilities(repoRoot3);
    if (cursorCapabilities.length > 0) {
      details.push(`${AGENT_NAMES.cursor}(${cursorCapabilities.join(", ")})`);
    }
  }
  if (enabledAgents.includes(AGENT_NAMES.gemini)) {
    const geminiCapabilities = await readGeminiCaptureCapabilities(repoRoot3);
    if (geminiCapabilities.length > 0) {
      details.push(`${AGENT_NAMES.gemini}(${geminiCapabilities.join(", ")})`);
    }
  }
  return details;
}
async function readCodexCaptureCapabilities(repoRoot3) {
  const hooksPath = join16(repoRoot3, ".codex", "hooks.json");
  if (!existsSync15(hooksPath)) return [];
  try {
    const content = await readFile13(hooksPath, TEXT_ENCODING);
    const parsed = JSON.parse(content);
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName) => (hooks[eventName] ?? []).some(
      (group) => (group.hooks ?? []).some(
        (hook2) => typeof hook2.command === "string" && isAgentNoteHookCommand(hook2.command, AGENT_NAMES.codex)
      )
    );
    const capabilities = [];
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
async function readCursorCaptureCapabilities(repoRoot3) {
  const hooksPath = join16(repoRoot3, ".cursor", "hooks.json");
  if (!existsSync15(hooksPath)) return [];
  try {
    const content = await readFile13(hooksPath, TEXT_ENCODING);
    const parsed = JSON.parse(content);
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName) => (hooks[eventName] ?? []).some(
      (entry) => typeof entry.command === "string" && isAgentNoteHookCommand(entry.command, AGENT_NAMES.cursor)
    );
    const capabilities = [];
    if (hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.beforeSubmitPrompt)) {
      capabilities.push(CAPABILITY_LABELS.prompt);
    }
    if (hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.afterAgentResponse) || hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.stop)) {
      capabilities.push(CAPABILITY_LABELS.response);
    }
    if (hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.afterFileEdit) || hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.afterTabFileEdit)) {
      capabilities.push(CAPABILITY_LABELS.edits);
    }
    if (hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.beforeShellExecution) || hasAgentnoteHook(CURSOR_STATUS_HOOK_EVENTS.afterShellExecution)) {
      capabilities.push(CAPABILITY_LABELS.shell);
    }
    return capabilities;
  } catch {
    return [];
  }
}
async function readGeminiCaptureCapabilities(repoRoot3) {
  const settingsPath = join16(repoRoot3, ".gemini", "settings.json");
  if (!existsSync15(settingsPath)) return [];
  try {
    const content = await readFile13(settingsPath, TEXT_ENCODING);
    const parsed = JSON.parse(content);
    const hooks = parsed.hooks ?? {};
    const hasAgentnoteHook = (eventName) => (hooks[eventName] ?? []).some(
      (group) => (group.hooks ?? []).some(
        (h) => typeof h.command === "string" && isAgentNoteHookCommand(h.command, AGENT_NAMES.gemini)
      )
    );
    const capabilities = [];
    if (hasAgentnoteHook(GEMINI_STATUS_HOOK_EVENTS.beforeAgent)) {
      capabilities.push(CAPABILITY_LABELS.prompt);
    }
    if (hasAgentnoteHook(GEMINI_STATUS_HOOK_EVENTS.afterAgent)) {
      capabilities.push(CAPABILITY_LABELS.response);
    }
    if (hasAgentnoteHook(GEMINI_STATUS_HOOK_EVENTS.beforeTool) || hasAgentnoteHook(GEMINI_STATUS_HOOK_EVENTS.afterTool)) {
      capabilities.push(CAPABILITY_LABELS.edits, CAPABILITY_LABELS.shell);
    }
    return capabilities;
  } catch {
    return [];
  }
}
async function readManagedGitHooks(repoRoot3) {
  const hookDir = await resolveHookDir2(repoRoot3);
  const active = [];
  for (const name of GIT_HOOK_NAMES) {
    const hookPath = join16(hookDir, name);
    if (!existsSync15(hookPath)) continue;
    try {
      const content = await readFile13(hookPath, TEXT_ENCODING);
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
    return isAbsolute4(hooksPathConfig) ? hooksPathConfig : join16(repoRoot3, hooksPathConfig);
  }
  const gitDir2 = (await gitSafe(["rev-parse", "--git-dir"])).stdout.trim();
  const resolvedGitDir = isAbsolute4(gitDir2) ? gitDir2 : join16(repoRoot3, gitDir2);
  return join16(resolvedGitDir, "hooks");
}

// src/commands/why.ts
import { existsSync as existsSync16, realpathSync } from "node:fs";
import { isAbsolute as isAbsolute5, posix, relative as relative3, resolve as resolvePath } from "node:path";
var ALL_ZERO_COMMIT_RE = /^0{40}$/;
var BLAME_HEADER_RE = /^([0-9a-f]{40})\s+\d+\s+\d+(?:\s+\d+)?$/i;
var COLON_COLUMN_TARGET_RE = /^(.+):(\d+):\d+$/;
var COLON_RANGE_TARGET_RE = /^(.+):(\d+)-(\d+)$/;
var COLON_LINE_TARGET_RE = /^(.+):(\d+)$/;
var LINE_FRAGMENT_RE = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/i;
var GITHUB_BLOB_SEGMENT = "blob";
var PATH_PREFIX_RE = /^\.\//;
var AI_PATH_MENTION_PREFIX = "@";
var PERCENT_DENOMINATOR5 = 100;
var DEFAULT_CONTEXT_LINES = 2;
var DEFAULT_RELATED_INTERACTION_LIMIT = 3;
var RATIO_BAR_WIDTH = 8;
var COMMIT_FORMAT = "%H%x00%h%x00%s%x00%ad%x00%an";
async function why(args2) {
  const target = await parseWhyTarget(args2[0]);
  const blamedShas = await blameTarget(target);
  printTarget(target);
  if (blamedShas.length === 0) {
    console.log("evidence: none");
    console.log("reason:   git blame did not return a committed line");
    return;
  }
  for (let index = 0; index < blamedShas.length; index += 1) {
    if (index > 0) console.log();
    await printBlamedCommit(target, blamedShas[index]);
  }
}
async function parseWhyTarget(value) {
  if (!value) {
    printUsageAndExit();
  }
  const parsed = await parseTargetSpecifier(value);
  if (!parsed) {
    printUsageAndExit();
  }
  const { path, startLine, endLine } = parsed;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine <= 0 || endLine < startLine) {
    printUsageAndExit();
  }
  return {
    path: await normalizeTargetPath(path),
    startLine,
    endLine
  };
}
async function parseTargetSpecifier(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const urlTarget = await parseUrlTarget(stripPathMentionPrefix(trimmed));
  if (urlTarget) return urlTarget;
  const fragmentTarget = parseFragmentTarget(trimmed);
  if (fragmentTarget) return fragmentTarget;
  return parseColonTarget(trimmed);
}
async function parseUrlTarget(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "vscode:" && url.hostname === "file") {
    return parseColonTarget(decodeURIComponent(url.pathname));
  }
  const lineRange = parseLineFragment(url.hash);
  if (!lineRange) return null;
  const decodedPath = decodeURIComponent(url.pathname);
  const githubPath = await parseGitHubBlobPath(decodedPath);
  return githubPath ? { path: githubPath, ...lineRange } : { path: decodedPath, ...lineRange };
}
async function parseGitHubBlobPath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  const blobIndex = segments.indexOf(GITHUB_BLOB_SEGMENT);
  if (blobIndex < 0 || blobIndex + 2 >= segments.length) return null;
  const refAndPathSegments = segments.slice(blobIndex + 1);
  const candidates = refAndPathSegments.slice(1).map((_, index) => refAndPathSegments.slice(index + 1).join("/")).filter(Boolean);
  const existing = await findExistingRepositoryPath(candidates);
  return existing ?? candidates[0] ?? null;
}
function parseFragmentTarget(value) {
  const hashIndex = value.lastIndexOf("#");
  if (hashIndex <= 0) return null;
  const lineRange = parseLineFragment(value.slice(hashIndex));
  if (!lineRange) return null;
  return {
    path: value.slice(0, hashIndex),
    ...lineRange
  };
}
function parseColonTarget(value) {
  const match = COLON_COLUMN_TARGET_RE.exec(value) ?? COLON_RANGE_TARGET_RE.exec(value) ?? COLON_LINE_TARGET_RE.exec(value);
  if (!match) {
    return null;
  }
  const startLine = Number(match[2]);
  return {
    path: match[1],
    startLine,
    endLine: match[3] ? Number(match[3]) : startLine
  };
}
function parseLineFragment(value) {
  const fragment = value.replace(/^#/, "");
  const match = LINE_FRAGMENT_RE.exec(fragment);
  if (!match) return null;
  const startLine = Number(match[1]);
  return {
    startLine,
    endLine: match[2] ? Number(match[2]) : startLine
  };
}
async function normalizeTargetPath(path) {
  const withSlashes = path.replaceAll("\\", "/");
  const normalized = (await stripOptionalPathMentionPrefix(withSlashes)).replace(
    PATH_PREFIX_RE,
    ""
  );
  if (!isAbsolute5(normalized)) return normalized;
  const root2 = await repoRoot();
  return relative3(realpathIfExists(root2), realpathIfExists(normalized)).replaceAll("\\", "/");
}
async function findExistingRepositoryPath(candidates) {
  const root2 = await repoRoot();
  return candidates.find((candidate) => existsSync16(resolvePath(root2, candidate))) ?? null;
}
function stripPathMentionPrefix(value) {
  return value.startsWith(AI_PATH_MENTION_PREFIX) ? value.slice(AI_PATH_MENTION_PREFIX.length) : value;
}
function realpathIfExists(path) {
  if (!existsSync16(path)) return path;
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}
async function stripOptionalPathMentionPrefix(value) {
  if (!value.startsWith(AI_PATH_MENTION_PREFIX)) return value;
  const withoutPrefix = stripPathMentionPrefix(value);
  if (!withoutPrefix) return value;
  const root2 = await repoRoot();
  if (existsSync16(resolvePath(root2, value.replace(PATH_PREFIX_RE, "")))) return value;
  return withoutPrefix;
}
function normalizeComparablePath(path) {
  const normalized = posix.normalize(path.replaceAll("\\", "/").replace(PATH_PREFIX_RE, ""));
  return normalized === "." ? "" : normalized.replace(PATH_PREFIX_RE, "");
}
async function blameTarget(target) {
  const range = `${target.startLine},${target.endLine}`;
  const result = await gitSafe(["blame", "--porcelain", "-L", range, "--", target.path]);
  if (result.exitCode !== 0) return [];
  const shas = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line of result.stdout.split("\n")) {
    const match = BLAME_HEADER_RE.exec(line);
    if (!match) continue;
    const sha = match[1];
    if (ALL_ZERO_COMMIT_RE.test(sha) || seen.has(sha)) continue;
    seen.add(sha);
    shas.push(sha);
  }
  return shas;
}
async function printBlamedCommit(target, sha) {
  const commit2 = await readBlamedCommit(sha);
  console.log("blame:");
  console.log(`  commit: ${commit2.shortSha} ${commit2.subject}`);
  console.log(`  author: ${commit2.author}`);
  console.log(`  date:   ${commit2.date}`);
  const raw = await readNote(commit2.sha);
  if (!raw) {
    console.log();
    console.log("agent note:");
    console.log("  evidence: none");
    console.log("  reason:   no Agent Note data exists for this commit");
    return;
  }
  let entry;
  try {
    entry = normalizeEntry(raw);
  } catch {
    console.log();
    console.log("agent note:");
    console.log("  evidence: none");
    console.log("  reason:   Agent Note payload for this commit is invalid");
    return;
  }
  printEntrySummary(entry);
  printRelatedInteractions(target.path, entry);
}
async function readBlamedCommit(sha) {
  const output = await git(["show", "-s", `--format=${COMMIT_FORMAT}`, "--date=short", sha]);
  const [fullSha, shortSha, subject, date, author] = output.split("\0").map((value) => value.trim());
  return {
    sha: fullSha || sha,
    shortSha: shortSha || sha.slice(0, 7),
    subject: subject || "(no subject)",
    date: date || "-",
    author: author || "-"
  };
}
function printTarget(target) {
  const lineSuffix = target.startLine === target.endLine ? String(target.startLine) : `${target.startLine}-${target.endLine}`;
  console.log(`target: ${target.path}:${lineSuffix}`);
  console.log();
}
function printEntrySummary(entry) {
  console.log();
  console.log("agent note:");
  console.log(`  agent:       ${entry.agent ?? "-"}`);
  console.log(`  model:       ${entry.model ?? "-"}`);
  console.log(
    `  ai ratio:    ${entry.attribution.ai_ratio}% ${renderRatioBar2(entry.attribution.ai_ratio)}`
  );
  console.log(`  attribution: ${entry.attribution.method}`);
}
function printRelatedInteractions(targetPath, entry) {
  const related = selectRelatedInteractions(targetPath, entry);
  if (related.length === 0) {
    console.log("  prompts:     none");
    printWhySummary("none");
    return;
  }
  console.log();
  console.log("related prompts:");
  for (let index = 0; index < related.length; index += 1) {
    const item = related[index];
    printInteraction(index + 1, item);
  }
  printWhySummary(`${related[0].evidence}-level Agent Note data`);
}
function printWhySummary(evidence) {
  console.log();
  console.log("why:");
  console.log(`  evidence: ${evidence}`);
  console.log("  note:     exact line-to-prompt attribution is not stored yet");
}
function selectRelatedInteractions(targetPath, entry) {
  const normalizedTargetPath = normalizeComparablePath(targetPath);
  const fileMatches = entry.interactions.filter(
    (interaction) => (interaction.files_touched ?? []).some(
      (filePath) => normalizeComparablePath(filePath) === normalizedTargetPath
    )
  ).map((interaction) => ({ interaction, evidence: "file" }));
  if (fileMatches.length > 0) {
    return fileMatches.slice(0, DEFAULT_RELATED_INTERACTION_LIMIT);
  }
  return filterInteractionsByPromptDetail(entry.interactions, "compact").slice(0, DEFAULT_RELATED_INTERACTION_LIMIT).map((interaction) => ({ interaction, evidence: "commit" }));
}
function printInteraction(index, item) {
  const interaction = item.interaction;
  console.log(`  ${index}. evidence: ${item.evidence}`);
  const contexts = normalizeInteractionContexts(interaction).slice(0, DEFAULT_CONTEXT_LINES);
  for (const context of contexts) {
    console.log(`     context: ${truncateLines2(context.text, TRUNCATE_RESPONSE_SHOW)}`);
  }
  console.log(`     prompt:  ${truncateLines2(interaction.prompt, TRUNCATE_PROMPT)}`);
  if (interaction.response) {
    console.log(`     response: ${truncateLines2(interaction.response, TRUNCATE_RESPONSE_SHOW)}`);
  }
  for (const file of interaction.files_touched ?? []) {
    console.log(`     file:    ${file}`);
  }
}
function renderRatioBar2(ratio) {
  const clamped = Math.min(PERCENT_DENOMINATOR5, Math.max(0, ratio));
  const filled = Math.round(clamped / PERCENT_DENOMINATOR5 * RATIO_BAR_WIDTH);
  return `[${"\u2588".repeat(filled)}${"\u2591".repeat(RATIO_BAR_WIDTH - filled)}]`;
}
function truncateLines2(text, maxLen) {
  const compact = text.split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen)}\u2026`;
}
function printUsageAndExit() {
  console.error("usage: agent-note why <target>");
  console.error("example: agent-note why src/app.ts:42");
  console.error("example: agent-note why src/app.ts#L42");
  process.exit(1);
}

// src/cli.ts
var VERSION2 = "1.0.2";
var HELP = `
agent-note v${VERSION2} \u2014 remember why your code changed

usage:
  agent-note init --agent <name...> set up hooks, workflows, and notes auto-fetch (agents: claude, codex, cursor, gemini)
                                    [--dashboard] [--no-hooks] [--no-action] [--no-notes] [--no-git-hooks] [--hooks] [--action]
  agent-note deinit --agent <name...>
                                    remove hooks and config [--remove-workflow] [--keep-notes]
  agent-note show [commit]          show session details for a commit
  agent-note why <target>
                                    explain the Agent Note context behind a line
  agent-note blame <target>
                                    alias of why
  agent-note log [n]                list recent commits with session info
  agent-note pr [base] [--json] [--head <ref>] [--update <PR#>] [--output description|comment] [--prompt-detail compact|full]
                                    generate PR report or update PR description/comment
  agent-note session <id>           show commits for a session
  agent-note commit [args]          git commit with session tracking
  agent-note status                 show current tracking state
  agent-note version                print version
  agent-note help                   show this help
`.trim();
var command = process.argv[2];
var args = process.argv.slice(3);
function parseLogCountArg(value) {
  if (!value) return DEFAULT_LOG_COUNT;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  console.error(`invalid log count: ${value} (expected a positive integer)`);
  process.exit(1);
}
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
  case "why":
  case "blame":
    await why(args);
    break;
  case "log":
    await log(parseLogCountArg(args[0]));
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
    await record(args);
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
