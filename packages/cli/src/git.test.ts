import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { findGitCommitCommand, git, gitSafe, injectGitCommitTrailer, repoRoot } from "./git.js";

describe("git", () => {
  let testDir: string;

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-test-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
  });

  it("executes git commands and returns stdout", async () => {
    const result = await git(["rev-parse", "--show-toplevel"], {
      cwd: testDir,
    });
    assert.ok(result.length > 0);
  });

  it("throws on invalid git command", async () => {
    await assert.rejects(() => git(["invalid-command"], { cwd: testDir }));
  });
});

describe("gitSafe", () => {
  let testDir: string;

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-test-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
  });

  it("returns exitCode 0 on success", async () => {
    const result = await gitSafe(["status"], { cwd: testDir });
    assert.equal(result.exitCode, 0);
  });

  it("returns non-zero exitCode on failure without throwing", async () => {
    const result = await gitSafe(["log"], { cwd: testDir }); // no commits
    assert.notEqual(result.exitCode, 0);
  });
});

describe("repoRoot", () => {
  it("returns the repo root path", async () => {
    const root = await repoRoot();
    assert.ok(root.length > 0);
    assert.ok(root.startsWith("/"));
  });
});

describe("findGitCommitCommand", () => {
  it("detects plain and chained git commit commands", () => {
    assert.ok(findGitCommitCommand("git commit -m 'test'"));
    assert.ok(findGitCommitCommand("git add file.ts && git commit -m 'test' && git push"));
    assert.ok(findGitCommitCommand("GIT_EDITOR=true git commit -m 'test'"));
  });

  it("ignores quoted strings and comments that only mention git commit", () => {
    assert.equal(findGitCommitCommand('echo "git commit -m test"'), null);
    assert.equal(findGitCommitCommand("printf 'git commit -m test'"), null);
    assert.equal(findGitCommitCommand("# git commit -m test"), null);
    assert.equal(findGitCommitCommand("git status # git commit -m test"), null);
  });

  it("ignores amend commits", () => {
    assert.equal(findGitCommitCommand("git commit --amend --no-edit"), null);
    assert.equal(findGitCommitCommand("git add . && git commit --amend --no-edit"), null);
  });
});

describe("injectGitCommitTrailer", () => {
  it("injects the trailer into the git commit segment only", () => {
    const updated = injectGitCommitTrailer(
      "git add file.ts && git commit -m 'test' && git push",
      "--trailer 'Agentnote-Session: sid'",
    );

    assert.equal(
      updated,
      "git add file.ts && git commit --trailer 'Agentnote-Session: sid' -m 'test' && git push",
    );
  });

  it("returns null when there is no real git commit command", () => {
    assert.equal(injectGitCommitTrailer('echo "git commit"', "--trailer test"), null);
  });
});
