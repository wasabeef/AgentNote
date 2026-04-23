import { claude } from "./claude.js";
import { codex } from "./codex.js";
import { cursor } from "./cursor.js";
import { gemini } from "./gemini.js";
import type { AgentAdapter } from "./types.js";

const AGENTS = new Map<string, AgentAdapter>([
  [claude.name, claude],
  [codex.name, codex],
  [cursor.name, cursor],
  [gemini.name, gemini],
]);

export function getAgent(name: string): AgentAdapter {
  const agent = AGENTS.get(name);
  if (!agent) {
    throw new Error(`unknown agent: ${name}`);
  }
  return agent;
}

export function hasAgent(name: string): boolean {
  return AGENTS.has(name);
}

export function listAgents(): string[] {
  return [...AGENTS.keys()];
}
