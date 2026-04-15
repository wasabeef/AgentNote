import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AGENTNOTE_DIR, CHANGES_FILE, PROMPTS_FILE, SESSIONS_DIR } from "./constants.js";
import { recordCommitEntry } from "./record.js";
import { readNote } from "./storage.js";

const SESSION_ID = "a0000000-0000-4000-8000-000000000001";

function setupGitRepo(): { repoDir: string; agentnoteDirPath: string; sessionDir: string } {
  const repoDir = mkdtempSync(join(tmpdir(), "agentnote-record-"));
  execSync("git init", { cwd: repoDir });
  execSync("git config user.email test@test.com", { cwd: repoDir });
  execSync("git config user.name Test", { cwd: repoDir });
  execSync("git commit --allow-empty -m initial", { cwd: repoDir });

  const agentnoteDirPath = join(repoDir, ".git", AGENTNOTE_DIR);
  const sessionDir = join(agentnoteDirPath, SESSIONS_DIR, SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });

  // Write agent file so the adapter is known
  writeFileSync(join(sessionDir, "agent"), "claude\n");

  return { repoDir, agentnoteDirPath, sessionDir };
}

describe("recordCommitEntry", () => {
  let repoDir: string;
  let agentnoteDirPath: string;
  let sessionDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    const setup = setupGitRepo();
    repoDir = setup.repoDir;
    agentnoteDirPath = setup.agentnoteDirPath;
    sessionDir = setup.sessionDir;
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("basic: records a git note for a commit with prompts and file change", async () => {
    // Create a file and commit it
    writeFileSync(join(repoDir, "hello.ts"), "export const x = 1;\n");
    execSync("git add hello.ts", { cwd: repoDir });
    execSync('git commit -m "add hello"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    // Write session data (no turn tracking — v1 compat path)
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"write a function","timestamp":"2026-04-13T10:00:00Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"hello.ts"}\n`,
    );

    const result = await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    assert.equal(result.promptCount, 1);
    assert.ok(result.aiRatio >= 0 && result.aiRatio <= 100);

    const note = await readNote(commitSha);
    assert.ok(note !== null, "git note should exist");
    assert.equal(note.v, 1);
    assert.equal(note.session_id, SESSION_ID);
    assert.ok(Array.isArray(note.interactions));
  });

  it("idempotent: calling twice returns promptCount=0 on second call", async () => {
    writeFileSync(join(repoDir, "idem.ts"), "export const y = 2;\n");
    execSync("git add idem.ts", { cwd: repoDir });
    execSync('git commit -m "add idem"', { cwd: repoDir });

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"make it idempotent","timestamp":"2026-04-13T10:00:00Z"}\n',
    );

    const first = await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });
    assert.equal(first.promptCount, 1);

    const second = await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });
    assert.equal(second.promptCount, 0);
    assert.equal(second.aiRatio, 0);
  });

  it("excludes files not in the commit from the note", async () => {
    // Commit only one file but record changes for two files
    writeFileSync(join(repoDir, "committed.ts"), "export const a = 1;\n");
    writeFileSync(join(repoDir, "not-committed.ts"), "export const b = 2;\n");
    execSync("git add committed.ts", { cwd: repoDir });
    execSync('git commit -m "partial commit"', { cwd: repoDir });

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"add files","timestamp":"2026-04-13T10:00:00Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"committed.ts"}\n` +
        `{"event":"file_change","tool":"Write","file":"not-committed.ts"}\n`,
    );

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();
    const note = await readNote(commitSha);
    assert.ok(note !== null);

    const files = note.files as Array<{ path: string; by_ai: boolean }>;
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("committed.ts"), "committed file should be in note");
    assert.ok(!paths.includes("not-committed.ts"), "uncommitted file should not be in note");
  });

  it("skips writing note when no prompts and no AI files exist", async () => {
    writeFileSync(join(repoDir, "empty.ts"), "export {};\n");
    execSync("git add empty.ts", { cwd: repoDir });
    execSync('git commit -m "no prompts"', { cwd: repoDir });

    // No prompts.jsonl or changes.jsonl written — e.g. rebased commit.
    const result = await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();
    const note = await readNote(commitSha);
    assert.equal(note, null, "should not write note when no AI data exists");
    assert.equal(result.promptCount, 0);
  });
});
