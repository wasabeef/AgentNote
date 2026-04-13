import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { getAgent, getDefaultAgent, hasAgent } from "../agents/index.js";
import {
  AGENTNOTE_HOOK_MARKER,
  NOTES_FETCH_REFSPEC,
  NOTES_REF_FULL,
  TRAILER_KEY,
} from "../core/constants.js";
import { git, gitSafe } from "../git.js";
import { agentnoteDir, root } from "../paths.js";

const WORKFLOW_TEMPLATE = `name: Agent Note
on:
  pull_request:
    types: [opened, synchronize]
concurrency:
  group: agentnote-\${{ github.event.pull_request.number }}
  cancel-in-progress: true
permissions:
  contents: read
  pull-requests: write
jobs:
  report:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: wasabeef/agentnote@v0
`;

// ─── Git hook scripts ───

const PREPARE_COMMIT_MSG_SCRIPT = `#!/bin/sh
${AGENTNOTE_HOOK_MARKER}
# Inject Agentnote-Session trailer into commit messages.
# Skip amend/reword/reuse (-c/-C/--amend) — only brand-new commits get a trailer.
# $2 values: "" (normal), "template", "merge", "squash" = new commits.
# "commit" = -c/-C/--amend (reuse). Skip those.
case "$2" in commit) exit 0;; esac
# Fail closed: no session file, no heartbeat, or stale heartbeat → skip.
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
SESSION_FILE="$GIT_DIR/agentnote/session"
if [ ! -f "$SESSION_FILE" ]; then exit 0; fi
SESSION_ID=$(cat "$SESSION_FILE" 2>/dev/null | tr -d '\\n')
if [ -z "$SESSION_ID" ]; then exit 0; fi
# Check freshness via this session's heartbeat (< 1 hour).
HEARTBEAT_FILE="$GIT_DIR/agentnote/sessions/$SESSION_ID/heartbeat"
if [ ! -f "$HEARTBEAT_FILE" ]; then exit 0; fi
NOW=$(date +%s)
HB=$(cat "$HEARTBEAT_FILE" 2>/dev/null | tr -d '\\n')
HB_SEC=\${HB%???}
AGE=$((NOW - HB_SEC))
if [ "$AGE" -gt 3600 ] 2>/dev/null; then exit 0; fi
if ! grep -q "${TRAILER_KEY}" "$1" 2>/dev/null; then
  echo "" >> "$1"
  echo "${TRAILER_KEY}: $SESSION_ID" >> "$1"
fi
`;

const POST_COMMIT_SCRIPT = `#!/bin/sh
${AGENTNOTE_HOOK_MARKER}
# Record agentnote entry as a git note on HEAD.
# Read session ID from the finalized commit's trailer (source of truth),
# not from the mutable session file. This eliminates TOCTOU races between
# prepare-commit-msg and post-commit.
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
SESSION_ID=$(git log -1 --format='%(trailers:key=${TRAILER_KEY},valueonly)' HEAD 2>/dev/null | tr -d '\\n')
if [ -z "$SESSION_ID" ]; then exit 0; fi
# Prefer the repo-local shim created at init time so post-commit uses the
# exact CLI version that generated these hooks.
if [ -x "$GIT_DIR/agentnote/bin/agentnote" ]; then
  "$GIT_DIR/agentnote/bin/agentnote" record "$SESSION_ID" 2>/dev/null || true
  exit 0
fi
# Fall back to stable local/global binaries only.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -f "$REPO_ROOT/node_modules/.bin/agentnote" ]; then
  "$REPO_ROOT/node_modules/.bin/agentnote" record "$SESSION_ID" 2>/dev/null || true
elif command -v agentnote >/dev/null 2>&1; then
  agentnote record "$SESSION_ID" 2>/dev/null || true
fi
`;

const PRE_PUSH_SCRIPT = `#!/bin/sh
${AGENTNOTE_HOOK_MARKER}
# Push agentnote notes alongside code. Non-blocking — failure is silent.
# Use the actual remote ($1) passed by git, not hardcoded origin.
# Guard against recursion with AGENTNOTE_PUSHING env var.
if [ -n "$AGENTNOTE_PUSHING" ]; then exit 0; fi
REMOTE="\${1:-origin}"
AGENTNOTE_PUSHING=1 git push "$REMOTE" refs/notes/agentnote 2>/dev/null &
`;

export async function init(args: string[]): Promise<void> {
  const agentArgIndex = args.indexOf("--agent");
  const agentName =
    agentArgIndex >= 0 && args[agentArgIndex + 1]
      ? args[agentArgIndex + 1]
      : getDefaultAgent().name;
  if (!hasAgent(agentName)) {
    console.error(`error: unknown agent '${agentName}'`);
    process.exit(1);
  }

  const skipHooks = args.includes("--no-hooks");
  const skipAction = args.includes("--no-action");
  const skipNotes = args.includes("--no-notes");
  const skipGitHooks = args.includes("--no-git-hooks");
  const hooksOnly = args.includes("--hooks");
  const actionOnly = args.includes("--action");

  const repoRoot = await root();
  const adapter = getAgent(agentName);
  const results: string[] = [];

  // Always create the data directory.
  await mkdir(await agentnoteDir(), { recursive: true });

  // Agent hooks
  if (!skipHooks && !actionOnly) {
    if (await adapter.isEnabled(repoRoot)) {
      results.push("  · hooks already configured");
    } else {
      await adapter.installHooks(repoRoot);
      results.push(`  ✓ hooks added for ${adapter.name}`);
      for (const relPath of await adapter.managedPaths(repoRoot)) {
        results.push(`    ${relPath}`);
      }
    }
  }

  // Git hooks (prepare-commit-msg, post-commit, pre-push)
  if (!skipGitHooks && !actionOnly) {
    await installLocalCliShim(await agentnoteDir());
    const hookDir = await resolveHookDir(repoRoot);
    await mkdir(hookDir, { recursive: true });

    const installed = await installGitHook(
      hookDir,
      "prepare-commit-msg",
      PREPARE_COMMIT_MSG_SCRIPT,
    );
    results.push(
      installed ? "  ✓ git hook: prepare-commit-msg" : "  · git hook: prepare-commit-msg (exists)",
    );

    const installed2 = await installGitHook(hookDir, "post-commit", POST_COMMIT_SCRIPT);
    results.push(installed2 ? "  ✓ git hook: post-commit" : "  · git hook: post-commit (exists)");

    const installed3 = await installGitHook(hookDir, "pre-push", PRE_PUSH_SCRIPT);
    results.push(
      installed3 ? "  ✓ git hook: pre-push (auto-push notes)" : "  · git hook: pre-push (exists)",
    );
  }

  // GitHub Action workflow
  if (!skipAction && !hooksOnly) {
    const workflowDir = join(repoRoot, ".github", "workflows");
    const workflowPath = join(workflowDir, "agentnote.yml");

    if (existsSync(workflowPath)) {
      results.push("  · workflow already exists at .github/workflows/agentnote.yml");
    } else {
      await mkdir(workflowDir, { recursive: true });
      await writeFile(workflowPath, WORKFLOW_TEMPLATE);
      results.push("  ✓ workflow created at .github/workflows/agentnote.yml");
    }
  }

  // Auto-fetch notes on git pull
  if (!skipNotes && !hooksOnly && !actionOnly) {
    const { stdout } = await gitSafe(["config", "--get-all", "remote.origin.fetch"]);

    if (stdout.includes(NOTES_REF_FULL)) {
      results.push("  · git already configured to fetch notes");
    } else {
      await gitSafe(["config", "--add", "remote.origin.fetch", NOTES_FETCH_REFSPEC]);
      results.push("  ✓ git configured to auto-fetch notes on pull");
    }
  }

  // Output
  console.log("");
  console.log("agentnote init");
  console.log("");
  for (const line of results) {
    console.log(line);
  }

  // Determine what needs to be committed
  const toCommit: string[] = [];
  if (!skipHooks && !actionOnly) {
    toCommit.push(...(await adapter.managedPaths(repoRoot)));
  }
  if (!skipAction && !hooksOnly) {
    const workflowPath = join(repoRoot, ".github", "workflows", "agentnote.yml");
    if (existsSync(workflowPath)) toCommit.push(".github/workflows/agentnote.yml");
  }

  const uniqueToCommit = [...new Set(toCommit)];
  if (uniqueToCommit.length > 0) {
    console.log("");
    console.log("  Next: commit and push these files");
    console.log(`    git add ${uniqueToCommit.join(" ")}`);
    console.log('    git commit -m "chore: enable agentnote session tracking"');
    console.log("    git push");
    if (adapter.name === "cursor") {
      console.log("");
      console.log("  Cursor note");
      console.log("    With the default git hooks, plain `git commit` is tracked normally.");
      console.log(
        '    `agentnote commit -m "..."` is still useful as a fallback wrapper when git hooks are unavailable.',
      );
    }
  }
  console.log("");
}

// ─── Git hook helpers ───

/** Resolve the git hooks directory (respects core.hooksPath). */
async function resolveHookDir(repoRoot: string): Promise<string> {
  try {
    const hooksPath = await git(["config", "--get", "core.hooksPath"]);
    if (hooksPath) return isAbsolute(hooksPath) ? hooksPath : join(repoRoot, hooksPath);
  } catch {
    // No custom hooksPath set.
  }
  const gitDir = await git(["rev-parse", "--git-dir"]);
  return join(gitDir, "hooks");
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function installLocalCliShim(agentnoteDirPath: string): Promise<void> {
  if (!process.argv[1]) return;

  const shimDir = join(agentnoteDirPath, "bin");
  const shimPath = join(shimDir, "agentnote");
  const cliPath = resolve(process.argv[1]);
  const shim = `#!/bin/sh
exec ${shellSingleQuote(process.execPath)} ${shellSingleQuote(cliPath)} "$@"
`;

  await mkdir(shimDir, { recursive: true });
  await writeFile(shimPath, shim);
  await chmod(shimPath, 0o755);
}

/**
 * Install a git hook script. If an existing hook is present and not managed
 * by agentnote, chain to it (run the original first, then agentnote's logic).
 * Returns true if installed, false if already present.
 */
async function installGitHook(hookDir: string, name: string, script: string): Promise<boolean> {
  const hookPath = join(hookDir, name);

  if (existsSync(hookPath)) {
    const existing = await readFile(hookPath, "utf-8");
    // Already managed by agentnote — upgrade if content differs.
    if (existing.includes(AGENTNOTE_HOOK_MARKER)) {
      const backupPath = `${hookPath}.agentnote-backup`;
      // Regenerate chained variant if a backup exists, otherwise bare script.
      const target = existsSync(backupPath)
        ? script.replace(
            "#!/bin/sh",
            `#!/bin/sh\n# Chain to original hook — preserve exit status.\nif [ -f "${backupPath}" ]; then "${backupPath}" "$@" || exit $?; fi`,
          )
        : script;
      if (existing.trim() === target.trim()) return false; // already up-to-date
      await writeFile(hookPath, target);
      await chmod(hookPath, 0o755);
      return true;
    }

    // Chain: rename existing hook and call it from our script.
    const backupPath = `${hookPath}.agentnote-backup`;
    if (!existsSync(backupPath)) {
      await writeFile(backupPath, existing);
      await chmod(backupPath, 0o755);
    }
    // Chain: run original hook first, preserve its exit status.
    // If the original hook fails, abort — don't override repo protections.
    const chainedScript = script.replace(
      "#!/bin/sh",
      `#!/bin/sh\n# Chain to original hook — preserve exit status.\nif [ -f "${backupPath}" ]; then "${backupPath}" "$@" || exit $?; fi`,
    );
    await writeFile(hookPath, chainedScript);
    await chmod(hookPath, 0o755);
    return true;
  }

  await writeFile(hookPath, script);
  await chmod(hookPath, 0o755);
  return true;
}
