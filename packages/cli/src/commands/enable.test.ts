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

describe("lore enable", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "lore-enable-"));
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
      raw.includes("@wasabeef/lore hook"),
      "hooks should reference @wasabeef/lore hook",
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

  it("creates .git/lore directory", () => {
    const loreDir = join(testDir, ".git", "lore");
    assert.ok(existsSync(loreDir), ".git/lore should exist");
  });
});

describe("lore enable (legacy migration)", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "lore-migrate-"));
    execSync("git init", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });

    // plant legacy hooks in settings.json
    const claudeDir = join(testDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "bash .claude/hooks/lore-hook.sh",
                  async: true,
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: "bash .claude/hooks/lore-hook.sh",
                  async: true,
                },
              ],
            },
          ],
        },
      }),
    );
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("replaces legacy hooks with current format", () => {
    execSync(`node ${cliPath} enable`, { cwd: testDir });

    const settingsPath = join(testDir, ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const raw = JSON.stringify(settings);

    assert.ok(!raw.includes("lore-hook.sh"), "legacy hooks should be removed");
    assert.ok(
      raw.includes("@wasabeef/lore hook"),
      "current hooks should be added",
    );
    assert.equal(
      settings.hooks.SessionStart.length,
      1,
      "should not have duplicate SessionStart",
    );
  });
});
