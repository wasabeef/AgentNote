import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENTNOTE_DIR,
  CHANGES_FILE,
  HEARTBEAT_FILE,
  PROMPTS_FILE,
  SESSION_FILE,
  SESSIONS_DIR,
} from "../core/constants.js";

describe("agentnote session", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");
  const sessionId = "b2c3d4e5-2222-2222-2222-222222222222";

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-session-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync(`node ${cliPath} init --agent claude --hooks`, { cwd: testDir });

    // Create two commits with the same session, each with an agentnote note.
    for (let i = 1; i <= 2; i++) {
      // Simulate a session
      writeFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
      const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        `{"event":"prompt","timestamp":"2026-04-02T10:0${i}:00Z","prompt":"implement step ${i}"}\n`,
      );
      writeFileSync(
        join(sessionDir, CHANGES_FILE),
        `{"event":"file_change","tool":"Write","file":"${join(testDir, `step${i}.ts`)}"}\n`,
      );

      writeFileSync(join(testDir, `step${i}.ts`), `export function step${i}() {}`);
      execSync("git add .", { cwd: testDir });
      execSync(`node ${cliPath} commit -m "feat: step ${i}"`, { cwd: testDir });
    }
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("finds all commits for a session and displays summary", () => {
    const output = execSync(`node ${cliPath} session ${sessionId}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes(`Session: ${sessionId}`), "should show session ID");
    assert.ok(output.includes("Commits: 2"), "should find 2 commits");
    assert.ok(output.includes("step 1"), "should include first commit");
    assert.ok(output.includes("step 2"), "should include second commit");
    assert.ok(output.includes("Total:"), "should show total summary");
    assert.ok(output.includes("prompts"), "should show prompt count in summary");
  });

  it("shows 'no commits found' for unknown session", () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";
    const output = execSync(`node ${cliPath} session ${unknownId}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("no commits found"), "should indicate no commits");
  });
});
