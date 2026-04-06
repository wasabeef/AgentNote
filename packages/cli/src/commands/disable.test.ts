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

describe("agentnote disable", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-stop-"));
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
    const sessionFile = join(testDir, ".git", "agentnote", "session");
    assert.ok(!existsSync(sessionFile), "session file should be removed");
  });
});

