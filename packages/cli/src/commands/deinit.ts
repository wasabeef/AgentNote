import { existsSync } from "node:fs";
import { readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getAgent, hasAgent, listAgents } from "../agents/index.js";
import {
  AGENTNOTE_HOOK_MARKER,
  GIT_HOOK_NAMES,
  NOTES_FETCH_REFSPEC,
  TEXT_ENCODING,
} from "../core/constants.js";
import { gitSafe } from "../git.js";
import { agentnoteDir, commonAgentnoteDir, root } from "../paths.js";
import {
  DASHBOARD_WORKFLOW_FILENAME,
  PR_REPORT_WORKFLOW_FILENAME,
  parseAgentArgs,
  resolveHookDir,
} from "./init.js";

/**
 * Check if any agent (other than those being removed) still has hooks enabled.
 * If so, shared infrastructure (git hooks, workflow, notes config) must be preserved.
 */
async function hasOtherEnabledAgents(repoRoot: string, removingAgents: string[]): Promise<boolean> {
  const removing = new Set(removingAgents);
  for (const name of listAgents()) {
    if (removing.has(name)) continue;
    if (await getAgent(name).isEnabled(repoRoot)) return true;
  }
  return false;
}

/**
 * Remove a single git hook installed by agentnote.
 * - If a backup exists, restore it.
 * - If no backup exists, delete the hook file.
 * - If the hook has no agentnote marker, leave it untouched.
 * Returns true if the hook was removed/restored.
 */
async function removeGitHook(hookDir: string, name: string): Promise<boolean> {
  const hookPath = join(hookDir, name);
  if (!existsSync(hookPath)) return false;

  const content = await readFile(hookPath, TEXT_ENCODING);
  if (!content.includes(AGENTNOTE_HOOK_MARKER)) return false;

  const backupPath = `${hookPath}.agentnote-backup`;
  if (existsSync(backupPath)) {
    await rename(backupPath, hookPath);
  } else {
    await unlink(hookPath);
  }
  return true;
}

/** Remove Agent Note agent hooks, managed git hooks, and optional workflow state. */
export async function deinit(args: string[]): Promise<void> {
  let agents: string[] = [];
  try {
    agents = parseAgentArgs(args);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exit(1);
  }

  const removeWorkflow = args.includes("--remove-workflow");
  const keepNotes = args.includes("--keep-notes");

  if (agents.length === 0) {
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

  // Agent hooks
  for (const agentName of agents) {
    const adapter = getAgent(agentName);
    await adapter.removeHooks(repoRoot);
    results.push(`  ✓ hooks removed for ${adapter.name}`);
  }

  // Only remove shared infrastructure (git hooks, shim, workflow, notes config)
  // when no other agent still has hooks enabled. This prevents deinit --agent claude
  // from breaking codex/cursor/gemini tracking in a multi-agent setup.
  const othersEnabled = await hasOtherEnabledAgents(repoRoot, agents);

  if (!othersEnabled) {
    // Git hooks (prepare-commit-msg, post-commit, pre-push)
    const hookDir = await resolveHookDir(repoRoot);
    for (const name of GIT_HOOK_NAMES) {
      const removed = await removeGitHook(hookDir, name);
      if (removed) {
        results.push(`  ✓ git hook: ${name} removed`);
      } else {
        results.push(`  · git hook: ${name} (not found or not managed by agentnote)`);
      }
    }

    // Local CLI shim
    const shimPaths = new Set([
      join(await agentnoteDir(), "bin", "agent-note"),
      join(await commonAgentnoteDir(), "bin", "agent-note"),
    ]);
    let removedShim = false;
    for (const shimPath of shimPaths) {
      if (!existsSync(shimPath)) continue;
      await unlink(shimPath);
      removedShim = true;
    }
    if (removedShim) {
      results.push("  ✓ removed local CLI shim");
    }

    // GitHub Action workflow — only remove when explicitly requested, because
    // init skips creation if the file already exists. Removing a pre-existing
    // user-owned workflow would be destructive.
    if (removeWorkflow) {
      const workflowPaths = [
        join(repoRoot, ".github", "workflows", PR_REPORT_WORKFLOW_FILENAME),
        join(repoRoot, ".github", "workflows", DASHBOARD_WORKFLOW_FILENAME),
      ];

      for (const workflowPath of workflowPaths) {
        if (!existsSync(workflowPath)) continue;
        await unlink(workflowPath);
        results.push(`  ✓ removed ${workflowPath.replace(`${repoRoot}/`, "")}`);
      }
    }

    // Auto-fetch notes config
    if (!keepNotes) {
      await gitSafe([
        "config",
        "--unset",
        "--fixed-value",
        "remote.origin.fetch",
        NOTES_FETCH_REFSPEC,
      ]);
      results.push("  ✓ removed notes auto-fetch config");
    }
  } else {
    results.push("  · shared infrastructure preserved (other agents still enabled)");
  }

  // Output
  console.log("");
  console.log("agent-note deinit");
  console.log("");
  for (const line of results) {
    console.log(line);
  }
  console.log("");
}
