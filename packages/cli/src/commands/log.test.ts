import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AGENTNOTE_DIR, PROMPTS_FILE, SESSION_FILE, SESSIONS_DIR } from "../core/constants.js";

describe("agentnote log", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-log-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });

    // plain commit (no agentnote)
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });

    // agentnote commit
    execSync(`node ${cliPath} init --hooks`, { cwd: testDir });
    const sessionId = "a1b2c3d4-2222-2222-2222-222222222222";
    writeFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"test"}\n',
    );

    writeFileSync(join(testDir, "file1.ts"), "x");
    execSync("git add .", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: with agentnote"`, { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("shows commits with session info and AI ratio from git notes", () => {
    const output = execSync(`node ${cliPath} log`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("feat: with agentnote"), "should show agentnote commit");
    assert.ok(output.includes("init"), "should show plain commit");
    assert.ok(output.includes("🤖"), "should show AI ratio indicator");
  });

  it("respects count argument", () => {
    const output = execSync(`node ${cliPath} log 1`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const lines = output.trim().split("\n");
    assert.equal(lines.length, 1, "should show only 1 commit");
  });
});
