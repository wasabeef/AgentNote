import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { sessionFile, root } from "../paths.js";
import { claudeCode } from "../agents/claude-code.js";

export async function disable(): Promise<void> {
  const repoRoot = await root();
  const adapter = claudeCode;

  await adapter.removeHooks(repoRoot);

  const sf = await sessionFile();
  if (existsSync(sf)) {
    await rm(sf);
  }

  console.log("agentnote: disabled. hooks removed from .claude/settings.json");
  console.log("agentnote: commit this change to disable for your team");
}
