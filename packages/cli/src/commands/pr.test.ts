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
    execSync(`node ${cliPath} init --agent claude --hooks`, { cwd: testDir });

    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-000000000099";
    writeFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));

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

    assert.ok(output.includes("## 🧑💬🤖 Agent Note"));
    assert.ok(output.includes("feat: add A"));
    assert.ok(output.includes("feat: add B"));
    assert.ok(output.includes("🤖"));
  });

  it("includes prompts section in markdown output", () => {
    const output = execSync(`node ${cliPath} pr HEAD~2`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("## 🧑💬🤖 Agent Note"));
    assert.ok(output.includes("Prompt"));
    assert.ok(output.includes("add feature A"));
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

  it("preserves multi-line prompts with blockquote continuation", () => {
    // Isolated repo so we can seed a multi-line prompt on a fresh commit.
    const mlDir = mkdtempSync(join(tmpdir(), "agentnote-pr-ml-"));
    try {
      execSync("git init", { cwd: mlDir });
      execSync("git config user.email test@test.com", { cwd: mlDir });
      execSync("git config user.name Test", { cwd: mlDir });
      execSync("git commit --allow-empty -m 'init'", { cwd: mlDir });
      execSync(`node ${cliPath} init --agent claude --hooks`, { cwd: mlDir });

      const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-000000000077";
      writeFileSync(join(mlDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
      const sessionDir = join(mlDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));

      // A prompt with a bullet list across several lines — e.g. a review
      // comment or structured feedback.
      const multilinePrompt = [
        "Findings:",
        "- High: something important",
        "- Medium: another concern",
      ].join("\n");
      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        `${JSON.stringify({
          event: "prompt",
          timestamp: "2026-04-06T00:00:00Z",
          prompt: multilinePrompt,
        })}\n`,
      );
      writeFileSync(
        join(sessionDir, CHANGES_FILE),
        `${JSON.stringify({
          event: "file_change",
          tool: "Write",
          file: join(mlDir, "ml.ts"),
        })}\n`,
      );
      writeFileSync(join(mlDir, "ml.ts"), "export const m = 1;");
      execSync("git add .", { cwd: mlDir });
      execSync(`node ${cliPath} commit -m "feat: multi-line prompt"`, { cwd: mlDir });

      const output = execSync(`node ${cliPath} pr HEAD~1`, {
        cwd: mlDir,
        encoding: "utf-8",
      });

      assert.ok(output.includes("Findings:"), "first prompt line should appear");
      assert.ok(
        output.includes("> - High: something important"),
        "subsequent lines should be quoted with > prefix",
      );
      assert.ok(output.includes("> - Medium: another concern"), "third line should also be quoted");
    } finally {
      rmSync(mlDir, { recursive: true, force: true });
    }
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

  it("excludes synthetic merge commits when --head points at the PR head commit", () => {
    const mergeDir = mkdtempSync(join(tmpdir(), "agentnote-pr-merge-"));
    try {
      execSync("git init", { cwd: mergeDir });
      execSync("git config user.email test@test.com", { cwd: mergeDir });
      execSync("git config user.name Test", { cwd: mergeDir });
      execSync("git commit --allow-empty -m 'init'", { cwd: mergeDir });
      execSync(`node ${cliPath} init --agent claude --hooks`, { cwd: mergeDir });
      const defaultBranch = execSync("git branch --show-current", {
        cwd: mergeDir,
        encoding: "utf-8",
      }).trim();

      execSync("git checkout -b feature", { cwd: mergeDir });

      const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-000000000066";
      writeFileSync(join(mergeDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
      const sessionDir = join(mergeDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));
      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","timestamp":"2026-04-06T00:02:00Z","prompt":"ship feature commit"}\n',
      );
      writeFileSync(
        join(sessionDir, CHANGES_FILE),
        `${JSON.stringify({
          event: "file_change",
          tool: "Write",
          file: join(mergeDir, "feature.ts"),
        })}\n`,
      );
      writeFileSync(join(mergeDir, "feature.ts"), "export const feature = true;");
      execSync("git add .", { cwd: mergeDir });
      execSync(`node ${cliPath} commit -m "feat: add feature branch commit"`, { cwd: mergeDir });
      const prHeadSha = execSync("git rev-parse HEAD", { cwd: mergeDir, encoding: "utf-8" }).trim();

      execSync(`git checkout ${defaultBranch}`, { cwd: mergeDir });
      writeFileSync(join(mergeDir, "base.txt"), "base update");
      execSync("git add base.txt", { cwd: mergeDir });
      execSync("git commit -m 'chore: advance base branch'", { cwd: mergeDir });
      const baseSha = execSync("git rev-parse HEAD", { cwd: mergeDir, encoding: "utf-8" }).trim();

      execSync("git merge --no-ff feature -m 'Merge feature into base'", { cwd: mergeDir });

      const output = execSync(`node ${cliPath} pr ${baseSha} --head ${prHeadSha} --json`, {
        cwd: mergeDir,
        encoding: "utf-8",
      });

      const report = JSON.parse(output);
      assert.equal(report.total_commits, 1);
      assert.equal(report.commits.length, 1);
      assert.equal(report.commits[0].message, "feat: add feature branch commit");
    } finally {
      rmSync(mergeDir, { recursive: true, force: true });
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
