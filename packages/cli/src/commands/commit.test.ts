import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

describe("agentnote commit", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-commit-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
    execSync(`node ${cliPath} init --hooks`, { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("adds Agentnote-Session trailer to commit", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    writeFileSync(join(testDir, ".git", "agentnote", "session"), sessionId);

    writeFileSync(join(testDir, "hello.txt"), "hello");
    execSync("git add hello.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "test commit"`, { cwd: testDir });

    // verify trailer
    const msg = execSync("git log -1 --format=%B", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(
      msg.includes(`Agentnote-Session: ${sessionId}`),
      "commit should have Agentnote-Session trailer",
    );
  });

  it("records entry as git note with prompts and AI ratio", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", "agentnote", "sessions", sessionId);
    mkdirSync(sessionDir, { recursive: true });

    // simulate prompts
    writeFileSync(
      join(sessionDir, "prompts.jsonl"),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"add feature"}\n' +
        '{"event":"prompt","timestamp":"2026-04-02T10:05:00Z","prompt":"fix bug"}\n',
    );

    // simulate AI file changes
    const absPath = join(testDir, "ai-file.ts");
    writeFileSync(
      join(sessionDir, "changes.jsonl"),
      `{"event":"file_change","tool":"Write","file":"${absPath}"}\n`,
    );

    writeFileSync(absPath, "export const x = 1;");
    writeFileSync(join(testDir, "human-file.ts"), "export const y = 2;");
    execSync("git add .", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "mixed commit"`, { cwd: testDir });

    // verify git note exists
    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: testDir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.v, 2, "should have schema version 2");
    assert.equal(entry.interactions.length, 2, "should have 2 interactions");
    assert.ok(entry.ai_ratio >= 0 && entry.ai_ratio <= 100, "ratio 0-100");
    assert.equal(entry.session_id, sessionId);
    assert.ok(entry.files_in_commit.length > 0);
  });

  it("works without active session (plain git commit)", () => {
    // remove session file
    const sessionFile = join(testDir, ".git", "agentnote", "session");
    if (existsSync(sessionFile)) rmSync(sessionFile);

    writeFileSync(join(testDir, "plain.txt"), "no session");
    execSync("git add plain.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "plain commit"`, { cwd: testDir });

    const msg = execSync("git log -1 --format=%B", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(!msg.includes("Agentnote-Session"), "should not have trailer without session");
  });

  it("preserves logs after commit for split-commit support", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", "agentnote", "sessions", sessionId);

    // prompts.jsonl should NOT be rotated after commit (rotation happens at next prompt).
    // This allows split commits to each read the same session data.
    const promptsFile = join(sessionDir, "prompts.jsonl");
    assert.ok(existsSync(promptsFile), "prompts.jsonl should be preserved after commit");
  });

  it("extracts responses from transcript when available", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", "agentnote", "sessions", sessionId);
    writeFileSync(join(testDir, ".git", "agentnote", "session"), sessionId);
    mkdirSync(sessionDir, { recursive: true });

    // Create a transcript file under ~/.claude/ (valid path)
    const transcriptDir = join(homedir(), ".claude", "projects", "commit-test", "sessions");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`);
    writeFileSync(
      transcriptPath,
      '{"type":"user","message":{"content":[{"type":"text","text":"implement auth"}]}}\n' +
        '{"type":"assistant","message":{"content":[{"type":"text","text":"I will create the auth module."}]}}\n',
    );

    // Point session to transcript
    writeFileSync(join(sessionDir, "transcript_path"), transcriptPath);

    // Add prompt
    writeFileSync(
      join(sessionDir, "prompts.jsonl"),
      '{"event":"prompt","timestamp":"2026-04-06T00:00:00Z","prompt":"implement auth"}\n',
    );

    writeFileSync(join(testDir, "auth.ts"), "export {}");
    execSync("git add auth.ts", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: auth with transcript"`, {
      cwd: testDir,
    });

    // Verify response is in the note
    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: testDir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.interactions[0].prompt, "implement auth");
    assert.equal(entry.interactions[0].response, "I will create the auth module.");

    // Clean up transcript
    rmSync(transcriptPath);
    rmSync(join(transcriptDir), { recursive: true, force: true });
  });
});
