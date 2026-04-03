import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("lore commit", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "lore-commit-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
    execSync(`node ${cliPath} enable`, { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("adds Lore-Session trailer to commit", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    writeFileSync(join(testDir, ".git", "lore", "session"), sessionId);

    writeFileSync(join(testDir, "hello.txt"), "hello");
    execSync("git add hello.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "test commit"`, { cwd: testDir });

    // verify trailer
    const msg = execSync("git log -1 --format=%B", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(
      msg.includes(`Lore-Session: ${sessionId}`),
      "commit should have Lore-Session trailer",
    );
  });

  it("records entry as git note with prompts and AI ratio", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", "lore", "sessions", sessionId);
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
    const note = execSync("git notes --ref=lore show HEAD", {
      cwd: testDir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.v, 1, "should have schema version 1");
    assert.equal(entry.interactions.length, 2, "should have 2 interactions");
    assert.ok(entry.ai_ratio >= 0 && entry.ai_ratio <= 100, "ratio 0-100");
    assert.equal(entry.session_id, sessionId);
    assert.ok(entry.files_in_commit.length > 0);
  });

  it("works without active session (plain git commit)", () => {
    // remove session file
    const sessionFile = join(testDir, ".git", "lore", "session");
    if (existsSync(sessionFile)) rmSync(sessionFile);

    writeFileSync(join(testDir, "plain.txt"), "no session");
    execSync("git add plain.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "plain commit"`, { cwd: testDir });

    const msg = execSync("git log -1 --format=%B", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(
      !msg.includes("Lore-Session"),
      "should not have trailer without session",
    );
  });

  it("rotates prompts and changes after commit", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", "lore", "sessions", sessionId);

    // prompts.jsonl should have been rotated after the previous commit
    const promptsFile = join(sessionDir, "prompts.jsonl");
    assert.ok(
      !existsSync(promptsFile),
      "prompts.jsonl should be rotated after commit",
    );
  });
});
