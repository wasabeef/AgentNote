import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AGENTNOTE_DIR, HEARTBEAT_FILE, SESSION_FILE } from "../core/constants.js";

describe("agentnote status", () => {
  let testDir: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");
  const runCli = (args: string[], cwd = testDir): string =>
    execFileSync("node", [cliPath, ...args], { cwd, encoding: "utf-8" });

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-status-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("shows 'not configured' before start", () => {
    const output = runCli(["status"]);

    assert.ok(output.includes("not configured"), "should show not configured");
    assert.ok(output.includes("commit:  not configured"), "should show commit not configured");
    assert.ok(output.includes("session: none"), "should show no session");
  });

  it("shows 'active' after start", () => {
    runCli(["init", "--agent", "cursor", "--hooks", "--no-git-hooks"]);

    const output = runCli(["status"]);

    assert.ok(output.includes("agent:   active"), "should show agent hooks active");
    assert.ok(
      output.includes("cursor(prompt, response, edits, shell)"),
      "should show cursor capture capabilities",
    );
    assert.ok(output.includes("git:     not configured"), "should show git hooks missing");
    assert.ok(output.includes("commit:  fallback mode"), "should show fallback mode");
  });

  it("shows Codex transcript-driven capture details", () => {
    runCli(["init", "--agent", "codex", "--hooks", "--no-git-hooks"]);

    const output = runCli(["status"]);

    assert.ok(output.includes("agent:   active"), "should show agent hooks active");
    assert.ok(
      output.includes("capture: codex(prompt, response, transcript)"),
      "should show codex capture capabilities",
    );
    assert.ok(output.includes("git:     not configured"), "should show git hooks missing");
    assert.ok(output.includes("commit:  fallback mode"), "should show fallback mode");
  });

  it("shows capture details for repo-local legacy hook commands", () => {
    const repo = mkdtempSync(join(tmpdir(), "agentnote-status-local-hooks-"));
    try {
      execSync("git init", { cwd: repo });
      execSync("git config user.email test@test.com", { cwd: repo });
      execSync("git config user.name Test", { cwd: repo });
      execSync("git commit --allow-empty -m 'init'", { cwd: repo });

      mkdirSync(join(repo, ".codex"), { recursive: true });
      writeFileSync(join(repo, ".codex", "config.toml"), "[features]\ncodex_hooks = true\n");
      writeFileSync(
        join(repo, ".codex", "hooks.json"),
        `${JSON.stringify({
          hooks: {
            UserPromptSubmit: [
              { hooks: [{ command: "node packages/cli/dist/cli.js hook --agent codex" }] },
            ],
            Stop: [{ hooks: [{ command: "node packages/cli/dist/cli.js hook --agent codex" }] }],
            SessionStart: [
              { hooks: [{ command: "node packages/cli/dist/cli.js hook --agent codex" }] },
            ],
          },
        })}\n`,
      );

      mkdirSync(join(repo, ".cursor"), { recursive: true });
      writeFileSync(
        join(repo, ".cursor", "hooks.json"),
        `${JSON.stringify({
          version: 1,
          hooks: {
            beforeSubmitPrompt: [{ command: "node packages/cli/dist/cli.js hook --agent cursor" }],
            afterAgentResponse: [{ command: "node packages/cli/dist/cli.js hook --agent cursor" }],
            afterFileEdit: [{ command: "node packages/cli/dist/cli.js hook --agent cursor" }],
            beforeShellExecution: [
              { command: "node packages/cli/dist/cli.js hook --agent cursor" },
            ],
          },
        })}\n`,
      );

      mkdirSync(join(repo, ".gemini"), { recursive: true });
      writeFileSync(
        join(repo, ".gemini", "settings.json"),
        `${JSON.stringify({
          hooks: {
            BeforeAgent: [
              { hooks: [{ command: "node packages/cli/dist/cli.js hook --agent gemini" }] },
            ],
            AfterAgent: [
              { hooks: [{ command: "node packages/cli/dist/cli.js hook --agent gemini" }] },
            ],
            BeforeTool: [
              { hooks: [{ command: "node packages/cli/dist/cli.js hook --agent gemini" }] },
            ],
          },
        })}\n`,
      );

      const output = runCli(["status"], repo);

      assert.ok(
        output.includes("codex(prompt, response, transcript)"),
        "should show Codex repo-local capture capabilities",
      );
      assert.ok(
        output.includes("cursor(prompt, response, edits, shell)"),
        "should show Cursor repo-local capture capabilities",
      );
      assert.ok(
        output.includes("gemini(prompt, response, edits, shell)"),
        "should show Gemini repo-local capture capabilities",
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("shows git hooks as the primary commit path when fully configured", () => {
    runCli(["init", "--agent", "cursor", "--no-action"]);

    const output = runCli(["status"]);

    assert.ok(output.includes("agent:   active"), "should show agent hooks active");
    assert.ok(
      output.includes("cursor(prompt, response, edits, shell)"),
      "should show cursor capture capabilities",
    );
    assert.ok(
      output.includes("git:     active (prepare-commit-msg, post-commit, pre-push)"),
      "should show managed git hooks",
    );
    assert.ok(output.includes("commit:  tracked via git hooks"), "should show primary path");
  });

  it("shows session ID when session is active", () => {
    const sid = "a1b2c3d4-3333-3333-3333-333333333333";
    const agentnotePath = join(testDir, ".git", AGENTNOTE_DIR);
    writeFileSync(join(agentnotePath, SESSION_FILE), sid);
    // Write a fresh heartbeat so status treats the session as active.
    const sessionDir = join(agentnotePath, "sessions", sid);
    execSync(`mkdir -p "${sessionDir}"`);
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));

    const output = runCli(["status"]);

    assert.ok(output.includes("a1b2c3d4…"), "should show truncated session ID");
  });

  it("shows linked commit count", () => {
    const output = runCli(["status"]);

    assert.ok(output.includes("linked:"), "should show linked count");
  });
});
