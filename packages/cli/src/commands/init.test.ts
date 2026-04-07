import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

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
    const output = execSync(`node ${cliPath} init`, {
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
    assert.ok(workflow.includes("wasabeef/agentnote@v0"), "workflow should reference the action");

    // Notes fetch config
    const fetchConfig = execSync("git config --get-all remote.origin.fetch", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(fetchConfig.includes("refs/notes/agentnote"), "should configure notes auto-fetch");

    // Output messages
    assert.ok(output.includes("✓"), "should show success markers");
    assert.ok(output.includes("Next:"), "should show next steps");
  });

  it("is idempotent", () => {
    execSync(`node ${cliPath} init`, { cwd: testDir });
    const output = execSync(`node ${cliPath} init`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("already"), "should indicate already configured");

    // No duplicates in settings
    const settingsPath = join(testDir, ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.equal(settings.hooks.SessionStart.length, 1, "should not duplicate hooks");
  });

  it("--hooks creates only hooks", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-hooks-only-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --hooks`, { cwd: dir });

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
