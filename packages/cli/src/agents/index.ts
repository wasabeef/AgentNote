import { claude } from "./claude.js";
import { codex } from "./codex.js";
import { cursor } from "./cursor.js";
import { gemini } from "./gemini.js";
import type { AgentAdapter, AgentName } from "./types.js";

const AGENTS = new Map<AgentName, AgentAdapter>([
  [claude.name, claude],
  [codex.name, codex],
  [cursor.name, cursor],
  [gemini.name, gemini],
]);

/** Return the adapter implementation for a supported coding agent. */
export function getAgent(name: string): AgentAdapter {
  const agent = AGENTS.get(name as AgentName);
  if (!agent) {
    throw new Error(`unknown agent: ${name}`);
  }
  return agent;
}

/** Return whether an agent name is registered and supported by this build. */
export function hasAgent(name: string): name is AgentName {
  return AGENTS.has(name as AgentName);
}

/** List supported agent names in registry order. */
export function listAgents(): AgentName[] {
  return [...AGENTS.keys()];
}
