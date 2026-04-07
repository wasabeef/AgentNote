import { join } from "node:path";
import { AGENTNOTE_DIR, SESSION_FILE } from "./core/constants.js";
import { git, repoRoot } from "./git.js";

let _root: string | null = null;
let _gitDir: string | null = null;

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

/** Resolve the actual .git directory (supports worktrees where .git is a file). */
async function gitDir(): Promise<string> {
  if (!_gitDir) {
    _gitDir = await git(["rev-parse", "--git-dir"]);
    // Make absolute if relative.
    if (!_gitDir.startsWith("/")) {
      _gitDir = join(await root(), _gitDir);
    }
  }
  return _gitDir;
}

/** Path to the agentnote data directory inside the git dir. */
export async function agentnoteDir(): Promise<string> {
  return join(await gitDir(), AGENTNOTE_DIR);
}

/** Path to the active session ID file. */
export async function sessionFile(): Promise<string> {
  return join(await agentnoteDir(), SESSION_FILE);
}

/** .claude/settings.json */
export async function settingsFile(): Promise<string> {
  return join(await root(), ".claude", "settings.json");
}

export { root };
