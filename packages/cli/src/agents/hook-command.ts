import { AGENTNOTE_HOOK_COMMAND, CLI_JS_HOOK_COMMAND } from "../core/constants.js";
import type { AgentName } from "./types.js";

type HookCommandMatchOptions = {
  allowMissingAgent?: boolean;
};

const AGENT_FLAG = "--agent";
const AGENT_FLAG_PREFIX = `${AGENT_FLAG}=`;
const AGENTNOTE_HOOK_TOKENS = AGENTNOTE_HOOK_COMMAND.split(" ");
const CLI_JS_HOOK_TOKENS = CLI_JS_HOOK_COMMAND.split(" ");
const PATH_SEPARATOR_RE = /[\\/]/;

/** Split a hook command into shell-like tokens without executing or expanding it. */
function tokenizeHookCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of command) {
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

function tokenBasename(token: string): string {
  return token.split(PATH_SEPARATOR_RE).pop() ?? token;
}

function hasHookTokenSequence(tokens: string[], sequence: string[]): boolean {
  return tokens.some((token, index) => {
    const firstMatches =
      token === sequence[0] ||
      (sequence[0] === CLI_JS_HOOK_TOKENS[0] && tokenBasename(token) === sequence[0]);
    return firstMatches && tokens[index + 1] === sequence[1];
  });
}

function readAgentFlag(tokens: string[]): string | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === AGENT_FLAG) return tokens[index + 1] ?? "";
    if (token.startsWith(AGENT_FLAG_PREFIX)) return token.slice(AGENT_FLAG_PREFIX.length);
  }
  return null;
}

/** Return true when a command is an Agent Note hook for the requested agent. */
export function isAgentNoteHookCommand(
  command: string,
  agentName: AgentName,
  options: HookCommandMatchOptions = {},
): boolean {
  const tokens = tokenizeHookCommand(command);
  const isPublicHook = hasHookTokenSequence(tokens, AGENTNOTE_HOOK_TOKENS);
  const isRepoLocalHook = hasHookTokenSequence(tokens, CLI_JS_HOOK_TOKENS);
  if (!isPublicHook && !isRepoLocalHook) return false;

  const agentFlag = readAgentFlag(tokens);
  if (agentFlag === agentName) return true;
  return options.allowMissingAgent === true && agentFlag === null;
}
