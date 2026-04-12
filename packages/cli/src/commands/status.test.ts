import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AGENTNOTE_DIR, SESSION_FILE } from "../core/constants.js";

describe("agentnote status", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-status-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("shows 'not configured' before start", () => {
    const output = execSync(`node ${cliPath} status`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("not configured"), "should show not configured");
    assert.ok(output.includes("commit:  not configured"), "should show commit not configured");
    assert.ok(output.includes("session: none"), "should show no session");
  });

  it("shows 'active' after start", () => {
    execSync(`node ${cliPath} init --agent cursor --hooks --no-git-hooks`, { cwd: testDir });

    const output = execSync(`node ${cliPath} status`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("agent:   active"), "should show agent hooks active");
    assert.ok(
      output.includes("capture: cursor(prompt, response, edits, shell)"),
      "should show cursor capture capabilities",
    );
    assert.ok(output.includes("git:     not configured"), "should show git hooks missing");
    assert.ok(output.includes("commit:  fallback mode"), "should show fallback mode");
  });

  it("shows git hooks as the primary commit path when fully configured", () => {
    execSync(`node ${cliPath} init --agent cursor --no-action`, { cwd: testDir });

    const output = execSync(`node ${cliPath} status`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("agent:   active"), "should show agent hooks active");
    assert.ok(
      output.includes("capture: cursor(prompt, response, edits, shell)"),
      "should show cursor capture capabilities",
    );
    assert.ok(
      output.includes("git:     active (prepare-commit-msg, post-commit, pre-push)"),
      "should show managed git hooks",
    );
    assert.ok(output.includes("commit:  tracked via git hooks"), "should show primary path");
  });

  it("shows session ID when session is active", () => {
    writeFileSync(
      join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE),
      "a1b2c3d4-3333-3333-3333-333333333333",
    );

    const output = execSync(`node ${cliPath} status`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("a1b2c3d4…"), "should show truncated session ID");
  });

  it("shows linked commit count", () => {
    const output = execSync(`node ${cliPath} status`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("linked:"), "should show linked count");
  });
});
