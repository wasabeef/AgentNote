import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("agentnote enable", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-enable-"));
    execSync("git init", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("registers hooks in settings.json", () => {
    execSync(`node ${cliPath} enable`, { cwd: testDir });

    const settingsPath = join(testDir, ".claude", "settings.json");
    assert.ok(existsSync(settingsPath), "settings.json should exist");

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.ok(settings.hooks, "hooks key should exist");
    assert.ok(settings.hooks.SessionStart, "SessionStart hook should exist");
    assert.ok(settings.hooks.Stop, "Stop hook should exist");
    assert.ok(
      settings.hooks.UserPromptSubmit,
      "UserPromptSubmit hook should exist",
    );
    assert.ok(settings.hooks.PostToolUse, "PostToolUse hook should exist");

    const raw = JSON.stringify(settings);
    assert.ok(
      raw.includes("@wasabeef/agentnote hook"),
      "hooks should reference @wasabeef/agentnote hook",
    );
  });

  it("is idempotent (second run does not duplicate hooks)", () => {
    execSync(`node ${cliPath} enable`, { cwd: testDir });
    execSync(`node ${cliPath} enable`, { cwd: testDir });

    const settingsPath = join(testDir, ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));

    assert.equal(
      settings.hooks.SessionStart.length,
      1,
      "should not duplicate SessionStart hooks",
    );
  });

  it("creates .git/agentnote directory", () => {
    const agentnoteDir = join(testDir, ".git", "agentnote");
    assert.ok(existsSync(agentnoteDir), ".git/agentnote should exist");
  });
});

