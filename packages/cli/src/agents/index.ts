import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import type { AgentAdapter } from "./types.js";

const AGENTS = new Map<string, AgentAdapter>([
  [claudeCode.name, claudeCode],
  [codex.name, codex],
]);

const DEFAULT_AGENT = claudeCode.name;

export function getAgent(name: string): AgentAdapter {
  const agent = AGENTS.get(name);
  if (!agent) {
    throw new Error(`unknown agent: ${name}`);
  }
  return agent;
}

export function getDefaultAgent(): AgentAdapter {
  return getAgent(DEFAULT_AGENT);
}

export function hasAgent(name: string): boolean {
  return AGENTS.has(name);
}

export function listAgents(): string[] {
  return [...AGENTS.keys()];
}
