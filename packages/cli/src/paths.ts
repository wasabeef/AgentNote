import { join } from "node:path";
import { repoRoot } from "./git.js";

let _root: string | null = null;

async function root(): Promise<string> {
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

/** Path to .git/agentnote/ where all tracking data lives. */
export async function agentnoteDir(): Promise<string> {
  return join(await root(), ".git", "agentnote");
}

/** Path to the active session ID file. */
export async function sessionFile(): Promise<string> {
  return join(await agentnoteDir(), "session");
}

/** .claude/settings.json */
export async function settingsFile(): Promise<string> {
  return join(await root(), ".claude", "settings.json");
}

export { root };
