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

describe("agentnote pr", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-pr-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });

    // Base commit
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });

    // Enable agentnote
    execSync(`node ${cliPath} init --hooks`, { cwd: testDir });

    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-000000000099";
    writeFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    // First commit with prompts and changes
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-06T00:00:00Z","prompt":"add feature A"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"${join(testDir, "a.ts")}"}\n`,
    );
    writeFileSync(join(testDir, "a.ts"), "export const a = 1;");
    execSync("git add .", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: add A"`, { cwd: testDir });

    // Second commit
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-06T00:01:00Z","prompt":"add feature B"}\n',
    );
    writeFileSync(join(testDir, "b.ts"), "export const b = 2;");
    execSync("git add .", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: add B"`, { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("outputs markdown table by default", () => {
    const output = execSync(`node ${cliPath} pr HEAD~2`, { cwd: testDir, encoding: "utf-8" });

    assert.ok(output.includes("## 🤖 Agent Note"));
    assert.ok(output.includes("feat: add A"));
    assert.ok(output.includes("feat: add B"));
    assert.ok(output.includes("🤖"));
  });

  it("outputs chat format with --format chat", () => {
    const output = execSync(`node ${cliPath} pr HEAD~2 --format chat`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("## 🤖 Agent Note"));
    assert.ok(output.includes("🧑 Prompt"));
    assert.ok(output.includes("add feature A"));
    assert.ok(output.includes("<details>"));
    assert.ok(output.includes("</details>"));
  });

  it("outputs JSON with --json", () => {
    const output = execSync(`node ${cliPath} pr HEAD~2 --json`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(output);
    assert.equal(report.total_commits, 2);
    assert.equal(report.tracked_commits, 2);
    assert.ok(report.overall_ai_ratio >= 0);
    assert.equal(report.commits.length, 2);
    assert.equal(report.commits[0].interactions.length, 1);
    assert.equal(report.commits[0].interactions[0].prompt, "add feature A");
  });

  it("includes per-commit AI ratio in JSON", () => {
    const output = execSync(`node ${cliPath} pr HEAD~2 --json`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(output);
    for (const commit of report.commits) {
      assert.ok(commit.ai_ratio !== null, "tracked commit should have ai_ratio");
    }
  });
});

describe("agentnote pr (no data)", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-pr-empty-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
    writeFileSync(join(testDir, "x.txt"), "x");
    execSync("git add . && git commit -m 'plain commit'", { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("shows commits without agentnote data", () => {
    const output = execSync(`node ${cliPath} pr HEAD~1`, { cwd: testDir, encoding: "utf-8" });

    assert.ok(output.includes("plain commit"));
    assert.ok(output.includes("—")); // no data marker
  });
});
