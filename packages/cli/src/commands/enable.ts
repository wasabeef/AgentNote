import { mkdir } from "node:fs/promises";
import { loreDir, root } from "../paths.js";
import { claudeCode } from "../agents/claude-code.js";

export async function enable(): Promise<void> {
  const loreDirPath = await loreDir();
  const repoRoot = await root();

  await mkdir(loreDirPath, { recursive: true });

  const adapter = claudeCode;

  if (await adapter.isEnabled(repoRoot)) {
    console.log("lore: already enabled");
    return;
  }

  await adapter.installHooks(repoRoot);
  console.log("lore: enabled in .claude/settings.json");
  console.log("lore: commit this file to share with your team");
}
