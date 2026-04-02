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

/** .git/lore/ ディレクトリ */
export async function loreDir(): Promise<string> {
  return join(await root(), ".git", "lore");
}

/** .git/lore/session ファイル */
export async function sessionFile(): Promise<string> {
  return join(await loreDir(), "session");
}

/** .claude/hooks/ ディレクトリ */
export async function hooksDir(): Promise<string> {
  return join(await root(), ".claude", "hooks");
}

/** .claude/settings.json */
export async function settingsFile(): Promise<string> {
  return join(await root(), ".claude", "settings.json");
}

export { root };
