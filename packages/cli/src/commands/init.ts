import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { getAgent, hasAgent, listAgents } from "../agents/index.js";
import {
  AGENTNOTE_HOOK_MARKER,
  NOTES_FETCH_REFSPEC,
  NOTES_REF_FULL,
  TRAILER_KEY,
} from "../core/constants.js";
import { git, gitSafe } from "../git.js";
import { agentnoteDir, root } from "../paths.js";

export const PR_REPORT_WORKFLOW_FILENAME = "agentnote-pr-report.yml";
export const DASHBOARD_WORKFLOW_FILENAME = "agentnote-dashboard.yml";

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
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - uses: wasabeef/AgentNote@v0
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
      should_deploy: \${{ steps.notes.outputs.should_deploy }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: 22

      - name: Restore Dashboard notes from gh-pages
        run: |
          set -euo pipefail
          NOTES_DIR=".agentnote-dashboard-notes"
          rm -rf "$NOTES_DIR"
          mkdir -p "$NOTES_DIR"

          if git fetch origin gh-pages --depth=1 2>/dev/null; then
            TMP_DIR="$(mktemp -d)"
            if git archive --format=tar FETCH_HEAD dashboard/notes 2>/dev/null | tar -xf - -C "$TMP_DIR"; then
              if [ -d "$TMP_DIR/dashboard/notes" ]; then
                cp -R "$TMP_DIR/dashboard/notes/." "$NOTES_DIR/"
              fi
            fi
          fi

      - name: Update Dashboard notes from git notes
        id: notes
        env:
          NOTES_DIR: .agentnote-dashboard-notes
          EVENT_NAME: \${{ github.event_name }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: \${{ github.repository }}
          DEFAULT_BRANCH: \${{ github.event.repository.default_branch }}
          BEFORE_SHA: \${{ github.event.before }}
          HEAD_SHA: \${{ github.sha }}
          REF_NAME: \${{ github.ref_name }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
          PR_TITLE: \${{ github.event.pull_request.title }}
          PR_HEAD_REPO: \${{ github.event.pull_request.head.repo.full_name }}
        run: |
          set -euo pipefail
          git fetch origin refs/notes/agentnote:refs/notes/agentnote || true

          node --input-type=module <<'NODE'
          import { execFileSync } from "node:child_process";
          import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
          import { join } from "node:path";

          const notesDir = process.env.NOTES_DIR || ".agentnote-dashboard-notes";
          const eventName = process.env.EVENT_NAME || "";
          const before = process.env.BEFORE_SHA || "";
          const defaultBranch = process.env.DEFAULT_BRANCH || "";
          const head = process.env.HEAD_SHA || "";
          const repo = process.env.GITHUB_REPOSITORY || "";
          const prNumber = Number(process.env.PR_NUMBER || "");
          const prTitle = process.env.PR_TITLE || "";
          const prHeadRepo = process.env.PR_HEAD_REPO || "";
          const refName = process.env.REF_NAME || "";
          const githubOutput = process.env.GITHUB_OUTPUT || "";
          const zeroSha = /^0+$/;

          mkdirSync(notesDir, { recursive: true });

          function run(command, args) {
            return execFileSync(command, args, {
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
              env: process.env,
            }).trim();
          }

          function readGitNote(sha) {
            let raw = "";
            try {
              raw = run("git", ["notes", "--ref=agentnote", "show", sha]);
            } catch {
              return null;
            }
            if (!raw) return null;
            return JSON.parse(raw);
          }

          function writeDashboardNote(sha, pullRequest) {
            const note = readGitNote(sha);
            if (!note) return false;

            const commit = note.commit && typeof note.commit === "object" ? note.commit : {};
            const shortSha =
              typeof commit.short_sha === "string" && commit.short_sha
                ? commit.short_sha
                : sha.slice(0, 7);

            note.commit = {
              ...commit,
              sha: typeof commit.sha === "string" && commit.sha ? commit.sha : sha,
              short_sha: shortSha,
            };

            if (pullRequest) {
              note.pull_request = pullRequest;
            } else {
              delete note.pull_request;
            }

            writeFileSync(join(notesDir, \`\${shortSha}.json\`), \`\${JSON.stringify(note, null, 2)}\\n\`);
            return true;
          }

          function listNoteFiles() {
            return readdirSync(notesDir)
              .filter((name) => name.endsWith(".json"))
              .map((name) => join(notesDir, name));
          }

          function readDashboardNote(path) {
            try {
              return JSON.parse(readFileSync(path, "utf-8"));
            } catch {
              return null;
            }
          }

          function removeNotesForPr(currentPrNumber) {
            for (const path of listNoteFiles()) {
              const note = readDashboardNote(path);
              if (note?.pull_request?.number === currentPrNumber) {
                rmSync(path, { force: true });
              }
            }
          }

          function updateNotesForPr(currentPrNumber, patch) {
            for (const path of listNoteFiles()) {
              const note = readDashboardNote(path);
              if (note?.pull_request?.number !== currentPrNumber) continue;
              note.pull_request = {
                ...note.pull_request,
                ...patch,
              };
              writeFileSync(path, \`\${JSON.stringify(note, null, 2)}\\n\`);
            }
          }

          function fetchPullRequestCommits(currentPrNumber) {
            try {
              const raw = run("gh", [
                "api",
                \`repos/\${repo}/pulls/\${currentPrNumber}/commits\`,
                "--paginate",
                "--slurp",
              ]);
              const pages = JSON.parse(raw);
              const commits = Array.isArray(pages) ? pages.flat() : [];
              return commits
                .map((commit) => (typeof commit?.sha === "string" ? commit.sha : ""))
                .filter(Boolean);
            } catch {
              return [];
            }
          }

          function fetchCommitPulls(sha) {
            try {
              const raw = run("gh", [
                "api",
                \`repos/\${repo}/commits/\${sha}/pulls\`,
                "--header",
                "Accept: application/vnd.github+json",
              ]);
              return JSON.parse(raw);
            } catch {
              return [];
            }
          }

          function buildCommitRange() {
            if (before && !zeroSha.test(before)) {
              return run("git", ["rev-list", "--reverse", \`\${before}..\${head}\`])
                .split(/\\s+/)
                .filter(Boolean);
            }
            return head ? [head] : [];
          }

          function setOutput(name, value) {
            if (!githubOutput) return;
            writeFileSync(githubOutput, \`\${name}=\${value}\\n\`, { flag: "a" });
          }

          function setFlags({ build, persist, deploy }) {
            setOutput("should_build", build);
            setOutput("should_persist", persist);
            setOutput("should_deploy", deploy);
          }

          if (eventName === "pull_request") {
            if (!Number.isInteger(prNumber) || !prTitle) {
              console.log("Pull request metadata is missing.");
              setFlags({ build: "false", persist: "false", deploy: "false" });
              process.exit(0);
            }

            const isForkPullRequest = prHeadRepo && repo && prHeadRepo !== repo;
            if (isForkPullRequest) {
              console.log(\`Skip Dashboard note persistence for fork pull request #\${prNumber}.\`);
            }

            setFlags({
              build: "true",
              persist: isForkPullRequest ? "false" : "true",
              deploy: "false",
            });
            removeNotesForPr(prNumber);

            const pullRequest = {
              number: prNumber,
              title: prTitle,
              state: "open",
            };

            for (const sha of fetchPullRequestCommits(prNumber)) {
              writeDashboardNote(sha, pullRequest);
            }
          } else {
            if (defaultBranch && refName && refName !== defaultBranch) {
              console.log(\`Skip Dashboard publish on non-default branch \${refName}.\`);
              setFlags({ build: "false", persist: "false", deploy: "false" });
              process.exit(0);
            }

            setFlags({ build: "true", persist: "true", deploy: "true" });
            const mergedPullRequests = new Map();
            for (const sha of buildCommitRange()) {
              const pulls = fetchCommitPulls(sha);
              const merged = pulls
                .filter((pull) => pull && pull.merged_at)
                .sort((left, right) =>
                  String(right.merged_at || "").localeCompare(String(left.merged_at || "")),
                );
              const pull = merged[0] || pulls[0] || null;
              const pullRequest =
                pull && typeof pull.number === "number" && typeof pull.title === "string"
                  ? {
                      number: pull.number,
                      title: pull.title,
                      state: pull.merged_at ? "merged" : "open",
                    }
                  : null;
              if (writeDashboardNote(sha, pullRequest) && pullRequest) {
                mergedPullRequests.set(pullRequest.number, pullRequest);
              }
            }

            for (const pullRequest of mergedPullRequests.values()) {
              updateNotesForPr(pullRequest.number, { state: pullRequest.state });
            }
          }
          NODE

      - name: Check out Dashboard source
        if: steps.notes.outputs.should_build == 'true'
        uses: actions/checkout@v6
        with:
          repository: wasabeef/AgentNote
          ref: v0
          path: .agentnote-dashboard-source

      - name: Install Dashboard dependencies
        if: steps.notes.outputs.should_build == 'true'
        run: npm ci --prefix .agentnote-dashboard-source

      - name: Build Dashboard
        if: steps.notes.outputs.should_build == 'true'
        env:
          REPO_OWNER: \${{ github.repository_owner }}
          REPO_NAME: \${{ github.event.repository.name }}
          PUBLIC_REPO: \${{ github.repository }}
        run: |
          set -euo pipefail

          mkdir -p .agentnote-dashboard-source/packages/dashboard/public/notes
          rm -rf .agentnote-dashboard-source/packages/dashboard/public/notes/*
          cp -R .agentnote-dashboard-notes/. .agentnote-dashboard-source/packages/dashboard/public/notes/

          export SITE="https://$REPO_OWNER.github.io"
          if [ "$REPO_NAME" = "$REPO_OWNER.github.io" ]; then
            export BASE="/dashboard"
          else
            export BASE="/$REPO_NAME/dashboard"
          fi

          npm run build --prefix .agentnote-dashboard-source/packages/dashboard

      - name: Assemble Pages artifact
        if: steps.notes.outputs.should_build == 'true'
        run: |
          set -euo pipefail
          rm -rf .pages
          mkdir -p .pages/dashboard
          cp -R .agentnote-dashboard-source/packages/dashboard/dist/. .pages/dashboard/

      - name: Persist Dashboard notes to gh-pages
        if: steps.notes.outputs.should_persist == 'true'
        run: |
          set -euo pipefail
          TMP_DIR="$(mktemp -d)"
          cp -R .agentnote-dashboard-notes "$TMP_DIR/notes"

          if git fetch origin gh-pages --depth=1 2>/dev/null; then
            git checkout -B gh-pages FETCH_HEAD
          else
            git checkout --orphan gh-pages
            git rm -rf . >/dev/null 2>&1 || true
          fi

          mkdir -p dashboard/notes
          rm -rf dashboard/notes/*
          cp -R "$TMP_DIR/notes/." dashboard/notes/

          if git diff --quiet -- dashboard/notes; then
            echo "No Dashboard note changes to persist."
            exit 0
          fi

          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add dashboard/notes
          git commit -m "chore: update Dashboard notes"
          git push origin gh-pages

      - name: Upload Pages artifact
        if: steps.notes.outputs.should_deploy == 'true'
        uses: actions/upload-pages-artifact@v5
        with:
          path: .pages

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
    if (agents.includes("cursor")) {
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
