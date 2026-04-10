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

  it("records Codex session metadata and upgrades to line attribution when patch counts match the commit", () => {
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
    assert.equal(note.attribution.method, "line");
    assert.equal(note.attribution.ai_ratio, 100);
    assert.equal(note.attribution.lines.ai_added, 1);
    assert.equal(note.attribution.lines.total_added, 1);
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
    assert.ok(showOutput.includes("(1/1 lines)"), "show should include line-level attribution details");
  });

  it("falls back to file attribution when transcript patch counts do not match the commit", () => {
    const sessionId = "codex-session-2";
    const transcriptDir = join(testHome, ".codex", "sessions");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, "rollout-mismatch.jsonl");
    writeFileSync(
      transcriptPath,
      '{"timestamp":"2026-04-10T01:00:00Z","type":"session_meta","payload":{"id":"codex-session-2","timestamp":"2026-04-10T01:00:00Z"}}\n' +
        '{"timestamp":"2026-04-10T01:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Update hello.txt"}]}}\n' +
        '{"timestamp":"2026-04-10T01:00:02Z","type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch\\n*** Update File: hello-again.txt\\n@@\\n-Hello\\n+Hello from Codex\\n*** End Patch\\n"}}\n',
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
      prompt: "Update hello.txt",
      model: "gpt-5-codex",
    });
    execSync(`echo '${promptEvent}' | node ${cliPath} hook --agent codex`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
    });

    writeFileSync(join(testDir, "hello-again.txt"), "Hello from Codex\nAnd human line\n");
    execSync("git add hello-again.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: codex mismatch"`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.attribution.method, "file");
    assert.equal(note.attribution.ai_ratio, 100);
  });

  it("records Codex transcripts that use function_call apply_patch payloads and non-session filenames", () => {
    const sessionId = "codex-session-3";
    const transcriptDir = join(testHome, ".codex", "sessions", "2026", "04", "10");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, "rollout.jsonl");
    writeFileSync(
      transcriptPath,
      '{"timestamp":"2026-04-10T02:00:00Z","type":"session_meta","payload":{"id":"codex-session-3","timestamp":"2026-04-10T02:00:00Z"}}\n' +
        '{"timestamp":"2026-04-10T02:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":{"value":"Create multi.txt"}},{"type":"input_text","text":"and note.txt"}]}}\n' +
        '{"timestamp":"2026-04-10T02:00:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":{"value":"Creating both files."}}]}}\n' +
        '{"timestamp":"2026-04-10T02:00:03Z","type":"response_item","payload":{"type":"function_call","call_name":"apply_patch","arguments":"{\\"patch\\":\\"*** Begin Patch\\\\n*** Add File: multi.txt\\\\n+Hello\\\\n*** Add File: note.txt\\\\n+Details\\\\n*** End Patch\\\\n\\"}"}}\n',
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
      prompt: "Create multi.txt\nand note.txt",
      model: "gpt-5-codex",
    });
    execSync(`echo '${promptEvent}' | node ${cliPath} hook --agent codex`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
    });

    writeFileSync(join(testDir, "multi.txt"), "Hello\n");
    writeFileSync(join(testDir, "note.txt"), "Details\n");
    execSync("git add multi.txt note.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: codex function call"`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.attribution.method, "line");
    assert.deepEqual(
      note.files.filter((file: { by_ai: boolean }) => file.by_ai).map((file: { path: string }) => file.path).sort(),
      ["multi.txt", "note.txt"],
    );
    assert.equal(note.interactions[0].prompt, "Create multi.txt\nand note.txt");
    assert.equal(note.interactions[0].response, "Creating both files.");
    assert.deepEqual(note.interactions[0].files_touched?.sort(), ["multi.txt", "note.txt"]);

    const showOutput = execSync(`node ${cliPath} show`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
      encoding: "utf-8",
    });
    assert.ok(showOutput.includes("transcript:"), "show should still resolve transcript paths");
    assert.ok(showOutput.includes("note.txt"), "show should include files extracted from function_call apply_patch");
  });
});
