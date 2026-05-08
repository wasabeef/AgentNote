import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENTNOTE_DIR,
  CHANGES_FILE,
  EVENTS_FILE,
  HEARTBEAT_FILE,
  PROMPTS_FILE,
  SESSION_FILE,
  SESSIONS_DIR,
  TRAILER_KEY,
} from "../core/constants.js";

describe("agent-note hook", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-hook-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
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

    execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, { cwd: testDir });

    const sessionFile = join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE);
    assert.ok(existsSync(sessionFile), "session file should exist");
    assert.equal(readFileSync(sessionFile, "utf-8"), "a1b2c3d4-0001-0001-0001-000000000001");

    const eventsFile = join(
      testDir,
      ".git",
      AGENTNOTE_DIR,
      SESSIONS_DIR,
      "a1b2c3d4-0001-0001-0001-000000000001",
      EVENTS_FILE,
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

    execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, { cwd: testDir });

    const promptsFile = join(
      testDir,
      ".git",
      AGENTNOTE_DIR,
      SESSIONS_DIR,
      "a1b2c3d4-0001-0001-0001-000000000001",
      PROMPTS_FILE,
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

    execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, { cwd: testDir });

    const changesFile = join(
      testDir,
      ".git",
      AGENTNOTE_DIR,
      SESSIONS_DIR,
      "a1b2c3d4-0001-0001-0001-000000000001",
      CHANGES_FILE,
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

    execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, { cwd: testDir });

    const changesFile = join(
      testDir,
      ".git",
      AGENTNOTE_DIR,
      SESSIONS_DIR,
      "a1b2c3d4-0002-0002-0002-000000000002",
      CHANGES_FILE,
    );
    assert.ok(!existsSync(changesFile), "should not record Bash tool use");
  });

  it("does not recreate heartbeat for filtered events after a session ended", () => {
    const sessionId = "a1b2c3d4-0006-0006-0006-000000000006";
    const event = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      prompt: "<task-notification>background reminder</task-notification>",
    });

    execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, { cwd: testDir });

    const heartbeatPath = join(
      testDir,
      ".git",
      AGENTNOTE_DIR,
      SESSIONS_DIR,
      sessionId,
      HEARTBEAT_FILE,
    );
    assert.ok(!existsSync(heartbeatPath), "filtered events should not recreate heartbeat");
  });

  it("injects trailer on PreToolUse git commit", () => {
    const event = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "a1b2c3d4-0001-0001-0001-000000000001",
      tool_name: "Bash",
      tool_input: { command: "git commit -m 'test'" },
    });

    const out = execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const result = JSON.parse(out);
    assert.ok(
      result.hookSpecificOutput.updatedInput.command.includes("--trailer"),
      "should inject trailer flag",
    );
    assert.ok(
      result.hookSpecificOutput.updatedInput.command.includes(TRAILER_KEY),
      "should inject session trailer",
    );
  });

  it("refreshes heartbeat on commit hook events during long turns", () => {
    const sessionId = "a1b2c3d4-0007-0007-0007-000000000007";
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const heartbeatPath = join(sessionDir, HEARTBEAT_FILE);
    writeFileSync(heartbeatPath, "1");

    const event = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: { command: "git commit -m long-turn" },
    });

    execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, { cwd: testDir });

    const heartbeat = Number.parseInt(readFileSync(heartbeatPath, "utf-8"), 10);
    assert.ok(heartbeat > 1, "heartbeat should be refreshed before commit");
  });

  it("injects trailer on PreToolUse chained git add && git commit", () => {
    const event = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "a1b2c3d4-0001-0001-0001-000000000001",
      tool_name: "Bash",
      tool_input: { command: "git add file.ts && git commit -m 'chained'" },
    });

    const out = execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const result = JSON.parse(out);
    const updatedCmd = result.hookSpecificOutput.updatedInput.command;
    assert.ok(updatedCmd.includes("--trailer"), "should inject trailer for chained command");
    assert.ok(updatedCmd.includes("git add file.ts"), "should preserve git add prefix");
  });

  it("does not inject trailer on PreToolUse for non-commit Bash", () => {
    const event = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "a1b2c3d4-0001-0001-0001-000000000001",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });

    const out = execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.equal(out.trim(), "", "should produce no output for non-commit command");
  });

  it("does not inject trailer when git commit is only mentioned in a quoted string or comment", () => {
    for (const command of ['echo "git commit -m test"', "git status # git commit -m test"]) {
      const event = JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "a1b2c3d4-0001-0001-0001-000000000001",
        tool_name: "Bash",
        tool_input: { command },
      });

      const out = execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, {
        cwd: testDir,
        encoding: "utf-8",
      });

      assert.equal(out.trim(), "", `should produce no output for ${command}`);
    }
  });

  it("does not inject trailer on PreToolUse for git commit --amend", () => {
    const event = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "a1b2c3d4-0001-0001-0001-000000000001",
      tool_name: "Bash",
      tool_input: { command: "git commit --amend -m 'amend'" },
    });

    const out = execSync(`echo '${event}' | node ${cliPath} hook --agent claude`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.equal(out.trim(), "", "should not inject trailer for amend");
  });

  it("handles invalid JSON gracefully", () => {
    // should not throw
    execSync(`echo 'not json' | node ${cliPath} hook --agent claude`, { cwd: testDir });
  });

  it("silently ignores hook events when --agent is omitted", () => {
    const event = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "a1b2c3d4-0099-0099-0099-000000000099",
      model: "gpt-5-codex",
    });

    const result = spawnSync("sh", ["-c", `echo '${event}' | node ${cliPath} hook`], {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.equal(result.status, 0, "should exit 0 (early return) when --agent is omitted");
  });
});
