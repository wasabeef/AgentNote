import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENTNOTE_DIR,
  CHANGES_FILE,
  HEARTBEAT_FILE,
  NOTES_REF_FULL,
  PROMPTS_FILE,
  SESSION_AGENT_FILE,
  SESSION_FILE,
  SESSIONS_DIR,
  TRAILER_KEY,
  TURN_FILE,
} from "../core/constants.js";

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function resolveGitPath(cwd: string, value: string): string {
  return isAbsolute(value) ? value : join(cwd, value);
}

function withoutCodexThreadEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CODEX_THREAD_ID;
  return env;
}

type WorktreeLayout = {
  name: string;
  bare: boolean;
  worktreePath: (dir: string) => string;
};

function writeCodexTranscript(
  codexHome: string,
  sessionId: string,
  cwd: string,
  filePath: string,
  options: {
    baseTimestampMs?: number;
    contextPrompts?: string[];
    prompt?: string;
  } = {},
): string {
  const transcriptDir = join(codexHome, "sessions", "2026", "05", "12");
  mkdirSync(transcriptDir, { recursive: true });
  const transcriptPath = join(transcriptDir, `rollout-2026-05-12T12-00-00-${sessionId}.jsonl`);
  const baseTimestampMs = options.baseTimestampMs ?? Date.now();
  const timestamp = (offsetMs: number) => new Date(baseTimestampMs + offsetMs).toISOString();
  const patch = [
    "*** Begin Patch",
    `*** Add File: ${filePath}`,
    "+export const cmuxEnvFallback = true;",
    "*** End Patch",
  ].join("\n");
  let offsetMs = 1000;
  const contextRows = (options.contextPrompts ?? []).flatMap((prompt, index) => {
    const rows = [
      JSON.stringify({
        type: "response_item",
        timestamp: timestamp(offsetMs),
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: timestamp(offsetMs + 1000),
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: `Context response ${index + 1}.` }],
        },
      }),
    ];
    offsetMs += 2000;
    return rows;
  });
  const prompt = options.prompt ?? "add cmux env fallback";
  writeFileSync(
    transcriptPath,
    `${[
      JSON.stringify({
        type: "session_meta",
        timestamp: timestamp(0),
        payload: { id: sessionId, cwd },
      }),
      ...contextRows,
      JSON.stringify({
        type: "response_item",
        timestamp: timestamp(offsetMs),
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: timestamp(offsetMs + 1000),
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I will add the cmux fallback file." }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: timestamp(offsetMs + 2000),
        payload: {
          type: "function_call",
          name: "apply_patch",
          arguments: { patch },
        },
      }),
    ].join("\n")}\n`,
  );
  return transcriptPath;
}

function writeCodexShellTranscript(
  codexHome: string,
  sessionId: string,
  cwd: string,
  prompt: string,
  command: string,
  baseTimestampMs = Date.now(),
): string {
  const transcriptDir = join(codexHome, "sessions", "2026", "05", "12");
  mkdirSync(transcriptDir, { recursive: true });
  const transcriptPath = join(transcriptDir, `rollout-2026-05-12T12-30-00-${sessionId}.jsonl`);
  const timestamp = (offsetMs: number) => new Date(baseTimestampMs + offsetMs).toISOString();
  writeFileSync(
    transcriptPath,
    `${[
      JSON.stringify({
        type: "session_meta",
        timestamp: timestamp(0),
        payload: { id: sessionId, cwd },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: timestamp(1000),
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: timestamp(2000),
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I will run the requested shell command." }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: timestamp(3000),
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: command },
        },
      }),
    ].join("\n")}\n`,
  );
  return transcriptPath;
}

describe("agentnote init", () => {
  let testDir: string;
  let originalCodexThreadId: string | undefined;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  function configureUser(cwd: string): void {
    execSync("git config user.email test@test.com", { cwd });
    execSync("git config user.name Test", { cwd });
  }

  function runClaudeHook(cwd: string, payload: Record<string, unknown>): void {
    execFileSync(process.execPath, [cliPath, "hook", "--agent", "claude"], {
      cwd,
      input: JSON.stringify(payload),
      encoding: "utf-8",
      env: withoutCodexThreadEnv(),
    });
  }

  function recordClaudeWorktreeCommit(
    cwd: string,
    options: {
      sessionId: string;
      prompt: string;
      fileName: string;
      commitMessage: string;
      content?: string;
    },
  ): Record<string, unknown> {
    const filePath = join(cwd, options.fileName);
    runClaudeHook(cwd, {
      hook_event_name: "SessionStart",
      session_id: options.sessionId,
      model: "claude-opus-4-6",
    });
    runClaudeHook(cwd, {
      hook_event_name: "UserPromptSubmit",
      session_id: options.sessionId,
      prompt: options.prompt,
    });
    runClaudeHook(cwd, {
      hook_event_name: "PreToolUse",
      session_id: options.sessionId,
      tool_name: "Write",
      tool_use_id: `tool-${options.sessionId}`,
      tool_input: { file_path: filePath },
    });
    writeFileSync(filePath, options.content ?? `${options.prompt}\n`);
    runClaudeHook(cwd, {
      hook_event_name: "PostToolUse",
      session_id: options.sessionId,
      tool_name: "Write",
      tool_use_id: `tool-${options.sessionId}`,
      tool_input: { file_path: filePath },
    });

    execFileSync("git", ["add", "--", options.fileName], { cwd });
    execFileSync("git", ["commit", "-m", options.commitMessage], {
      cwd,
      encoding: "utf-8",
      env: withoutCodexThreadEnv(),
      stdio: "pipe",
    });

    return JSON.parse(
      execFileSync("git", ["notes", "--ref=agentnote", "show", "HEAD"], {
        cwd,
        encoding: "utf-8",
        stdio: "pipe",
      }),
    );
  }

  before(() => {
    originalCodexThreadId = process.env.CODEX_THREAD_ID;
    delete process.env.CODEX_THREAD_ID;
    testDir = mkdtempSync(join(tmpdir(), "agentnote-init-"));
    execSync("git init", { cwd: testDir });
    configureUser(testDir);
    execSync("git remote add origin https://example.com/repo.git", {
      cwd: testDir,
    });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
  });

  after(() => {
    if (originalCodexThreadId === undefined) {
      delete process.env.CODEX_THREAD_ID;
    } else {
      process.env.CODEX_THREAD_ID = originalCodexThreadId;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates hooks, workflow, and configures notes fetch", () => {
    const output = execSync(`node ${cliPath} init --agent claude`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    // Hooks
    const settingsPath = join(testDir, ".claude", "settings.json");
    assert.ok(existsSync(settingsPath), "settings.json should exist");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.ok(settings.hooks?.SessionStart, "SessionStart hook should exist");

    // PreToolUse should use wildcard pattern to match compound commands
    const raw = JSON.stringify(settings);
    assert.ok(
      raw.includes("Bash(*git commit*)"),
      "PreToolUse if pattern should use wildcard to match compound commands",
    );

    // Workflow
    const workflowPath = join(testDir, ".github", "workflows", "agentnote-pr-report.yml");
    assert.ok(existsSync(workflowPath), "workflow should exist");
    const workflow = readFileSync(workflowPath, "utf-8");
    assert.ok(workflow.includes("wasabeef/AgentNote@v1"), "workflow should reference the action");

    // Notes fetch config
    const fetchConfig = execSync("git config --get-all remote.origin.fetch", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(fetchConfig.includes(NOTES_REF_FULL), "should configure notes auto-fetch");

    const prePushHook = readFileSync(join(testDir, ".git", "hooks", "pre-push"), "utf-8");
    assert.ok(
      prePushHook.includes('"$GIT_DIR/agentnote/bin/agent-note" push-notes "$1"'),
      "pre-push should delegate notes sync to the repo-local shim",
    );
    assert.ok(
      !prePushHook.includes('git push "$REMOTE" refs/notes/agentnote'),
      "pre-push should not embed a stale inline notes push implementation",
    );

    // Output messages
    assert.ok(output.includes("✓"), "should show success markers");
    assert.ok(output.includes("Next:"), "should show next steps");
  });

  it("creates a deterministic repo-local shim for git hooks", () => {
    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const shimPath = join(testDir, ".git", AGENTNOTE_DIR, "bin", "agent-note");
    assert.ok(existsSync(shimPath), "repo-local agentnote shim should exist");

    const shim = readFileSync(shimPath, "utf-8");
    assert.ok(shim.startsWith("#!/bin/sh"), "shim should be executable shell script");
    assert.ok(shim.includes(process.execPath), "shim should pin the current node binary");
    assert.ok(shim.includes("dist/cli.js"), "shim should pin the current CLI path");

    const postCommitHook = readFileSync(join(testDir, ".git", "hooks", "post-commit"), "utf-8");
    assert.ok(
      postCommitHook.includes('"$GIT_DIR/agentnote/bin/agent-note"'),
      "post-commit should prefer the repo-local shim",
    );
    assert.ok(
      postCommitHook.includes('"$COMMON_GIT_DIR/agentnote/bin/agent-note"'),
      "post-commit should fall back to the shared worktree shim",
    );
    assert.ok(
      !postCommitHook.includes("npx --yes agent-note record"),
      "post-commit should not resolve an unpinned package at commit time",
    );
    assert.ok(
      postCommitHook.includes('[ -n "$CODEX_THREAD_ID" ]'),
      "post-commit should check the real Codex session environment variable",
    );
    assert.ok(
      !postCommitHook.includes("ENV_CODEX_THREAD_ID"),
      "post-commit should not leave TypeScript constant names in shell output",
    );
  });

  it("records plain commits made from a git worktree using the common shim", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-worktree-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email test@test.com", { cwd: dir });
      execSync("git config user.name Test", { cwd: dir });
      execSync("git commit --allow-empty -m 'init'", { cwd: dir });
      execSync(`node ${cliPath} init --agent claude --no-action`, {
        cwd: dir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
      });

      const commonGitDir = resolveGitPath(
        dir,
        execSync("git rev-parse --git-common-dir", { cwd: dir, encoding: "utf-8" }).trim(),
      );
      const commonShim = join(commonGitDir, AGENTNOTE_DIR, "bin", "agent-note");
      assert.ok(existsSync(commonShim), "init should create a common shim for all worktrees");

      const worktreeDir = join(dir, ".claude", "worktrees", "agent-view");
      mkdirSync(join(dir, ".claude", "worktrees"), { recursive: true });
      execSync(`git worktree add -b agent-view-test ${shellSingleQuote(worktreeDir)}`, {
        cwd: dir,
      });

      const worktreeGitDir = resolveGitPath(
        worktreeDir,
        execSync("git rev-parse --git-dir", { cwd: worktreeDir, encoding: "utf-8" }).trim(),
      );
      assert.ok(
        !existsSync(join(worktreeGitDir, AGENTNOTE_DIR, "bin", "agent-note")),
        "the regression must exercise the common shim, not a worktree-local shim",
      );

      const sessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
      const runClaudeHook = (payload: Record<string, unknown>) => {
        execFileSync(process.execPath, [cliPath, "hook", "--agent", "claude"], {
          cwd: worktreeDir,
          input: JSON.stringify(payload),
          encoding: "utf-8",
          env: withoutCodexThreadEnv(),
        });
      };

      runClaudeHook({
        hook_event_name: "SessionStart",
        session_id: sessionId,
        model: "claude-opus-4-6",
      });
      runClaudeHook({
        hook_event_name: "UserPromptSubmit",
        session_id: sessionId,
        prompt: "Create the Agent View worktree fixture.",
      });

      const filePath = join(worktreeDir, "agent-view-worktree.txt");
      runClaudeHook({
        hook_event_name: "PreToolUse",
        session_id: sessionId,
        tool_name: "Write",
        tool_use_id: "tool-worktree-write",
        tool_input: { file_path: filePath },
      });
      writeFileSync(filePath, "Agent View worktree support\n");
      runClaudeHook({
        hook_event_name: "PostToolUse",
        session_id: sessionId,
        tool_name: "Write",
        tool_use_id: "tool-worktree-write",
        tool_input: { file_path: filePath },
      });

      execSync("git add agent-view-worktree.txt", { cwd: worktreeDir });
      execSync("git commit -m 'feat: worktree agent note'", {
        cwd: worktreeDir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
      });

      const note = JSON.parse(
        execSync("git notes --ref=agentnote show HEAD", {
          cwd: worktreeDir,
          encoding: "utf-8",
        }),
      );
      assert.equal(note.agent, "claude");
      assert.equal(note.session_id, sessionId);
      assert.equal(note.interactions[0].prompt, "Create the Agent View worktree fixture.");
      assert.deepEqual(note.interactions[0].files_touched, ["agent-view-worktree.txt"]);
      assert.equal(note.files[0].path, "agent-view-worktree.txt");
      assert.equal(note.files[0].by_ai, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs shared hooks and shims when init runs inside a git worktree", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-worktree-init-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email test@test.com", { cwd: dir });
      execSync("git config user.name Test", { cwd: dir });
      execSync("git commit --allow-empty -m 'init'", { cwd: dir });

      const worktreeDir = join(dir, ".claude", "worktrees", "init-agent");
      mkdirSync(join(dir, ".claude", "worktrees"), { recursive: true });
      execSync(`git worktree add -b init-agent-test ${shellSingleQuote(worktreeDir)}`, {
        cwd: dir,
      });

      execSync(`node ${cliPath} init --agent claude --no-action`, {
        cwd: worktreeDir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
      });

      const worktreeGitDir = resolveGitPath(
        worktreeDir,
        execSync("git rev-parse --git-dir", { cwd: worktreeDir, encoding: "utf-8" }).trim(),
      );
      const commonGitDir = resolveGitPath(
        worktreeDir,
        execSync("git rev-parse --git-common-dir", {
          cwd: worktreeDir,
          encoding: "utf-8",
        }).trim(),
      );

      assert.ok(
        existsSync(join(worktreeGitDir, AGENTNOTE_DIR, "bin", "agent-note")),
        "worktree init should create a worktree-local shim",
      );
      assert.ok(
        existsSync(join(commonGitDir, AGENTNOTE_DIR, "bin", "agent-note")),
        "worktree init should also create a common shim for sibling worktrees",
      );
      assert.ok(
        existsSync(join(commonGitDir, "hooks", "post-commit")),
        "worktree init should install hooks in the shared git hook directory",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves normal repository hook paths when init and status run from a subdirectory", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-subdir-init-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email test@test.com", { cwd: dir });
      execSync("git config user.name Test", { cwd: dir });
      execSync("git commit --allow-empty -m 'init'", { cwd: dir });

      const nestedDir = join(dir, "src", "nested");
      mkdirSync(nestedDir, { recursive: true });
      execFileSync(process.execPath, [cliPath, "init", "--agent", "claude", "--no-action"], {
        cwd: nestedDir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
        stdio: "pipe",
      });

      assert.ok(
        existsSync(join(dir, ".git", "hooks", "post-commit")),
        "subdirectory init should install hooks in the repository git dir",
      );

      const statusOutput = execFileSync(process.execPath, [cliPath, "status"], {
        cwd: nestedDir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
        stdio: "pipe",
      });
      assert.ok(
        statusOutput.includes("git:     active (prepare-commit-msg, post-commit, pre-push)"),
        "status from a repository subdirectory should read Git's effective hook directory",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves worktree common git paths when init and status run from a subdirectory", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-worktree-subdir-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email test@test.com", { cwd: dir });
      execSync("git config user.name Test", { cwd: dir });
      execSync("git commit --allow-empty -m 'init'", { cwd: dir });

      const worktreeDir = join(dir, ".claude", "worktrees", "subdir-agent");
      mkdirSync(join(dir, ".claude", "worktrees"), { recursive: true });
      execFileSync("git", ["worktree", "add", "-b", "subdir-agent-test", worktreeDir], {
        cwd: dir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
        stdio: "pipe",
      });

      const nestedDir = join(worktreeDir, "src", "nested");
      mkdirSync(nestedDir, { recursive: true });
      execFileSync(process.execPath, [cliPath, "init", "--agent", "claude", "--no-action"], {
        cwd: nestedDir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
        stdio: "pipe",
      });

      const commonGitDir = resolveGitPath(
        nestedDir,
        execFileSync("git", ["rev-parse", "--git-common-dir"], {
          cwd: nestedDir,
          encoding: "utf-8",
          env: withoutCodexThreadEnv(),
          stdio: "pipe",
        }).trim(),
      );
      assert.ok(
        existsSync(join(commonGitDir, AGENTNOTE_DIR, "bin", "agent-note")),
        "subdirectory init should create the common shim at Git's cwd-relative common dir",
      );

      const statusOutput = execFileSync(process.execPath, [cliPath, "status"], {
        cwd: nestedDir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
        stdio: "pipe",
      });
      assert.ok(
        statusOutput.includes("git:     active (prepare-commit-msg, post-commit, pre-push)"),
        "status from a worktree subdirectory should read Git's effective hook directory",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports common-shim worktree commits across bare and non-bare layouts", () => {
    const layouts: WorktreeLayout[] = [
      {
        name: "non-bare nested Agent View path",
        bare: false,
        worktreePath: (dir) => join(dir, "repo", ".claude", "worktrees", "agent-view"),
      },
      {
        name: "non-bare custom sibling path with spaces",
        bare: false,
        worktreePath: (dir) => join(dir, "custom worktrees", "feature one"),
      },
      {
        name: "bare branch directory path",
        bare: true,
        worktreePath: (dir) => join(dir, "repo.bare", "branch", "feature"),
      },
      {
        name: "bare external custom path with spaces",
        bare: true,
        worktreePath: (dir) => join(dir, "external worktrees", "feature one"),
      },
    ];

    for (const layout of layouts) {
      const dir = mkdtempSync(join(tmpdir(), "agentnote-worktree-matrix-"));
      try {
        const mainDir = layout.bare ? join(dir, "repo.bare") : join(dir, "repo");
        if (layout.bare) {
          execSync(`git init --bare ${shellSingleQuote(mainDir)}`);
          const seedDir = join(dir, "seed");
          execSync(`git clone ${shellSingleQuote(mainDir)} ${shellSingleQuote(seedDir)}`);
          execSync("git config user.email test@test.com", { cwd: seedDir });
          execSync("git config user.name Test", { cwd: seedDir });
          execSync("git commit --allow-empty -m 'init'", { cwd: seedDir });
          execSync("git push origin HEAD:main", { cwd: seedDir });
          rmSync(seedDir, { recursive: true, force: true });
        } else {
          execSync(`git init ${shellSingleQuote(mainDir)}`);
          execSync("git config user.email test@test.com", { cwd: mainDir });
          execSync("git config user.name Test", { cwd: mainDir });
          execSync("git commit --allow-empty -m 'init'", { cwd: mainDir });
        }

        const baseCwd = mainDir;
        const baseRef = layout.bare
          ? "main"
          : execSync("git branch --show-current", {
              cwd: mainDir,
              encoding: "utf-8",
            }).trim();
        const worktreeDir = layout.worktreePath(dir);
        mkdirSync(join(worktreeDir, ".."), { recursive: true });
        execSync(
          `git worktree add -b feature ${shellSingleQuote(worktreeDir)} ${shellSingleQuote(baseRef)}`,
          {
            cwd: baseCwd,
          },
        );
        execSync("git config user.email test@test.com", { cwd: worktreeDir });
        execSync("git config user.name Test", { cwd: worktreeDir });

        execSync(`node ${cliPath} init --agent claude --no-action`, {
          cwd: worktreeDir,
          encoding: "utf-8",
          env: withoutCodexThreadEnv(),
        });

        const worktreeGitDir = resolveGitPath(
          worktreeDir,
          execSync("git rev-parse --git-dir", { cwd: worktreeDir, encoding: "utf-8" }).trim(),
        );
        const commonGitDir = resolveGitPath(
          worktreeDir,
          execSync("git rev-parse --git-common-dir", {
            cwd: worktreeDir,
            encoding: "utf-8",
          }).trim(),
        );
        const hookPath = resolveGitPath(
          worktreeDir,
          execSync("git rev-parse --git-path hooks/post-commit", {
            cwd: worktreeDir,
            encoding: "utf-8",
          }).trim(),
        );

        assert.ok(
          existsSync(join(worktreeGitDir, AGENTNOTE_DIR, "bin", "agent-note")),
          `${layout.name}: worktree-local shim should exist`,
        );
        assert.ok(
          existsSync(join(commonGitDir, AGENTNOTE_DIR, "bin", "agent-note")),
          `${layout.name}: common shim should exist`,
        );
        assert.ok(existsSync(hookPath), `${layout.name}: shared post-commit hook should exist`);

        rmSync(join(worktreeGitDir, AGENTNOTE_DIR, "bin"), { recursive: true, force: true });
        assert.ok(
          !existsSync(join(worktreeGitDir, AGENTNOTE_DIR, "bin", "agent-note")),
          `${layout.name}: regression should force common-shim fallback`,
        );

        const sessionId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
        const runClaudeHook = (payload: Record<string, unknown>) => {
          execFileSync(process.execPath, [cliPath, "hook", "--agent", "claude"], {
            cwd: worktreeDir,
            input: JSON.stringify(payload),
            encoding: "utf-8",
            env: withoutCodexThreadEnv(),
          });
        };

        runClaudeHook({
          hook_event_name: "SessionStart",
          session_id: sessionId,
          model: "claude-opus-4-6",
        });
        runClaudeHook({
          hook_event_name: "UserPromptSubmit",
          session_id: sessionId,
          prompt: `${layout.name}: create worktree fixture.`,
        });

        const fileName = "worktree-matrix.txt";
        const filePath = join(worktreeDir, fileName);
        runClaudeHook({
          hook_event_name: "PreToolUse",
          session_id: sessionId,
          tool_name: "Write",
          tool_use_id: `tool-${layout.name}`,
          tool_input: { file_path: filePath },
        });
        writeFileSync(filePath, `${layout.name}\n`);
        runClaudeHook({
          hook_event_name: "PostToolUse",
          session_id: sessionId,
          tool_name: "Write",
          tool_use_id: `tool-${layout.name}`,
          tool_input: { file_path: filePath },
        });

        execSync(`git add ${shellSingleQuote(fileName)}`, { cwd: worktreeDir });
        execSync(`git commit -m ${shellSingleQuote(`feat: ${layout.name}`)}`, {
          cwd: worktreeDir,
          env: withoutCodexThreadEnv(),
        });

        const note = JSON.parse(
          execSync("git notes --ref=agentnote show HEAD", {
            cwd: worktreeDir,
            encoding: "utf-8",
          }),
        );
        assert.equal(note.session_id, sessionId, `${layout.name}: note should use hook session`);
        assert.deepEqual(
          note.interactions[0].files_touched,
          [fileName],
          `${layout.name}: prompt should keep file evidence`,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("records worktree commits across git worktree add modes and path mutations", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-worktree-modes-"));
    try {
      const repoDir = join(dir, "repo");
      execSync(`git init ${shellSingleQuote(repoDir)}`);
      configureUser(repoDir);
      execSync("git commit --allow-empty -m 'init'", { cwd: repoDir });
      execSync(`node ${cliPath} init --agent claude --no-action`, {
        cwd: repoDir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
      });

      const addWorktree = (args: string[]) => {
        execFileSync("git", ["worktree", "add", ...args], {
          cwd: repoDir,
          encoding: "utf-8",
          env: withoutCodexThreadEnv(),
          stdio: "pipe",
        });
      };
      const recordAndAssert = (worktreeDir: string, name: string, index: number) => {
        const sessionId = `cccccccc-dddd-4eee-8fff-${String(index).padStart(12, "0")}`;
        const fileName = `worktree-mode-${index}.txt`;
        const prompt = `${name}: record worktree mode.`;
        const note = recordClaudeWorktreeCommit(worktreeDir, {
          sessionId,
          prompt,
          fileName,
          commitMessage: `feat: ${name}`,
        }) as {
          session_id?: string;
          interactions?: Array<{ prompt?: string; files_touched?: string[] }>;
        };

        assert.equal(note.session_id, sessionId, `${name}: note should use the worktree session`);
        assert.equal(note.interactions?.[0]?.prompt, prompt, `${name}: prompt should be recorded`);
        assert.deepEqual(
          note.interactions?.[0]?.files_touched,
          [fileName],
          `${name}: file evidence should be preserved`,
        );
      };

      const detachedDir = join(dir, "detached worktree");
      addWorktree(["--detach", detachedDir, "HEAD"]);
      recordAndAssert(detachedDir, "detached HEAD worktree", 1);

      const lockedDir = join(dir, "locked worktree");
      addWorktree([
        "--lock",
        "--reason",
        "agentnote regression",
        "-b",
        "locked-mode",
        lockedDir,
        "HEAD",
      ]);
      recordAndAssert(lockedDir, "locked worktree", 2);
      execFileSync("git", ["worktree", "unlock", lockedDir], { cwd: repoDir });

      const relativeDir = join(dir, "relative paths", "feature");
      mkdirSync(join(relativeDir, ".."), { recursive: true });
      addWorktree(["--relative-paths", "-b", "relative-mode", relativeDir, "HEAD"]);
      recordAndAssert(relativeDir, "relative-paths worktree", 3);

      const orphanDir = join(dir, "orphan worktree");
      addWorktree(["--orphan", "-b", "orphan-mode", orphanDir]);
      recordAndAssert(orphanDir, "orphan worktree", 4);

      const firstDuplicateDir = join(dir, "duplicate-a", "feature");
      const secondDuplicateDir = join(dir, "duplicate-b", "feature");
      mkdirSync(join(firstDuplicateDir, ".."), { recursive: true });
      mkdirSync(join(secondDuplicateDir, ".."), { recursive: true });
      addWorktree(["-b", "duplicate-a-mode", firstDuplicateDir, "HEAD"]);
      addWorktree(["-b", "duplicate-b-mode", secondDuplicateDir, "HEAD"]);
      recordAndAssert(secondDuplicateDir, "duplicate basename worktree", 5);

      const moveSourceDir = join(dir, "move source");
      const moveTargetDir = join(dir, "moved worktrees", "move target");
      mkdirSync(join(moveTargetDir, ".."), { recursive: true });
      addWorktree(["-b", "moved-mode", moveSourceDir, "HEAD"]);
      execFileSync("git", ["worktree", "move", moveSourceDir, moveTargetDir], {
        cwd: repoDir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
        stdio: "pipe",
      });
      recordAndAssert(moveTargetDir, "moved worktree", 6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("respects worktree-specific hooksPath configuration", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-worktree-hooks-path-"));
    try {
      const repoDir = join(dir, "repo");
      execSync(`git init ${shellSingleQuote(repoDir)}`);
      configureUser(repoDir);
      execSync("git commit --allow-empty -m 'init'", { cwd: repoDir });

      const worktreeDir = join(dir, "configured worktree");
      execSync(`git worktree add -b configured-hooks ${shellSingleQuote(worktreeDir)} HEAD`, {
        cwd: repoDir,
      });
      execSync("git config extensions.worktreeConfig true", { cwd: repoDir });
      execSync("git config --worktree core.hooksPath .custom-hooks", { cwd: worktreeDir });

      execSync(`node ${cliPath} init --agent claude --no-action`, {
        cwd: worktreeDir,
        encoding: "utf-8",
        env: withoutCodexThreadEnv(),
      });

      const postCommitHook = join(worktreeDir, ".custom-hooks", "post-commit");
      assert.ok(
        existsSync(postCommitHook),
        "init should install hooks into the worktree-specific hooksPath",
      );

      const sessionId = "dddddddd-eeee-4fff-8aaa-000000000001";
      const prompt = "configured hooksPath: record worktree commit.";
      const note = recordClaudeWorktreeCommit(worktreeDir, {
        sessionId,
        prompt,
        fileName: "configured-hooks-path.txt",
        commitMessage: "feat: configured hooks path worktree",
      }) as {
        session_id?: string;
        interactions?: Array<{ prompt?: string }>;
      };

      assert.equal(note.session_id, sessionId);
      assert.equal(note.interactions?.[0]?.prompt, prompt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent", () => {
    execSync(`node ${cliPath} init --agent claude`, { cwd: testDir });
    const output = execSync(`node ${cliPath} init --agent claude`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.ok(output.includes("already"), "should indicate already configured");

    // No duplicates in settings
    const settingsPath = join(testDir, ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.equal(settings.hooks.SessionStart.length, 1, "should not duplicate hooks");
  });

  it("upgrades an outdated managed pre-push hook to the shim-based implementation", () => {
    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const outdatedPrePush = `#!/bin/sh
# agentnote-managed
if [ -n "$AGENTNOTE_PUSHING" ]; then exit 0; fi
REMOTE="\${1:-origin}"
AGENTNOTE_PUSHING=1 git push "$REMOTE" refs/notes/agentnote 2>/dev/null &
`;
    const hookPath = join(testDir, ".git", "hooks", "pre-push");
    writeFileSync(hookPath, outdatedPrePush, { mode: 0o755 });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const upgradedHook = readFileSync(hookPath, "utf-8");
    assert.ok(
      upgradedHook.includes('"$GIT_DIR/agentnote/bin/agent-note" push-notes "$1"'),
      "init should upgrade outdated managed pre-push hooks to the shim-based implementation",
    );
    assert.ok(
      !upgradedHook.includes('git push "$REMOTE" refs/notes/agentnote 2>/dev/null &'),
      "outdated async notes push should be removed during upgrade",
    );
  });

  it("quotes chained git hook backup paths for shell-special repository paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-hook-$`'-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    const hookPath = join(dir, ".git", "hooks", "prepare-commit-msg");
    const markerPath = join(dir, "chained-hook-ran");
    writeFileSync(hookPath, `#!/bin/sh\necho ran > ${shellSingleQuote(markerPath)}\n`, {
      mode: 0o755,
    });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const messagePath = join(dir, "message.txt");
    writeFileSync(messagePath, "subject\n");
    execFileSync(hookPath, [messagePath], { cwd: dir });

    assert.ok(existsSync(markerPath), "the chained original hook should run");

    const hook = readFileSync(hookPath, "utf-8");
    assert.ok(!hook.includes('if [ -f "'), "backup path should not use double quotes");

    rmSync(dir, { recursive: true, force: true });
  });

  it("prepare-commit-msg requires file evidence before injecting trailers", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-prepare-session-data-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const sessionId = "a1b2c3d4-2222-2222-2222-000000000222";
    const sessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));

    const hookPath = join(dir, ".git", "hooks", "prepare-commit-msg");
    const metadataOnlyMessagePath = join(dir, "metadata-only-message.txt");
    writeFileSync(metadataOnlyMessagePath, "subject\n");
    execFileSync(hookPath, [metadataOnlyMessagePath], { cwd: dir });
    assert.ok(
      !readFileSync(metadataOnlyMessagePath, "utf-8").includes(TRAILER_KEY),
      "metadata-only sessions should not receive a trailer",
    );

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"commit this change"}\n',
    );
    const promptOnlyMessagePath = join(dir, "prompt-only-message.txt");
    writeFileSync(promptOnlyMessagePath, "subject\n");
    execFileSync(hookPath, [promptOnlyMessagePath], { cwd: dir });
    assert.ok(
      !readFileSync(promptOnlyMessagePath, "utf-8").includes(TRAILER_KEY),
      "prompt-only sessions should not receive a plain git hook trailer",
    );

    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"src/app.ts","blob":"abc123","turn":1}\n',
    );
    const fileEvidenceMessagePath = join(dir, "file-evidence-message.txt");
    writeFileSync(fileEvidenceMessagePath, "subject\n");
    execFileSync(hookPath, [fileEvidenceMessagePath], { cwd: dir });
    assert.ok(
      readFileSync(fileEvidenceMessagePath, "utf-8").includes(`${TRAILER_KEY}: ${sessionId}`),
      "sessions with file evidence should receive a trailer",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit fallback records stale sessions when file evidence matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-stale-post-commit-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const sessionId = "a1b2c3d4-3333-3333-3333-000000000333";
    const sessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), "1");
    writeFileSync(join(sessionDir, TURN_FILE), "1");
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"add stale rescue","turn":1}\n',
    );
    writeFileSync(join(dir, "stale-rescue.ts"), "export const staleRescue = true;\n");
    const staleRescueBlob = execSync("git hash-object -w stale-rescue.ts", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"stale-rescue.ts","blob":"${staleRescueBlob}","turn":1}\n`,
    );

    execSync("git add stale-rescue.ts", { cwd: dir });
    execSync("git commit -m 'feat: stale rescue'", { cwd: dir });

    const message = execSync("git log -1 --format=%B", { cwd: dir, encoding: "utf-8" });
    assert.ok(!message.includes(TRAILER_KEY), "stale heartbeat should still skip trailers");

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: dir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.session_id, sessionId);
    assert.equal(entry.interactions[0].prompt, "add stale rescue");

    rmSync(dir, { recursive: true, force: true });
  });

  it("plain git commit does not attach fresh prompt-only active sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-fresh-prompt-only-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const sessionId = "a1b2c3d4-9999-9999-9999-000000000999";
    const sessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));
    writeFileSync(join(sessionDir, TURN_FILE), "1");
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"fresh prompt only","turn":1}\n',
    );

    writeFileSync(join(dir, "terminal-only.ts"), "export const terminalOnly = true;\n");
    execSync("git add terminal-only.ts", { cwd: dir });
    execSync("git commit -m 'chore: terminal only'", { cwd: dir });

    const message = execSync("git log -1 --format=%B", { cwd: dir, encoding: "utf-8" });
    assert.ok(
      !message.includes(TRAILER_KEY),
      "fresh prompt-only sessions should not hijack plain terminal commits",
    );
    assert.throws(() => {
      execFileSync("git", ["notes", "--ref=agentnote", "show", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback records fresh Codex transcript sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-codex-env-fallback-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const staleClaudeSessionId = "a1b2c3d4-7777-7777-7777-000000000777";
    const staleClaudeSessionDir = join(
      dir,
      ".git",
      AGENTNOTE_DIR,
      SESSIONS_DIR,
      staleClaudeSessionId,
    );
    mkdirSync(staleClaudeSessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), staleClaudeSessionId);
    writeFileSync(join(staleClaudeSessionDir, HEARTBEAT_FILE), String(Date.now()));
    writeFileSync(join(staleClaudeSessionDir, TURN_FILE), "1");
    writeFileSync(
      join(staleClaudeSessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"unrelated prompt","turn":1}\n',
    );

    const codexSessionId = "019da962-23cc-7aa0-bbe3-a10f60fddada";
    const codexHome = join(dir, "codex-home");
    const filePath = "src/cmux-env.ts";
    writeCodexTranscript(codexHome, codexSessionId, dir, filePath);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, filePath), "export const cmuxEnvFallback = true;\n");

    execSync(`git add ${shellSingleQuote(filePath)}`, { cwd: dir });
    execSync("git commit -m 'feat: cmux env fallback'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    const message = execSync("git log -1 --format=%B", { cwd: dir, encoding: "utf-8" });
    assert.ok(!message.includes(TRAILER_KEY), "env fallback should not inject a trailer");

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: dir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.agent, "codex");
    assert.equal(entry.session_id, codexSessionId);
    assert.equal(entry.interactions[0].prompt, "add cmux env fallback");
    assert.deepEqual(entry.interactions[0].files_touched, [filePath]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback keeps bounded decision context prompts", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-codex-env-context-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const codexSessionId = "019da962-23cc-7aa0-bbe3-a10f60fddada";
    const codexHome = join(dir, "codex-home");
    const filePath = "src/context-env.ts";
    const contextPrompts = [
      "why did the PR prompt output disappear?",
      "is this related to cmux or the Codex session environment?",
      "did the previous fallback fix miss this case?",
      "v0.2 kept more prompt context; preserve that behavior safely",
    ];
    writeCodexTranscript(codexHome, codexSessionId, dir, filePath, { contextPrompts });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, filePath), "export const cmuxEnvFallback = true;\n");

    execSync(`git add ${shellSingleQuote(filePath)}`, { cwd: dir });
    execSync("git commit -m 'fix: preserve env fallback context'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: dir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    const prompts = entry.interactions.map((interaction: { prompt: string }) => interaction.prompt);
    assert.deepEqual(prompts, [...contextPrompts, "add cmux env fallback"]);
    assert.deepEqual(entry.interactions[entry.interactions.length - 1].files_touched, [filePath]);
    assert.equal(entry.interactions[0].files_touched, undefined);
    assert.deepEqual(entry.files, [{ path: filePath, by_ai: true }]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback retries when a stale trailer writes no note", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-codex-env-stale-trailer-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const staleSessionId = "11111111-1111-4111-8111-111111111111";
    const staleSessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, staleSessionId);
    mkdirSync(staleSessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), staleSessionId);
    writeFileSync(join(staleSessionDir, SESSION_AGENT_FILE), "claude\n");
    writeFileSync(join(staleSessionDir, HEARTBEAT_FILE), String(Date.now()));
    writeFileSync(join(staleSessionDir, TURN_FILE), "1");
    writeFileSync(
      join(staleSessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-05-12T10:00:00Z","prompt":"old unrelated work","turn":1}\n',
    );
    writeFileSync(join(dir, "unrelated-claude.ts"), "export const unrelatedClaude = true;\n");
    const unrelatedBlob = execSync("git hash-object -w unrelated-claude.ts", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    writeFileSync(
      join(staleSessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"unrelated-claude.ts","blob":"${unrelatedBlob}","turn":1}\n`,
    );

    const codexSessionId = "019da962-23cc-7aa0-bbe3-a10f60fddada";
    const codexHome = join(dir, "codex-home");
    const filePath = "src/stale-trailer-env.ts";
    writeCodexTranscript(codexHome, codexSessionId, dir, filePath);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, filePath), "export const cmuxEnvFallback = true;\n");

    execSync(`git add ${shellSingleQuote(filePath)}`, { cwd: dir });
    execSync("git commit -m 'feat: stale trailer env fallback'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    const message = execSync("git log -1 --format=%B", { cwd: dir, encoding: "utf-8" });
    assert.ok(
      message.includes(`${TRAILER_KEY}: ${staleSessionId}`),
      "the stale active session should still reproduce the wrong trailer shape",
    );

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: dir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.agent, "codex");
    assert.equal(entry.session_id, codexSessionId);
    assert.equal(entry.interactions[0].prompt, "add cmux env fallback");
    assert.deepEqual(entry.interactions[0].files_touched, [filePath]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback ignores stale local prompts when the Codex transcript is fresh", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-codex-env-transcript-only-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const codexSessionId = "019da962-23cc-7aa0-bbe3-a10f60fddada";
    const codexHome = join(dir, "codex-home");
    const filePath = "src/stale-local-prompt.ts";
    const oldFilePath = "src/old-package-task.ts";
    const transcriptPath = writeCodexTranscript(codexHome, codexSessionId, dir, filePath);
    writeFileSync(
      transcriptPath,
      `${[
        JSON.stringify({
          type: "response_item",
          timestamp: "2000-01-01T00:00:00Z",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "old package task" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2000-01-01T00:00:01Z",
          payload: {
            type: "function_call",
            name: "apply_patch",
            arguments: {
              patch: [
                "*** Begin Patch",
                `*** Add File: ${oldFilePath}`,
                "+export const oldPackageTask = true;",
                "*** End Patch",
              ].join("\n"),
            },
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2999-01-01T00:00:00Z",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "future debug prompt" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2999-01-01T00:00:01Z",
          payload: {
            type: "function_call",
            name: "apply_patch",
            arguments: {
              patch: [
                "*** Begin Patch",
                `*** Update File: ${filePath}`,
                "@@",
                "-export const cmuxEnvFallback = true;",
                "+export const futureDebug = true;",
                "*** End Patch",
              ].join("\n"),
            },
          },
        }),
      ].join("\n")}\n`,
      { flag: "a" },
    );

    const codexSessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, codexSessionId);
    mkdirSync(codexSessionDir, { recursive: true });
    writeFileSync(join(codexSessionDir, "agent"), "codex\n");
    writeFileSync(join(codexSessionDir, TURN_FILE), "1196\n");
    writeFileSync(
      join(codexSessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-05-10T03:27:40Z","prompt":"old CodeRabbit task","prompt_id":"old-prompt","turn":1196}\n',
    );

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, filePath), "export const cmuxEnvFallback = true;\n");
    writeFileSync(join(dir, oldFilePath), "export const oldPackageTask = true;\n");
    execSync(`git add ${shellSingleQuote(filePath)} ${shellSingleQuote(oldFilePath)}`, {
      cwd: dir,
    });
    execSync("git commit -m 'feat: transcript-only cmux env fallback'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: dir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.agent, "codex");
    assert.equal(entry.session_id, codexSessionId);
    assert.equal(entry.attribution.method, "file");
    assert.equal(entry.interactions[0].prompt, "add cmux env fallback");
    assert.deepEqual(entry.interactions[0].files_touched, [filePath]);
    assert.equal(
      entry.interactions.some(
        (interaction: { prompt?: string }) => interaction.prompt === "old CodeRabbit task",
      ),
      false,
      "stale repo-local prompts should not be revived by env fallback",
    );
    assert.equal(
      entry.interactions.some(
        (interaction: { prompt?: string }) => interaction.prompt === "old package task",
      ),
      false,
      "transcript rows before the parent commit should not be selected",
    );
    assert.equal(
      entry.interactions.some(
        (interaction: { prompt?: string }) => interaction.prompt === "future debug prompt",
      ),
      false,
      "transcript rows written after the commit should not be selected",
    );
    assert.deepEqual(entry.files, [
      { path: oldFilePath, by_ai: false },
      { path: filePath, by_ai: true },
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback recovers work prepared before the previous commit", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-codex-env-prepared-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const codexSessionId = "019da962-23cc-7aa0-bbe3-a10f60fddada";
    const codexHome = join(dir, "codex-home");
    const filePath = "src/prepared-before-parent.ts";
    writeCodexTranscript(codexHome, codexSessionId, dir, filePath);

    writeFileSync(join(dir, "parent.txt"), "parent\n");
    execSync("git add parent.txt", { cwd: dir });
    execSync("git commit -m 'chore: unrelated parent'", {
      cwd: dir,
      env: withoutCodexThreadEnv(),
    });

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, filePath), "export const cmuxEnvFallback = true;\n");
    execSync(`git add ${shellSingleQuote(filePath)}`, { cwd: dir });
    execSync("git commit -m 'feat: prepared env fallback'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: dir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.agent, "codex");
    assert.equal(entry.session_id, codexSessionId);
    assert.equal(entry.interactions[0].prompt, "add cmux env fallback");
    assert.deepEqual(entry.interactions[0].files_touched, [filePath]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback ignores transcripts that only touch other files", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-codex-env-other-files-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const codexSessionId = "019da962-23cc-7aa0-bbe3-a10f60fddada";
    const codexHome = join(dir, "codex-home");
    const transcriptOnlyPath = "src/transcript-only.ts";
    writeCodexTranscript(codexHome, codexSessionId, dir, transcriptOnlyPath);

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "human-only.ts"), "export const humanOnly = true;\n");
    execSync("git add human-only.ts", { cwd: dir });
    execSync("git commit -m 'chore: human only'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    assert.throws(() => {
      execFileSync("git", ["notes", "--ref=agentnote", "show", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback ignores read-only shell transcripts", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-codex-env-readonly-shell-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const codexSessionId = "019da962-23cc-7aa0-bbe3-a10f60fddada";
    const codexHome = join(dir, "codex-home");
    writeCodexShellTranscript(
      codexHome,
      codexSessionId,
      dir,
      "inspect repository status",
      "git status --short",
    );

    writeFileSync(join(dir, "manual.ts"), "export const manual = true;\n");
    execSync("git add manual.ts", { cwd: dir });
    execSync("git commit -m 'chore: manual edit'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    assert.throws(() => {
      execFileSync("git", ["notes", "--ref=agentnote", "show", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback ignores old unmatched mutating shell transcripts", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-codex-env-old-shell-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const codexSessionId = "019da962-23cc-7aa0-bbe3-a10f60fddada";
    const codexHome = join(dir, "codex-home");
    writeCodexShellTranscript(
      codexHome,
      codexSessionId,
      dir,
      "old generated mutation",
      "perl -pi -e s/old/new/g generated.ts",
      Date.now() - 2 * 60 * 1000,
    );

    writeFileSync(join(dir, "parent.txt"), "parent\n");
    execSync("git add parent.txt", { cwd: dir });
    execSync("git commit -m 'chore: unrelated parent'", {
      cwd: dir,
      env: withoutCodexThreadEnv(),
    });

    writeFileSync(join(dir, "manual.ts"), "export const manual = true;\n");
    execSync("git add manual.ts", { cwd: dir });
    execSync("git commit -m 'chore: manual edit'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    assert.throws(() => {
      execFileSync("git", ["notes", "--ref=agentnote", "show", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback keeps mutating shell transcripts", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-codex-env-mutating-shell-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const codexSessionId = "019da962-23cc-7aa0-bbe3-a10f60fddada";
    const codexHome = join(dir, "codex-home");
    writeCodexShellTranscript(
      codexHome,
      codexSessionId,
      dir,
      "replace generated wording",
      "perl -pi -e s/old/new/g generated.ts",
    );

    writeFileSync(join(dir, "generated.ts"), "export const generated = 'new';\n");
    execSync("git add generated.ts", { cwd: dir });
    execSync("git commit -m 'chore: generated wording'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: dir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.session_id, codexSessionId);
    assert.equal(entry.interactions[0].prompt, "replace generated wording");
    assert.deepEqual(entry.files, [{ path: "generated.ts", by_ai: true }]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback ignores stale Codex transcript sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-stale-codex-env-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const codexSessionId = "019da962-23cc-7aa0-bbe3-a10f60fddada";
    const codexHome = join(dir, "codex-home");
    const filePath = "src/stale-cmux-env.ts";
    const transcriptPath = writeCodexTranscript(codexHome, codexSessionId, dir, filePath);
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(transcriptPath, oldDate, oldDate);

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, filePath), "export const staleCmuxEnvFallback = true;\n");
    execSync(`git add ${shellSingleQuote(filePath)}`, { cwd: dir });
    execSync("git commit -m 'chore: stale cmux env fallback'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    assert.throws(() => {
      execFileSync("git", ["notes", "--ref=agentnote", "show", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    });
    assert.equal(
      existsSync(join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, codexSessionId)),
      false,
      "stale environment candidates should not create empty session directories",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit environment fallback ignores non-UUID Codex session ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-codex-env-invalid-session-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent codex --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const codexSessionId = "codex-session-not-a-uuid";
    const codexHome = join(dir, "codex-home");
    const filePath = "src/invalid-env-session.ts";
    writeCodexTranscript(codexHome, codexSessionId, dir, filePath);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, filePath), "export const invalidEnvSession = true;\n");

    execSync(`git add ${shellSingleQuote(filePath)}`, { cwd: dir });
    execSync("git commit -m 'chore: invalid env session'", {
      cwd: dir,
      env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: codexSessionId },
    });

    assert.throws(() => {
      execFileSync("git", ["notes", "--ref=agentnote", "show", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit fallback records stale sessions for quoted raw diff paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-stale-quoted-path-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const sessionId = "a1b2c3d4-8888-8888-8888-000000000888";
    const sessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    const filePath = "src/日本語 file.ts";
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), "1");
    writeFileSync(join(sessionDir, TURN_FILE), "1");
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"add quoted path fallback","turn":1}\n',
    );
    writeFileSync(join(dir, filePath), "export const quotedPathFallback = true;\n");
    const quotedPathBlob = execSync(`git hash-object -w ${shellSingleQuote(filePath)}`, {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"${filePath}","blob":"${quotedPathBlob}","turn":1}\n`,
    );

    execSync(`git add ${shellSingleQuote(filePath)}`, { cwd: dir });
    execSync("git commit -m 'feat: quoted path fallback'", { cwd: dir });

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: dir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.session_id, sessionId);
    assert.equal(entry.interactions[0].prompt, "add quoted path fallback");

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit fallback does not record stale prompt-only sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-stale-prompt-only-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const sessionId = "a1b2c3d4-4444-4444-4444-000000000444";
    const sessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), "1");
    writeFileSync(join(sessionDir, TURN_FILE), "1");
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"just talking","turn":1}\n',
    );

    writeFileSync(join(dir, "human-only.ts"), "export const humanOnly = true;\n");
    execSync("git add human-only.ts", { cwd: dir });
    execSync("git commit -m 'chore: human only'", { cwd: dir });

    assert.throws(() => {
      execFileSync("git", ["notes", "--ref=agentnote", "show", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit fallback does not record stale same-path sessions when blobs differ", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-stale-blob-mismatch-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const sessionId = "a1b2c3d4-5555-5555-5555-000000000555";
    const sessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), "1");
    writeFileSync(join(sessionDir, TURN_FILE), "1");
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"old same path edit","turn":1}\n',
    );
    writeFileSync(join(dir, "same-path.ts"), "export const stale = true;\n");
    const staleBlob = execSync("git hash-object -w same-path.ts", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"same-path.ts","blob":"${staleBlob}","turn":1}\n`,
    );

    writeFileSync(join(dir, "same-path.ts"), "export const human = true;\n");
    execSync("git add same-path.ts", { cwd: dir });
    execSync("git commit -m 'chore: human same path'", { cwd: dir });

    assert.throws(() => {
      execFileSync("git", ["notes", "--ref=agentnote", "show", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit fallback does not record amend commits", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-stale-amend-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    writeFileSync(join(dir, "amend.ts"), "export const before = true;\n");
    execSync("git add amend.ts", { cwd: dir });
    execSync("git commit -m 'feat: initial amend target'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const sessionId = "a1b2c3d4-6666-6666-6666-000000000666";
    const sessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), "1");
    writeFileSync(join(sessionDir, TURN_FILE), "1");
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"amend should stay skipped","turn":1}\n',
    );
    writeFileSync(join(dir, "amend.ts"), "export const after = true;\n");
    const amendBlob = execSync("git hash-object -w amend.ts", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"amend.ts","blob":"${amendBlob}","turn":1}\n`,
    );

    execSync("git add amend.ts", { cwd: dir });
    execSync("git commit --amend --no-edit", { cwd: dir });

    assert.throws(() => {
      execFileSync("git", ["notes", "--ref=agentnote", "show", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("post-commit fallback records stale sessions on root commits", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-stale-root-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, {
      cwd: dir,
      encoding: "utf-8",
    });

    const sessionId = "a1b2c3d4-7777-7777-7777-000000000777";
    const sessionDir = join(dir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(dir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    writeFileSync(join(sessionDir, HEARTBEAT_FILE), "1");
    writeFileSync(join(sessionDir, TURN_FILE), "1");
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"root commit fallback","turn":1}\n',
    );
    writeFileSync(join(dir, "root.ts"), "export const rootFallback = true;\n");
    const rootBlob = execSync("git hash-object -w root.ts", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"root.ts","blob":"${rootBlob}","turn":1}\n`,
    );

    execSync("git add root.ts", { cwd: dir });
    execSync("git commit -m 'feat: root fallback'", { cwd: dir });

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: dir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.session_id, sessionId);
    assert.equal(entry.interactions[0].prompt, "root commit fallback");

    rmSync(dir, { recursive: true, force: true });
  });

  it("pushes notes synchronously alongside the main branch push", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-pre-push-sync-"));
    const remoteDir = mkdtempSync(join(tmpdir(), "agentnote-pre-push-remote-"));

    execSync("git init --bare", { cwd: remoteDir });
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync(`git remote add origin ${remoteDir}`, { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --no-action`, { cwd: dir });

    writeFileSync(join(dir, "note.txt"), "tracked by note\n");
    execSync("git add note.txt", { cwd: dir });
    execSync("git commit -m 'feat: add note target'", { cwd: dir });
    execSync("git notes --ref=agentnote add -m '{\"v\":1}' HEAD", { cwd: dir });

    execSync("git push -u origin HEAD", { cwd: dir, encoding: "utf-8" });

    const remoteNotesRef = execSync("git rev-parse --verify refs/notes/agentnote", {
      cwd: remoteDir,
      encoding: "utf-8",
    }).trim();
    assert.ok(remoteNotesRef.length > 0, "remote notes ref should exist immediately after push");

    rmSync(dir, { recursive: true, force: true });
    rmSync(remoteDir, { recursive: true, force: true });
  });

  it("--hooks creates only hooks", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-hooks-only-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --hooks`, { cwd: dir });

    assert.ok(existsSync(join(dir, ".claude", "settings.json")), "hooks should exist");
    assert.ok(
      !existsSync(join(dir, ".github", "workflows", "agentnote-pr-report.yml")),
      "workflow should NOT exist",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("--action creates only workflow", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-action-only-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --action`, { cwd: dir });

    assert.ok(!existsSync(join(dir, ".claude", "settings.json")), "hooks should NOT exist");
    assert.ok(
      existsSync(join(dir, ".github", "workflows", "agentnote-pr-report.yml")),
      "workflow should exist",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("supports multiple agents after a single --agent flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-init-multi-agent-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude cursor`, {
      cwd: dir,
      encoding: "utf-8",
    });

    assert.ok(existsSync(join(dir, ".claude", "settings.json")));
    assert.ok(existsSync(join(dir, ".cursor", "hooks.json")));

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects repeated --agent flags", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-init-repeat-agent-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    let threw = false;
    try {
      execSync(`node ${cliPath} init --agent claude --agent cursor`, {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err: unknown) {
      threw = true;
      const e = err as { stderr: string };
      assert.ok(
        e.stderr.includes("repeat --agent is not supported"),
        "should reject repeated --agent flags",
      );
    }
    assert.ok(threw, "should exit with error");

    rmSync(dir, { recursive: true, force: true });
  });

  it("--dashboard creates the additional dashboard workflow", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-init-dashboard-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    execSync("git config user.name Test", { cwd: dir });
    execSync("git remote add origin https://example.com/repo.git", { cwd: dir });
    execSync("git commit --allow-empty -m 'init'", { cwd: dir });

    execSync(`node ${cliPath} init --agent claude --dashboard`, {
      cwd: dir,
      encoding: "utf-8",
    });

    assert.ok(
      existsSync(join(dir, ".github", "workflows", "agentnote-pr-report.yml")),
      "PR report workflow should exist",
    );
    assert.ok(
      existsSync(join(dir, ".github", "workflows", "agentnote-dashboard.yml")),
      "dashboard workflow should exist",
    );

    const dashboardWorkflow = readFileSync(
      join(dir, ".github", "workflows", "agentnote-dashboard.yml"),
      "utf-8",
    );
    const prReportWorkflow = readFileSync(
      join(dir, ".github", "workflows", "agentnote-pr-report.yml"),
      "utf-8",
    );
    assert.ok(
      dashboardWorkflow.includes("name: Agent Note Dashboard"),
      "dashboard workflow should have the new name",
    );
    assert.ok(
      dashboardWorkflow.includes("uses: wasabeef/AgentNote@v1"),
      "dashboard workflow should use the public Agent Note action",
    );
    assert.ok(
      dashboardWorkflow.includes("dashboard: true"),
      "dashboard workflow should enable the Dashboard mode on the public action",
    );
    assert.ok(
      dashboardWorkflow.includes(
        ["should_deploy:", "$" + "{{ steps.dashboard.outputs.should_deploy }}"].join(" "),
      ),
      "dashboard workflow should expose the shared action deploy decision",
    );
    assert.ok(
      dashboardWorkflow.includes("uses: actions/deploy-pages@v4"),
      "dashboard workflow should keep the GitHub Pages deployment job",
    );
    assert.ok(
      !dashboardWorkflow.includes(".agentnote-dashboard-source"),
      "dashboard workflow should not expose the Dashboard source checkout path",
    );
    assert.ok(
      !dashboardWorkflow.includes("NOTES_DIR:"),
      "dashboard workflow should keep note storage paths inside the shared action",
    );
    assert.ok(
      !dashboardWorkflow.includes("PAGES_DIR:"),
      "dashboard workflow should keep Pages artifact paths inside the shared action",
    );
    assert.ok(
      !dashboardWorkflow.includes("packages/dashboard@"),
      "dashboard workflow should not expose the internal Dashboard package path",
    );
    assert.ok(
      !dashboardWorkflow.includes("branches:\n      - main"),
      "dashboard workflow should not hardcode main as the deploy branch",
    );
    assert.ok(
      prReportWorkflow.includes(`GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}`),
      "PR report workflow should pass GITHUB_TOKEN to the action",
    );

    rmSync(dir, { recursive: true, force: true });
  });
});
