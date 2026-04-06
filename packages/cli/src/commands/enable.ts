import { mkdir } from "node:fs/promises";
import { agentnoteDir, root } from "../paths.js";
import { claudeCode } from "../agents/claude-code.js";

export async function enable(): Promise<void> {
  const agentnoteDirPath = await agentnoteDir();
  const repoRoot = await root();

  await mkdir(agentnoteDirPath, { recursive: true });

  const adapter = claudeCode;

  if (await adapter.isEnabled(repoRoot)) {
    console.log("agentnote: already enabled");
    return;
  }

  await adapter.installHooks(repoRoot);
  console.log("agentnote: enabled in .claude/settings.json");
  console.log("agentnote: commit this file to share with your team");
}
