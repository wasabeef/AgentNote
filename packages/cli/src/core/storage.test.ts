import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readNote, writeNote } from "./storage.js";

describe("storage: writeNote / readNote", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    repoDir = mkdtempSync(join(tmpdir(), "agentnote-storage-"));
    execSync("git init", { cwd: repoDir });
    execSync("git config user.email test@test.com", { cwd: repoDir });
    execSync("git config user.name Test", { cwd: repoDir });
    execSync("git commit --allow-empty -m initial", { cwd: repoDir });
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("writes and reads a note round-trip", async () => {
    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    const data = { v: 1, session_id: "abc", ai_ratio: 80 };
    await writeNote(commitSha, data);

    const result = await readNote(commitSha);
    assert.deepEqual(result, data);
  });

  it("returns null when no note exists", async () => {
    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();
    const result = await readNote(commitSha);
    assert.equal(result, null);
  });

  it("overwrites existing note with -f flag", async () => {
    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    const first = { v: 1, message: "first" };
    const second = { v: 1, message: "second" };

    await writeNote(commitSha, first);
    await writeNote(commitSha, second);

    const result = await readNote(commitSha);
    assert.deepEqual(result, second);
  });

  it("handles complex data structures", async () => {
    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    const data = {
      v: 1,
      agent: "claude",
      session_id: "a0000000-0000-4000-8000-000000000001",
      interactions: [{ prompt: "hello", response: "world", tools: ["Edit"] }],
      files: [{ path: "src/foo.ts", by_ai: true }],
      attribution: { ai_ratio: 100, method: "line" },
    };

    await writeNote(commitSha, data);
    const result = await readNote(commitSha);
    assert.deepEqual(result, data);
  });
});
