import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

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
    assert.ok(output.includes("session: none"), "should show no session");
  });

  it("shows 'active' after start", () => {
    execSync(`node ${cliPath} init --hooks`, { cwd: testDir });

    const output = execSync(`node ${cliPath} status`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("hooks:   active"), "should show hooks active");
  });

  it("shows session ID when session is active", () => {
    writeFileSync(
      join(testDir, ".git", "agentnote", "session"),
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
