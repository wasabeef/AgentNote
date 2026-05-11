import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { getAgent, hasAgent, listAgents } from "../agents/index.js";
import { AGENT_NAMES } from "../agents/types.js";
import {
  AGENTNOTE_HOOK_MARKER,
  GIT_HOOK_NAMES,
  HEARTBEAT_TTL_SECONDS,
  NOTES_FETCH_REFSPEC,
  NOTES_REF_FULL,
  RECORDABLE_SESSION_FILES,
  TEXT_ENCODING,
  TRAILER_KEY,
} from "../core/constants.js";
import { git, gitSafe } from "../git.js";
import { agentnoteDir, root } from "../paths.js";

/** Default workflow filename generated for PR Report mode. */
export const PR_REPORT_WORKFLOW_FILENAME = "agentnote-pr-report.yml";
/** Default workflow filename generated for Dashboard mode. */
export const DASHBOARD_WORKFLOW_FILENAME = "agentnote-dashboard.yml";

const [PREPARE_COMMIT_MSG_HOOK, POST_COMMIT_HOOK, PRE_PUSH_HOOK] = GIT_HOOK_NAMES;
const RECORDABLE_SESSION_FILE_LIST = RECORDABLE_SESSION_FILES.join(" ");

const PR_REPORT_WORKFLOW_TEMPLATE = `name: Agent Note PR Report
on:
  pull_request:
    types: [opened, reopened, synchronize]
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
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: wasabeef/AgentNote@v1
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

const DASHBOARD_WORKFLOW_TEMPLATE = `name: Agent Note Dashboard

on:
  push:
  pull_request:
    types:
      - opened
      - reopened
      - synchronize

permissions:
  contents: write
  pages: write
  id-token: write
  pull-requests: read

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      should_deploy: \${{ steps.dashboard.outputs.should_deploy }}
    steps:
      - name: Build Dashboard bundle
        id: dashboard
        uses: wasabeef/AgentNote@v1
        with:
          dashboard: true

  deploy:
    if: needs.build.outputs.should_deploy == 'true'
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;

/** Parse `--agent claude cursor` style arguments into unique agent names. */
export function parseAgentArgs(args: string[]): string[] {
  const agentFlagIndexes = args.reduce<number[]>((indexes, arg, index) => {
    if (arg === "--agent") indexes.push(index);
    return indexes;
  }, []);

  if (agentFlagIndexes.length === 0) return [];
  if (agentFlagIndexes.length > 1) {
    throw new Error("repeat --agent is not supported. Use --agent claude cursor");
  }

  const agents: string[] = [];
  let cursor = agentFlagIndexes[0] + 1;
  while (cursor < args.length && !args[cursor].startsWith("--")) {
    agents.push(args[cursor]);
    cursor++;
  }

  return [...new Set(agents)];
}

// ─── Git hook scripts ───

const PREPARE_COMMIT_MSG_SCRIPT = `#!/bin/sh
${AGENTNOTE_HOOK_MARKER}
# Inject Agentnote-Session trailer into commit messages.
# Skip amend/reword/reuse (-c/-C/--amend) — only brand-new commits get a trailer.
# $2 values: "" (normal), "template", "merge", "squash" = new commits.
# "commit" = -c/-C/--amend (reuse). Skip those.
case "$2" in commit) exit 0;; esac
# Fail closed: no session file, no heartbeat, stale heartbeat, or metadata-only session → skip.
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
SESSION_FILE="$GIT_DIR/agentnote/session"
if [ ! -f "$SESSION_FILE" ]; then exit 0; fi
SESSION_ID=$(cat "$SESSION_FILE" 2>/dev/null | tr -d '\\n')
if [ -z "$SESSION_ID" ]; then exit 0; fi
SESSION_DIR="$GIT_DIR/agentnote/sessions/$SESSION_ID"
# Check freshness via this session's heartbeat (< 1 hour).
HEARTBEAT_FILE="$SESSION_DIR/heartbeat"
if [ ! -f "$HEARTBEAT_FILE" ]; then exit 0; fi
NOW=$(date +%s)
HB=$(cat "$HEARTBEAT_FILE" 2>/dev/null | tr -d '\\n')
HB_SEC=\${HB%???}
AGE=$((NOW - HB_SEC))
if [ "$AGE" -gt ${HEARTBEAT_TTL_SECONDS} ] 2>/dev/null; then exit 0; fi
HAS_RECORDABLE_DATA=0
for FILE_NAME in ${RECORDABLE_SESSION_FILE_LIST}; do
  if [ -s "$SESSION_DIR/$FILE_NAME" ]; then
    HAS_RECORDABLE_DATA=1
    break
  fi
done
if [ "$HAS_RECORDABLE_DATA" -ne 1 ]; then exit 0; fi
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
if [ -x "$GIT_DIR/agentnote/bin/agent-note" ]; then
  "$GIT_DIR/agentnote/bin/agent-note" record "$SESSION_ID" 2>/dev/null || true
  exit 0
fi
# Fall back to stable local/global binaries only.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -f "$REPO_ROOT/node_modules/.bin/agent-note" ]; then
  "$REPO_ROOT/node_modules/.bin/agent-note" record "$SESSION_ID" 2>/dev/null || true
elif command -v agent-note >/dev/null 2>&1; then
  agent-note record "$SESSION_ID" 2>/dev/null || true
fi
`;

const PRE_PUSH_SCRIPT = `#!/bin/sh
${AGENTNOTE_HOOK_MARKER}
# Push agentnote notes alongside code via the repo-local shim so hook behavior
# tracks the current CLI implementation after upgrades. Wait for completion so
# PR workflows can fetch the latest notes ref, but never block the main push on failure.
if [ -n "$AGENTNOTE_PUSHING" ]; then exit 0; fi
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
if [ -x "$GIT_DIR/agentnote/bin/agent-note" ]; then
  "$GIT_DIR/agentnote/bin/agent-note" push-notes "$1" 2>/dev/null || true
  exit 0
fi
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -f "$REPO_ROOT/node_modules/.bin/agent-note" ]; then
  "$REPO_ROOT/node_modules/.bin/agent-note" push-notes "$1" 2>/dev/null || true
elif command -v agent-note >/dev/null 2>&1; then
  agent-note push-notes "$1" 2>/dev/null || true
fi
`;

/** Install Agent Note git hooks, agent hooks, and optional GitHub workflows. */
export async function init(args: string[]): Promise<void> {
  let agents: string[] = [];
  try {
    agents = parseAgentArgs(args);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exit(1);
  }

  const skipHooks = args.includes("--no-hooks");
  const skipAction = args.includes("--no-action");
  const skipNotes = args.includes("--no-notes");
  const skipGitHooks = args.includes("--no-git-hooks");
  const hooksOnly = args.includes("--hooks");
  const actionOnly = args.includes("--action");
  const dashboard = args.includes("--dashboard");

  if (agents.length === 0 && !actionOnly) {
    console.error(`error: --agent is required. Available agents: ${listAgents().join(", ")}`);
    process.exit(1);
  }

  for (const agentName of agents) {
    if (!hasAgent(agentName)) {
      console.error(`error: unknown agent '${agentName}'`);
      process.exit(1);
    }
  }

  const repoRoot = await root();
  const results: string[] = [];

  // Always create the data directory.
  await mkdir(await agentnoteDir(), { recursive: true });

  // Agent hooks
  if (!skipHooks && !actionOnly) {
    for (const agentName of agents) {
      const adapter = getAgent(agentName);
      if (await adapter.isEnabled(repoRoot)) {
        results.push(`  · hooks already configured for ${adapter.name}`);
      } else {
        await adapter.installHooks(repoRoot);
        results.push(`  ✓ hooks added for ${adapter.name}`);
        for (const relPath of await adapter.managedPaths(repoRoot)) {
          results.push(`    ${relPath}`);
        }
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
      PREPARE_COMMIT_MSG_HOOK,
      PREPARE_COMMIT_MSG_SCRIPT,
    );
    results.push(
      installed
        ? `  ✓ git hook: ${PREPARE_COMMIT_MSG_HOOK}`
        : `  · git hook: ${PREPARE_COMMIT_MSG_HOOK} (exists)`,
    );

    const installed2 = await installGitHook(hookDir, POST_COMMIT_HOOK, POST_COMMIT_SCRIPT);
    results.push(
      installed2
        ? `  ✓ git hook: ${POST_COMMIT_HOOK}`
        : `  · git hook: ${POST_COMMIT_HOOK} (exists)`,
    );

    const installed3 = await installGitHook(hookDir, PRE_PUSH_HOOK, PRE_PUSH_SCRIPT);
    results.push(
      installed3
        ? `  ✓ git hook: ${PRE_PUSH_HOOK} (auto-push notes)`
        : `  · git hook: ${PRE_PUSH_HOOK} (exists)`,
    );
  }

  // GitHub Action workflow
  if (!skipAction && !hooksOnly) {
    const workflowDir = join(repoRoot, ".github", "workflows");
    const prReportWorkflowPath = join(workflowDir, PR_REPORT_WORKFLOW_FILENAME);

    await mkdir(workflowDir, { recursive: true });

    if (existsSync(prReportWorkflowPath)) {
      results.push(
        `  · workflow already exists at .github/workflows/${PR_REPORT_WORKFLOW_FILENAME}`,
      );
    } else {
      await writeFile(prReportWorkflowPath, PR_REPORT_WORKFLOW_TEMPLATE);
      results.push(`  ✓ workflow created at .github/workflows/${PR_REPORT_WORKFLOW_FILENAME}`);
    }

    if (dashboard) {
      const dashboardWorkflowPath = join(workflowDir, DASHBOARD_WORKFLOW_FILENAME);
      if (existsSync(dashboardWorkflowPath)) {
        results.push(
          `  · workflow already exists at .github/workflows/${DASHBOARD_WORKFLOW_FILENAME}`,
        );
      } else {
        await writeFile(dashboardWorkflowPath, DASHBOARD_WORKFLOW_TEMPLATE);
        results.push(`  ✓ workflow created at .github/workflows/${DASHBOARD_WORKFLOW_FILENAME}`);
      }
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
  console.log("agent-note init");
  console.log("");
  for (const line of results) {
    console.log(line);
  }

  // Determine what needs to be committed
  const toCommit: string[] = [];
  if (!skipHooks && !actionOnly) {
    for (const agentName of agents) {
      const adapter = getAgent(agentName);
      toCommit.push(...(await adapter.managedPaths(repoRoot)));
    }
  }
  if (!skipAction && !hooksOnly) {
    const prReportWorkflowPath = join(
      repoRoot,
      ".github",
      "workflows",
      PR_REPORT_WORKFLOW_FILENAME,
    );
    if (existsSync(prReportWorkflowPath)) {
      toCommit.push(`.github/workflows/${PR_REPORT_WORKFLOW_FILENAME}`);
    }
    if (dashboard) {
      const dashboardWorkflowPath = join(
        repoRoot,
        ".github",
        "workflows",
        DASHBOARD_WORKFLOW_FILENAME,
      );
      if (existsSync(dashboardWorkflowPath)) {
        toCommit.push(`.github/workflows/${DASHBOARD_WORKFLOW_FILENAME}`);
      }
    }
  }

  const uniqueToCommit = [...new Set(toCommit)];
  if (uniqueToCommit.length > 0) {
    console.log("");
    console.log("  Next: commit and push these files");
    console.log(`    git add ${uniqueToCommit.join(" ")}`);
    console.log('    git commit -m "chore: enable agent-note session tracking"');
    console.log("    git push");
    if (dashboard) {
      console.log("    # then enable GitHub Pages for this repository");
    }
    if (agents.includes(AGENT_NAMES.cursor)) {
      console.log("");
      console.log("  Cursor note");
      console.log("    With the default git hooks, plain `git commit` is tracked normally.");
      console.log(
        '    `agent-note commit -m "..."` is still useful as a fallback wrapper when git hooks are unavailable.',
      );
    }
  }
  console.log("");
}

// ─── Git hook helpers ───

/** Resolve the git hooks directory (respects core.hooksPath). */
/** Resolve the effective git hooks directory, respecting `core.hooksPath`. */
export async function resolveHookDir(repoRoot: string): Promise<string> {
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
  const shimPath = join(shimDir, "agent-note");
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
    const existing = await readFile(hookPath, TEXT_ENCODING);
    // Already managed by agentnote — upgrade if content differs.
    if (existing.includes(AGENTNOTE_HOOK_MARKER)) {
      const backupPath = `${hookPath}.agentnote-backup`;
      // Regenerate chained variant if a backup exists, otherwise bare script.
      const target = existsSync(backupPath)
        ? script.replace(
            "#!/bin/sh",
            `#!/bin/sh\n# Chain to original hook — preserve exit status.\nif [ -f ${shellSingleQuote(backupPath)} ]; then ${shellSingleQuote(backupPath)} "$@" || exit $?; fi`,
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
      `#!/bin/sh\n# Chain to original hook — preserve exit status.\nif [ -f ${shellSingleQuote(backupPath)} ]; then ${shellSingleQuote(backupPath)} "$@" || exit $?; fi`,
    );
    await writeFile(hookPath, chainedScript);
    await chmod(hookPath, 0o755);
    return true;
  }

  await writeFile(hookPath, script);
  await chmod(hookPath, 0o755);
  return true;
}
