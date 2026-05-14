import { isAbsolute, join, resolve } from "node:path";
import { AGENTNOTE_DIR, SESSION_FILE } from "./core/constants.js";
import { git, repoRoot } from "./git.js";

let _root: string | null = null;
let _gitDir: string | null = null;
let _commonGitDir: string | null = null;

/** Resolve git paths that are reported relative to the current process cwd. */
function resolveGitPath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

/** Resolve and cache the repository root, exiting for non-git directories. */
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
    _gitDir = resolveGitPath(_gitDir);
  }
  return _gitDir;
}

/** Resolve the shared git directory used by all worktrees in this repository. */
async function commonGitDir(): Promise<string> {
  if (!_commonGitDir) {
    _commonGitDir = await git(["rev-parse", "--git-common-dir"]);
    _commonGitDir = resolveGitPath(_commonGitDir);
  }
  return _commonGitDir;
}

/** Path to the agentnote data directory inside the git dir. */
export async function agentnoteDir(): Promise<string> {
  return join(await gitDir(), AGENTNOTE_DIR);
}

/** Path to the shared agentnote directory visible from every git worktree. */
export async function commonAgentnoteDir(): Promise<string> {
  return join(await commonGitDir(), AGENTNOTE_DIR);
}

/** Path to the active session ID file. */
export async function sessionFile(): Promise<string> {
  return join(await agentnoteDir(), SESSION_FILE);
}

/** Legacy Claude settings path kept for older command callers. */
export async function settingsFile(): Promise<string> {
  return join(await root(), ".claude", "settings.json");
}

export { root };
