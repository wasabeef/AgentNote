import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENTNOTE_DIR,
  CHANGES_FILE,
  PROMPTS_FILE,
  SESSION_FILE,
  SESSIONS_DIR,
} from "../core/constants.js";

describe("agentnote show", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-show-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync(`node ${cliPath} init --hooks --no-git-hooks`, { cwd: testDir });

    // simulate a session
    const sessionId = "a1b2c3d4-1111-1111-1111-111111111111";
    writeFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"implement feature X"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"${join(testDir, "feature.ts")}"}\n`,
    );

    writeFileSync(join(testDir, "feature.ts"), "export function x() {}");
    execSync("git add .", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: feature X"`, { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("displays commit info, AI ratio, files, and prompts from git notes", () => {
    const output = execSync(`node ${cliPath} show`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("commit:"), "should show commit");
    assert.ok(output.includes("session:"), "should show session");
    assert.ok(output.includes("ai:"), "should show AI ratio");
    assert.ok(output.includes("files:"), "should show files count");
    assert.ok(output.includes("prompts:"), "should show prompts count");
    assert.ok(output.includes("implement feature X"), "should show prompt text");
  });

  it("shows 'none' for commit without session", () => {
    // Remove session file so hooks don't inject trailer or record note.
    const sessionPath = join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE);
    try {
      rmSync(sessionPath);
    } catch {
      /* already gone */
    }
    execSync("git commit --allow-empty -m 'no session'", { cwd: testDir });
    const output = execSync(`node ${cliPath} show`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("none"), "should indicate no agentnote data");
  });
});
