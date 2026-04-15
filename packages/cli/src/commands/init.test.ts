import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AGENTNOTE_DIR, NOTES_REF_FULL } from "../core/constants.js";

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
    const workflowPath = join(testDir, ".github", "workflows", "agentnote.yml");
    assert.ok(existsSync(workflowPath), "workflow should exist");
    const workflow = readFileSync(workflowPath, "utf-8");
    assert.ok(workflow.includes("wasabeef/AgentNote@v0"), "workflow should reference the action");

    // Notes fetch config
    const fetchConfig = execSync("git config --get-all remote.origin.fetch", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(fetchConfig.includes(NOTES_REF_FULL), "should configure notes auto-fetch");

    const prePushHook = readFileSync(join(testDir, ".git", "hooks", "pre-push"), "utf-8");
    assert.ok(
      prePushHook.includes("git rev-parse --verify refs/notes/agentnote >/dev/null 2>&1"),
      "pre-push should skip until a local notes ref exists",
    );
    assert.ok(
      prePushHook.includes(
        'AGENTNOTE_PUSHING=1 git push "$REMOTE" refs/notes/agentnote >/dev/null 2>&1 || true',
      ),
      "pre-push should wait for notes push completion without blocking code push",
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

    const shimPath = join(testDir, ".git", AGENTNOTE_DIR, "bin", "agentnote");
    assert.ok(existsSync(shimPath), "repo-local agentnote shim should exist");

    const shim = readFileSync(shimPath, "utf-8");
    assert.ok(shim.startsWith("#!/bin/sh"), "shim should be executable shell script");
    assert.ok(shim.includes(process.execPath), "shim should pin the current node binary");
    assert.ok(shim.includes("dist/cli.js"), "shim should pin the current CLI path");

    const postCommitHook = readFileSync(join(testDir, ".git", "hooks", "post-commit"), "utf-8");
    assert.ok(
      postCommitHook.includes('"$GIT_DIR/agentnote/bin/agentnote"'),
      "post-commit should prefer the repo-local shim",
    );
    assert.ok(
      !postCommitHook.includes("npx --yes agentnote record"),
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

  it("upgrades legacy Claude hook commands to --agent form", () => {
    const settingsPath = join(testDir, ".claude", "settings.json");
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                hooks: [{ type: "command", command: "npx --yes agentnote hook", async: true }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    execSync(`node ${cliPath} init --agent claude --hooks --no-git-hooks`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const raw = JSON.stringify(settings);
    assert.ok(raw.includes("--agent claude"), "should migrate to explicit Claude hook");
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
      !existsSync(join(dir, ".github", "workflows", "agentnote.yml")),
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
      existsSync(join(dir, ".github", "workflows", "agentnote.yml")),
      "workflow should exist",
    );

    rmSync(dir, { recursive: true, force: true });
  });
});
