import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AGENTNOTE_DIR, EVENTS_FILE, PROMPTS_FILE, SESSION_AGENT_FILE, SESSION_FILE, SESSIONS_DIR } from "../core/constants.js";

describe("agentnote codex", () => {
  let testDir: string;
  let testHome: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-codex-"));
    testHome = join(testDir, ".home");
    mkdirSync(testHome, { recursive: true });
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("init --agent codex creates repo-local Codex config and hooks", () => {
    execSync(`node ${cliPath} init --hooks --no-git-hooks --agent codex`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
    });

    const configPath = join(testDir, ".codex", "config.toml");
    const hooksPath = join(testDir, ".codex", "hooks.json");
    assert.ok(existsSync(configPath), "config.toml should exist");
    assert.ok(existsSync(hooksPath), "hooks.json should exist");

    const config = readFileSync(configPath, "utf-8");
    const hooks = readFileSync(hooksPath, "utf-8");
    assert.ok(config.includes("codex_hooks = true"), "codex hooks feature should be enabled");
    assert.ok(hooks.includes("UserPromptSubmit"), "hooks.json should include UserPromptSubmit");
    assert.ok(hooks.includes("agentnote hook --agent codex"), "hooks should call codex mode");
  });

  it("records Codex session metadata and builds notes from transcript-driven file attribution", () => {
    const sessionId = "codex-session-1";
    const transcriptDir = join(testHome, ".codex", "sessions");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, "rollout.jsonl");
    writeFileSync(
      transcriptPath,
      '{"timestamp":"2026-04-10T00:00:00Z","type":"session_meta","payload":{"id":"codex-session-1","timestamp":"2026-04-10T00:00:00Z"}}\n' +
        '{"timestamp":"2026-04-10T00:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Create hello.txt"}]}}\n' +
        '{"timestamp":"2026-04-10T00:00:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Creating the file."}]}}\n' +
        '{"timestamp":"2026-04-10T00:00:03Z","type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch\\n*** Add File: hello.txt\\n+Hello\\n*** End Patch\\n"}}\n',
    );

    const sessionStart = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: sessionId,
      transcript_path: transcriptPath,
      model: "gpt-5-codex",
    });
    execSync(`echo '${sessionStart}' | node ${cliPath} hook --agent codex`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
    });

    const promptEvent = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      transcript_path: transcriptPath,
      prompt: "Create hello.txt",
      model: "gpt-5-codex",
    });
    execSync(`echo '${promptEvent}' | node ${cliPath} hook --agent codex`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
    });

    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    assert.equal(readFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), "utf-8"), sessionId);
    assert.equal(readFileSync(join(sessionDir, SESSION_AGENT_FILE), "utf-8").trim(), "codex");
    assert.ok(existsSync(join(sessionDir, EVENTS_FILE)), "session events should exist");
    assert.ok(existsSync(join(sessionDir, PROMPTS_FILE)), "prompt log should exist");

    writeFileSync(join(testDir, "hello.txt"), "Hello\n");
    execSync("git add hello.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: codex hello"`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.agent, "codex");
    assert.equal(note.model, "gpt-5-codex");
    assert.equal(note.attribution.method, "file");
    assert.equal(note.attribution.ai_ratio, 100);
    assert.equal(note.interactions[0].prompt, "Create hello.txt");
    assert.equal(note.interactions[0].response, "Creating the file.");
    assert.deepEqual(note.interactions[0].files_touched, ["hello.txt"]);

    const showOutput = execSync(`node ${cliPath} show`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
      encoding: "utf-8",
    });
    assert.ok(showOutput.includes("agent:   codex"), "show should report codex as the agent");
    assert.ok(showOutput.includes("hello.txt"), "show should report transcript-derived file touch");
  });
});
