import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AGENTNOTE_DIR, NOTES_REF_FULL } from "../core/constants.js";

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function resolveGitPath(cwd: string, value: string): string {
  return isAbsolute(value) ? value : join(cwd, value);
}

describe("agentnote deinit", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-deinit-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("requires --agent flag", () => {
    let threw = false;
    try {
      execSync(`node ${cliPath} deinit`, { cwd: testDir, encoding: "utf-8", stdio: "pipe" });
    } catch (err: unknown) {
      threw = true;
      const e = err as { stderr: string };
      assert.ok(e.stderr.includes("--agent is required"), "should show --agent required error");
    }
    assert.ok(threw, "should exit with error");
  });

  it("rejects unknown agent", () => {
    let threw = false;
    try {
      execSync(`node ${cliPath} deinit --agent unknownagent`, {
        cwd: testDir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err: unknown) {
      threw = true;
      const e = err as { stderr: string };
      assert.ok(e.stderr.includes("unknown agent"), "should show unknown agent error");
    }
    assert.ok(threw, "should exit with error");
  });

  it("rejects repeated --agent flags", () => {
    let threw = false;
    try {
      execSync(`node ${cliPath} deinit --agent claude --agent cursor`, {
        cwd: testDir,
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
  });

  it("removes agent hooks, git hooks, workflow, and notes config after init", () => {
    // First, init
    execSync(`node ${cliPath} init --agent claude`, { cwd: testDir });

    const settingsPath = join(testDir, ".claude", "settings.json");
    assert.ok(existsSync(settingsPath), "settings.json should exist after init");

    const workflowPath = join(testDir, ".github", "workflows", "agentnote-pr-report.yml");
    assert.ok(existsSync(workflowPath), "workflow should exist after init");

    // Verify notes config is set
    const fetchBefore = execSync("git config --get-all remote.origin.fetch", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(fetchBefore.includes(NOTES_REF_FULL), "notes fetch should be configured after init");

    // Now deinit (with --remove-workflow to opt into workflow deletion)
    const output = execSync(`node ${cliPath} deinit --agent claude --remove-workflow`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("✓"), "should show success markers");

    // Agent hooks removed
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.equal(
      Object.keys(settings.hooks ?? {}).length,
      0,
      "agent-note hooks should be removed from settings.json",
    );

    // Git hooks removed
    const hookDir = join(testDir, ".git", "hooks");
    assert.ok(
      !existsSync(join(hookDir, "prepare-commit-msg")),
      "prepare-commit-msg should be removed",
    );
    assert.ok(!existsSync(join(hookDir, "post-commit")), "post-commit should be removed");
    assert.ok(!existsSync(join(hookDir, "pre-push")), "pre-push should be removed");

    // Workflow removed
    assert.ok(!existsSync(workflowPath), "workflow should be removed after deinit");

    // Notes fetch config removed
    const fetchResult = execSync("git config --get-all remote.origin.fetch || true", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(
      !fetchResult.includes(NOTES_REF_FULL),
      "notes fetch config should be removed after deinit",
    );
  });

  it("restores backup git hooks when they exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-deinit-backup-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    // Create a pre-existing post-commit hook
    const hookDir = join(dir, ".git", "hooks");
    mkdirSync(hookDir, { recursive: true });
    const originalHookContent = "#!/bin/sh\necho original-hook\n";
    writeFileSync(join(hookDir, "post-commit"), originalHookContent, { mode: 0o755 });

    // init should chain: backup original and install agent-note hook
    execSync(`node ${cliPath} init --agent claude`, { cwd: dir });

    const backupPath = join(hookDir, "post-commit.agentnote-backup");
    assert.ok(existsSync(backupPath), "backup should exist after init");

    // deinit should restore the original hook
    execSync(`node ${cliPath} deinit --agent claude`, { cwd: dir });

    assert.ok(existsSync(join(hookDir, "post-commit")), "post-commit should be restored");
    const restoredContent = readFileSync(join(hookDir, "post-commit"), "utf-8");
    assert.equal(restoredContent, originalHookContent, "original hook content should be restored");
    assert.ok(!existsSync(backupPath), "backup should be removed after restore");

    rmSync(dir, { recursive: true, force: true });
  });

  it("removes local CLI shim", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-deinit-shim-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, { cwd: dir });

    const shimPath = join(dir, ".git", AGENTNOTE_DIR, "bin", "agent-note");
    assert.ok(existsSync(shimPath), "shim should exist after init");

    execSync(`node ${cliPath} deinit --agent claude`, { cwd: dir });

    assert.ok(!existsSync(shimPath), "shim should be removed after deinit");

    rmSync(dir, { recursive: true, force: true });
  });

  it("removes worktree-local and common CLI shims when run inside a worktree", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-deinit-worktree-shim-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email test@test.com", { cwd: dir });
      execSync("git config user.name Test", { cwd: dir });
      execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
      execSync("git commit --allow-empty -m 'init'", { cwd: dir });

      const worktreeDir = join(dir, "custom worktrees", "cleanup target");
      mkdirSync(join(worktreeDir, ".."), { recursive: true });
      execSync(`git worktree add -b cleanup-target ${shellSingleQuote(worktreeDir)}`, {
        cwd: dir,
      });

      execSync(`node ${cliPath} init --agent claude --no-action`, { cwd: worktreeDir });

      const worktreeGitDir = resolveGitPath(
        worktreeDir,
        execSync("git rev-parse --git-dir", { cwd: worktreeDir, encoding: "utf-8" }).trim(),
      );
      const commonGitDir = resolveGitPath(
        worktreeDir,
        execSync("git rev-parse --git-common-dir", {
          cwd: worktreeDir,
          encoding: "utf-8",
        }).trim(),
      );
      const worktreeShimPath = join(worktreeGitDir, AGENTNOTE_DIR, "bin", "agent-note");
      const commonShimPath = join(commonGitDir, AGENTNOTE_DIR, "bin", "agent-note");

      assert.ok(existsSync(worktreeShimPath), "worktree-local shim should exist after init");
      assert.ok(existsSync(commonShimPath), "common shim should exist after init");

      execSync(`node ${cliPath} deinit --agent claude`, { cwd: worktreeDir });

      assert.ok(!existsSync(worktreeShimPath), "worktree-local shim should be removed");
      assert.ok(!existsSync(commonShimPath), "common shim should be removed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves workflow by default (requires --remove-workflow to delete)", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-deinit-kwf-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude`, { cwd: dir });
    const workflowPath = join(dir, ".github", "workflows", "agentnote-pr-report.yml");
    assert.ok(existsSync(workflowPath), "workflow should exist after init");

    execSync(`node ${cliPath} deinit --agent claude`, { cwd: dir });

    assert.ok(existsSync(workflowPath), "workflow should be preserved without --remove-workflow");

    rmSync(dir, { recursive: true, force: true });
  });

  it("--keep-notes skips notes fetch config removal", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-deinit-kn-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude`, { cwd: dir });

    execSync(`node ${cliPath} deinit --agent claude --keep-notes`, { cwd: dir });

    const fetchResult = execSync("git config --get-all remote.origin.fetch", {
      cwd: dir,
      encoding: "utf-8",
    });
    assert.ok(
      fetchResult.includes(NOTES_REF_FULL),
      "notes fetch config should remain with --keep-notes",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("is idempotent (deinit twice does not error)", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-deinit-idem-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude`, { cwd: dir });
    execSync(`node ${cliPath} deinit --agent claude`, { cwd: dir });
    // Second deinit should not throw
    execSync(`node ${cliPath} deinit --agent claude`, { cwd: dir });

    rmSync(dir, { recursive: true, force: true });
  });

  it("init → deinit → init round-trip works", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-deinit-roundtrip-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude`, { cwd: dir });
    execSync(`node ${cliPath} deinit --agent claude`, { cwd: dir });

    // Re-init should succeed and install hooks again
    execSync(`node ${cliPath} init --agent claude`, { cwd: dir });

    const settingsPath = join(dir, ".claude", "settings.json");
    assert.ok(existsSync(settingsPath), "settings.json should exist after re-init");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.ok(settings.hooks?.SessionStart, "SessionStart hook should be reinstalled");

    const workflowPath = join(dir, ".github", "workflows", "agentnote-pr-report.yml");
    assert.ok(existsSync(workflowPath), "workflow should be recreated after re-init");

    rmSync(dir, { recursive: true, force: true });
  });

  it("removes both new workflow files when initialized with --dashboard", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-deinit-dashboard-workflows-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --dashboard`, { cwd: dir });

    const prWorkflowPath = join(dir, ".github", "workflows", "agentnote-pr-report.yml");
    const dashboardWorkflowPath = join(dir, ".github", "workflows", "agentnote-dashboard.yml");
    assert.ok(existsSync(prWorkflowPath), "PR workflow should exist after init");
    assert.ok(existsSync(dashboardWorkflowPath), "dashboard workflow should exist after init");

    execSync(`node ${cliPath} deinit --agent claude --remove-workflow`, {
      cwd: dir,
      encoding: "utf-8",
    });

    assert.ok(!existsSync(prWorkflowPath), "PR workflow should be removed");
    assert.ok(!existsSync(dashboardWorkflowPath), "dashboard workflow should be removed");

    rmSync(dir, { recursive: true, force: true });
  });
});
