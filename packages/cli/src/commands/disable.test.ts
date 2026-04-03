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

describe("lore disable", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "lore-stop-"));
    execSync("git init", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
    execSync(`node ${cliPath} enable`, { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("removes hooks from settings.json", () => {
    execSync(`node ${cliPath} disable`, { cwd: testDir });

    const settingsPath = join(testDir, ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));

    assert.ok(
      !settings.hooks || Object.keys(settings.hooks).length === 0,
      "hooks should be empty or removed",
    );
  });

  it("removes session file", () => {
    const sessionFile = join(testDir, ".git", "lore", "session");
    assert.ok(!existsSync(sessionFile), "session file should be removed");
  });
});

describe("lore disable (legacy hooks)", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "lore-stop-legacy-"));
    execSync("git init", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });

    // plant legacy hooks
    const claudeDir = join(testDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
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

  it("removes legacy lore-hook.sh entries", () => {
    execSync(`node ${cliPath} disable`, { cwd: testDir });

    const settingsPath = join(testDir, ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const raw = JSON.stringify(settings);

    assert.ok(!raw.includes("lore-hook"), "legacy hooks should be removed");
  });
});
