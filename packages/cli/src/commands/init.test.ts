import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENTNOTE_DIR,
  HEARTBEAT_FILE,
  NOTES_REF_FULL,
  PROMPTS_FILE,
  SESSION_FILE,
  SESSIONS_DIR,
  TRAILER_KEY,
} from "../core/constants.js";

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

describe("agentnote init", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-init-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git remote add origin https://example.com/repo.git", {
      cwd: testDir,
    });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates hooks, workflow, and configures notes fetch", () => {
    const output = execSync(`node ${cliPath} init --agent claude`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    // Hooks
    const settingsPath = join(testDir, ".claude", "settings.json");
    assert.ok(existsSync(settingsPath), "settings.json should exist");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.ok(settings.hooks?.SessionStart, "SessionStart hook should exist");

    // PreToolUse should use wildcard pattern to match compound commands
    const raw = JSON.stringify(settings);
    assert.ok(
      raw.includes("Bash(*git commit*)"),
      "PreToolUse if pattern should use wildcard to match compound commands",
    );

    // Workflow
    const workflowPath = join(testDir, ".github", "workflows", "agentnote-pr-report.yml");
    assert.ok(existsSync(workflowPath), "workflow should exist");
    const workflow = readFileSync(workflowPath, "utf-8");
    assert.ok(workflow.includes("wasabeef/AgentNote@v1"), "workflow should reference the action");

    // Notes fetch config
    const fetchConfig = execSync("git config --get-all remote.origin.fetch", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(fetchConfig.includes(NOTES_REF_FULL), "should configure notes auto-fetch");

    const prePushHook = readFileSync(join(testDir, ".git", "hooks", "pre-push"), "utf-8");
    assert.ok(
      prePushHook.includes('"$GIT_DIR/agentnote/bin/agent-note" push-notes "$1"'),
      "pre-push should delegate notes sync to the repo-local shim",
    );
    assert.ok(
      !prePushHook.includes('git push "$REMOTE" refs/notes/agentnote'),
      "pre-push should not embed a stale inline notes push implementation",
    );

    // Output messages
    assert.ok(output.includes("✓"), "should show success markers");
    assert.ok(output.includes("Next:"), "should show next steps");
  });

  it("creates a deterministic repo-local shim for git hooks", () => {
    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const shimPath = join(testDir, ".git", AGENTNOTE_DIR, "bin", "agent-note");
    assert.ok(existsSync(shimPath), "repo-local agentnote shim should exist");

    const shim = readFileSync(shimPath, "utf-8");
    assert.ok(shim.startsWith("#!/bin/sh"), "shim should be executable shell script");
    assert.ok(shim.includes(process.execPath), "shim should pin the current node binary");
    assert.ok(shim.includes("dist/cli.js"), "shim should pin the current CLI path");

    const postCommitHook = readFileSync(join(testDir, ".git", "hooks", "post-commit"), "utf-8");
    assert.ok(
      postCommitHook.includes('"$GIT_DIR/agentnote/bin/agent-note"'),
      "post-commit should prefer the repo-local shim",
    );
    assert.ok(
      !postCommitHook.includes("npx --yes agent-note record"),
      "post-commit should not resolve an unpinned package at commit time",
    );
  });

  it("is idempotent", () => {
    execSync(`node ${cliPath} init --agent claude`, { cwd: testDir });
    const output = execSync(`node ${cliPath} init --agent claude`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("already"), "should indicate already configured");

    // No duplicates in settings
    const settingsPath = join(testDir, ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.equal(settings.hooks.SessionStart.length, 1, "should not duplicate hooks");
  });

  it("upgrades an outdated managed pre-push hook to the shim-based implementation", () => {
    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const outdatedPrePush = `#!/bin/sh
# agentnote-managed
if [ -n "$AGENTNOTE_PUSHING" ]; then exit 0; fi
REMOTE="\${1:-origin}"
AGENTNOTE_PUSHING=1 git push "$REMOTE" refs/notes/agentnote 2>/dev/null &
`;
    const hookPath = join(testDir, ".git", "hooks", "pre-push");
    writeFileSync(hookPath, outdatedPrePush, { mode: 0o755 });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const upgradedHook = readFileSync(hookPath, "utf-8");
    assert.ok(
      upgradedHook.includes('"$GIT_DIR/agentnote/bin/agent-note" push-notes "$1"'),
      "init should upgrade outdated managed pre-push hooks to the shim-based implementation",
    );
    assert.ok(
      !upgradedHook.includes('git push "$REMOTE" refs/notes/agentnote 2>/dev/null &'),
      "outdated async notes push should be removed during upgrade",
    );
  });

  it("quotes chained git hook backup paths for shell-special repository paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-hook-$`'-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    const hookPath = join(dir, ".git", "hooks", "prepare-commit-msg");
    const markerPath = join(dir, "chained-hook-ran");
    writeFileSync(hookPath, `#!/bin/sh\necho ran > ${shellSingleQuote(markerPath)}\n`, {
      mode: 0o755,
    });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const messagePath = join(dir, "message.txt");
    writeFileSync(messagePath, "subject\n");
    execFileSync(hookPath, [messagePath], { cwd: dir });

    assert.ok(existsSync(markerPath), "the chained original hook should run");

    const hook = readFileSync(hookPath, "utf-8");
    assert.ok(!hook.includes('if [ -f "'), "backup path should not use double quotes");

    rmSync(dir, { recursive: true, force: true });
  });

  it("prepare-commit-msg skips metadata-only sessions before injecting trailers", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-prepare-session-data-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const sessionId = "a1b2c3d4-2222-2222-2222-000000000222";
    const sessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));

    const hookPath = join(dir, ".git", "hooks", "prepare-commit-msg");
    const metadataOnlyMessagePath = join(dir, "metadata-only-message.txt");
    writeFileSync(metadataOnlyMessagePath, "subject\n");
    execFileSync(hookPath, [metadataOnlyMessagePath], { cwd: dir });
    assert.ok(
      !readFileSync(metadataOnlyMessagePath, "utf-8").includes(TRAILER_KEY),
      "metadata-only sessions should not receive a trailer",
    );

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"commit this change"}\n',
    );
    const recordableMessagePath = join(dir, "recordable-message.txt");
    writeFileSync(recordableMessagePath, "subject\n");
    execFileSync(hookPath, [recordableMessagePath], { cwd: dir });
    assert.ok(
      readFileSync(recordableMessagePath, "utf-8").includes(`${TRAILER_KEY}: ${sessionId}`),
      "sessions with prompts should receive a trailer",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("pushes notes synchronously alongside the main branch push", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-pre-push-sync-"));
    const remoteDir = mkdtempSync(join(tmpdir(), "agentnote-pre-push-remote-"));

    execSync("git init --bare", { cwd: remoteDir });
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync(`git remote add origin ${remoteDir}`, { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, { cwd: dir });

    writeFileSync(join(dir, "note.txt"), "tracked by note\n");
    execSync("git add note.txt", { cwd: dir });
    execSync("git commit -m 'feat: add note target'", { cwd: dir });
    execSync("git notes --ref=agentnote add -m '{\"v\":1}' HEAD", { cwd: dir });

    execSync("git push -u origin HEAD", { cwd: dir, encoding: "utf-8" });

    const remoteNotesRef = execSync("git rev-parse --verify refs/notes/agentnote", {
      cwd: remoteDir,
      encoding: "utf-8",
    }).trim();
    assert.ok(remoteNotesRef.length > 0, "remote notes ref should exist immediately after push");

    rmSync(dir, { recursive: true, force: true });
    rmSync(remoteDir, { recursive: true, force: true });
  });

  it("--hooks creates only hooks", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-hooks-only-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --hooks`, { cwd: dir });

    assert.ok(existsSync(join(dir, ".claude", "settings.json")), "hooks should exist");
    assert.ok(
      !existsSync(join(dir, ".github", "workflows", "agentnote-pr-report.yml")),
      "workflow should NOT exist",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("--action creates only workflow", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-action-only-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --action`, { cwd: dir });

    assert.ok(!existsSync(join(dir, ".claude", "settings.json")), "hooks should NOT exist");
    assert.ok(
      existsSync(join(dir, ".github", "workflows", "agentnote-pr-report.yml")),
      "workflow should exist",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("supports multiple agents after a single --agent flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-init-multi-agent-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude cursor`, {
      cwd: dir,
      encoding: "utf-8",
    });

    assert.ok(existsSync(join(dir, ".claude", "settings.json")));
    assert.ok(existsSync(join(dir, ".cursor", "hooks.json")));

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects repeated --agent flags", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-init-repeat-agent-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    let threw = false;
    try {
      execSync(`node ${cliPath} init --agent claude --agent cursor`, {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err: unknown) {
      threw = true;
      const e = err as { stderr: string };
      assert.ok(
        e.stderr.includes("repeat --agent is not supported"),
        "should reject repeated --agent flags",
      );
    }
    assert.ok(threw, "should exit with error");

    rmSync(dir, { recursive: true, force: true });
  });

  it("--dashboard creates the additional dashboard workflow", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-init-dashboard-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --dashboard`, {
      cwd: dir,
      encoding: "utf-8",
    });

    assert.ok(
      existsSync(join(dir, ".github", "workflows", "agentnote-pr-report.yml")),
      "PR report workflow should exist",
    );
    assert.ok(
      existsSync(join(dir, ".github", "workflows", "agentnote-dashboard.yml")),
      "dashboard workflow should exist",
    );

    const dashboardWorkflow = readFileSync(
      join(dir, ".github", "workflows", "agentnote-dashboard.yml"),
      "utf-8",
    );
    const prReportWorkflow = readFileSync(
      join(dir, ".github", "workflows", "agentnote-pr-report.yml"),
      "utf-8",
    );
    assert.ok(
      dashboardWorkflow.includes("name: Agent Note Dashboard"),
      "dashboard workflow should have the new name",
    );
    assert.ok(
      dashboardWorkflow.includes("uses: wasabeef/AgentNote@v1"),
      "dashboard workflow should use the public Agent Note action",
    );
    assert.ok(
      dashboardWorkflow.includes("dashboard: true"),
      "dashboard workflow should enable the Dashboard mode on the public action",
    );
    assert.ok(
      dashboardWorkflow.includes(
        ["should_deploy:", "$" + "{{ steps.dashboard.outputs.should_deploy }}"].join(" "),
      ),
      "dashboard workflow should expose the shared action deploy decision",
    );
    assert.ok(
      dashboardWorkflow.includes("uses: actions/deploy-pages@v4"),
      "dashboard workflow should keep the GitHub Pages deployment job",
    );
    assert.ok(
      !dashboardWorkflow.includes(".agentnote-dashboard-source"),
      "dashboard workflow should not expose the Dashboard source checkout path",
    );
    assert.ok(
      !dashboardWorkflow.includes("NOTES_DIR:"),
      "dashboard workflow should keep note storage paths inside the shared action",
    );
    assert.ok(
      !dashboardWorkflow.includes("PAGES_DIR:"),
      "dashboard workflow should keep Pages artifact paths inside the shared action",
    );
    assert.ok(
      !dashboardWorkflow.includes("packages/dashboard@v1"),
      "dashboard workflow should not expose the internal Dashboard package path",
    );
    assert.ok(
      !dashboardWorkflow.includes("branches:\n      - main"),
      "dashboard workflow should not hardcode main as the deploy branch",
    );
    assert.ok(
      prReportWorkflow.includes(`GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}`),
      "PR report workflow should pass GITHUB_TOKEN to the action",
    );

    rmSync(dir, { recursive: true, force: true });
  });
});
