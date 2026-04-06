import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("agentnote hook", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-hook-"));
    execSync("git init", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("records session on SessionStart event", () => {
    const event = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "a1b2c3d4-0001-0001-0001-000000000001",
      model: "claude-opus-4-6",
    });

    execSync(`echo '${event}' | node ${cliPath} hook`, { cwd: testDir });

    const sessionFile = join(testDir, ".git", "agentnote", "session");
    assert.ok(existsSync(sessionFile), "session file should exist");
    assert.equal(
      readFileSync(sessionFile, "utf-8"),
      "a1b2c3d4-0001-0001-0001-000000000001",
    );

    const eventsFile = join(
      testDir,
      ".git",
      "agentnote",
      "sessions",
      "a1b2c3d4-0001-0001-0001-000000000001",
      "events.jsonl",
    );
    assert.ok(existsSync(eventsFile), "events.jsonl should exist");
    const line = JSON.parse(readFileSync(eventsFile, "utf-8").trim());
    assert.equal(line.event, "session_start");
    assert.equal(line.model, "claude-opus-4-6");
  });

  it("records prompt on UserPromptSubmit event", () => {
    const event = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "a1b2c3d4-0001-0001-0001-000000000001",
      prompt: "implement auth middleware",
    });

    execSync(`echo '${event}' | node ${cliPath} hook`, { cwd: testDir });

    const promptsFile = join(
      testDir,
      ".git",
      "agentnote",
      "sessions",
      "a1b2c3d4-0001-0001-0001-000000000001",
      "prompts.jsonl",
    );
    assert.ok(existsSync(promptsFile), "prompts.jsonl should exist");
    const line = JSON.parse(readFileSync(promptsFile, "utf-8").trim());
    assert.equal(line.prompt, "implement auth middleware");
  });

  it("records file change on PostToolUse Edit event with normalized path", () => {
    // Use absolute path — hook should normalize to repo-relative.
    const absPath = join(testDir, "src", "auth.ts");
    const event = JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: "a1b2c3d4-0001-0001-0001-000000000001",
      tool_name: "Edit",
      tool_input: { file_path: absPath },
    });

    execSync(`echo '${event}' | node ${cliPath} hook`, { cwd: testDir });

    const changesFile = join(
      testDir,
      ".git",
      "agentnote",
      "sessions",
      "a1b2c3d4-0001-0001-0001-000000000001",
      "changes.jsonl",
    );
    assert.ok(existsSync(changesFile), "changes.jsonl should exist");
    const line = JSON.parse(readFileSync(changesFile, "utf-8").trim());
    assert.equal(line.tool, "Edit");
    assert.equal(line.file, "src/auth.ts", "should be repo-relative path");
  });

  it("ignores PostToolUse for non-file tools (e.g. Bash)", () => {
    const event = JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: "a1b2c3d4-0002-0002-0002-000000000002",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });

    execSync(`echo '${event}' | node ${cliPath} hook`, { cwd: testDir });

    const changesFile = join(
      testDir,
      ".git",
      "agentnote",
      "sessions",
      "a1b2c3d4-0002-0002-0002-000000000002",
      "changes.jsonl",
    );
    assert.ok(!existsSync(changesFile), "should not record Bash tool use");
  });

  it("handles invalid JSON gracefully", () => {
    // should not throw
    execSync(`echo 'not json' | node ${cliPath} hook`, { cwd: testDir });
  });
});
