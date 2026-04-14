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

/** Aliases for backward compatibility (e.g. "claude-code" → claude). */
const ALIASES = new Map<string, string>([["claude-code", claude.name]]);

export function getAgent(name: string): AgentAdapter {
  const canonical = ALIASES.get(name) ?? name;
  const agent = AGENTS.get(canonical);
  if (!agent) {
    throw new Error(`unknown agent: ${name}`);
  }
  return agent;
}

export function hasAgent(name: string): boolean {
  const canonical = ALIASES.get(name) ?? name;
  return AGENTS.has(canonical);
}

export function listAgents(): string[] {
  return [...AGENTS.keys()];
}
