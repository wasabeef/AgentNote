import { AGENTNOTE_HOOK_COMMAND, CLI_JS_HOOK_COMMAND } from "../core/constants.js";
import type { AgentName } from "./types.js";

type HookCommandMatchOptions = {
  allowMissingAgent?: boolean;
};

/** Return true when a command is an Agent Note hook for the requested agent. */
export function isAgentNoteHookCommand(
  command: string,
  agentName: AgentName,
  options: HookCommandMatchOptions = {},
): boolean {
  const isPublicHook = command.includes(AGENTNOTE_HOOK_COMMAND);
  const isRepoLocalHook = command.includes(CLI_JS_HOOK_COMMAND);
  if (!isPublicHook && !isRepoLocalHook) return false;

  if (command.includes(`--agent ${agentName}`)) return true;
  return options.allowMissingAgent === true && !command.includes("--agent ");
}
