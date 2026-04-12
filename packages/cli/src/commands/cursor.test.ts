import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENTNOTE_DIR,
  EVENTS_FILE,
  PROMPTS_FILE,
  SESSION_AGENT_FILE,
  SESSION_FILE,
  SESSIONS_DIR,
} from "../core/constants.js";

describe("agentnote cursor", () => {
  let testDir: string;
  let transcriptDir: string;
  let previousTranscriptDir: string | undefined;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-cursor-"));
    transcriptDir = mkdtempSync(join(tmpdir(), "agentnote-cursor-transcripts-"));
    previousTranscriptDir = process.env.AGENTNOTE_CURSOR_TRANSCRIPTS_DIR;
    process.env.AGENTNOTE_CURSOR_TRANSCRIPTS_DIR = transcriptDir;
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
  });

  after(() => {
    if (previousTranscriptDir === undefined) {
      delete process.env.AGENTNOTE_CURSOR_TRANSCRIPTS_DIR;
    } else {
      process.env.AGENTNOTE_CURSOR_TRANSCRIPTS_DIR = previousTranscriptDir;
    }
    rmSync(testDir, { recursive: true, force: true });
    rmSync(transcriptDir, { recursive: true, force: true });
  });

  it("init --agent cursor creates repo-local Cursor hook config", () => {
    execSync(`node ${cliPath} init --hooks --no-git-hooks --agent cursor`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const hooksPath = join(testDir, ".cursor", "hooks.json");
    assert.ok(existsSync(hooksPath), "hooks.json should exist");
    const hooks = readFileSync(hooksPath, "utf-8");
    assert.ok(hooks.includes("beforeSubmitPrompt"), "should include beforeSubmitPrompt");
    assert.ok(hooks.includes("afterAgentResponse"), "should include afterAgentResponse");
    assert.ok(hooks.includes("afterFileEdit"), "should include afterFileEdit");
    assert.ok(hooks.includes("afterTabFileEdit"), "should include afterTabFileEdit");
    assert.ok(hooks.includes("stop"), "should include stop");
    assert.ok(hooks.includes("agentnote hook --agent cursor"), "should call cursor mode");
  });

  it("records Cursor prompt and file edits and writes a note on commit", () => {
    const sessionId = "conv-cursor-1";
    const filePath = join(testDir, "hello.txt");
    writeFileSync(filePath, "Hello from Cursor\n");

    const promptResult = execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Create hello.txt",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );
    assert.equal(promptResult.trim(), '{"continue":true}');

    const fileEditEvent = JSON.stringify({
      hook_event_name: "afterFileEdit",
      conversation_id: sessionId,
      file_path: filePath,
    });
    execSync(`echo '${fileEditEvent}' | node ${cliPath} hook --agent cursor`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    assert.equal(
      readFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), "utf-8"),
      sessionId,
    );
    assert.equal(readFileSync(join(sessionDir, SESSION_AGENT_FILE), "utf-8").trim(), "cursor");
    assert.ok(existsSync(join(sessionDir, EVENTS_FILE)), "session events should exist");
    assert.ok(existsSync(join(sessionDir, PROMPTS_FILE)), "prompt log should exist");

    execSync("git add hello.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: cursor hello"`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.agent, "cursor");
    assert.equal(note.model, "gpt-5");
    assert.equal(note.attribution.method, "file");
    assert.equal(note.attribution.ai_ratio, 100);
    assert.equal(note.interactions[0].prompt, "Create hello.txt");
    assert.equal(note.interactions[0].response, null);
    assert.deepEqual(note.interactions[0].files_touched, ["hello.txt"]);

    const showOutput = execSync(`node ${cliPath} show`, {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(showOutput.includes("agent:   cursor"), "show should report cursor as the agent");
    assert.ok(showOutput.includes("hello.txt"), "show should include the edited file");
  });

  it("records tab-file edits through Cursor's afterTabFileEdit hook", () => {
    const sessionId = "conv-cursor-tab-1";
    const filePath = join(testDir, "tab-edit.txt");
    writeFileSync(filePath, "Tab edit\n");

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Create tab-edit.txt",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterTabFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync("git add tab-edit.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: cursor tab file edit"`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.files[0].path, "tab-edit.txt");
    assert.equal(note.files[0].by_ai, true);
    assert.deepEqual(note.interactions[0].tools, ["afterTabFileEdit"]);
  });

  it("uses a later prompt model when the first Cursor prompt has no model", () => {
    const sessionId = "conv-cursor-2";
    const filePath = join(testDir, "later-model.txt");

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Plan the change",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Create later-model.txt",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    writeFileSync(filePath, "Later model\n");
    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync("git add later-model.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: later cursor model"`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.model, "gpt-5");
    assert.equal(note.interactions[0].prompt, "Create later-model.txt");
  });

  it("restores Cursor assistant responses from local transcripts when available", () => {
    const sessionId = "conv-cursor-3";
    const filePath = join(testDir, "response.txt");
    const nestedDir = join(transcriptDir, sessionId);
    const transcriptPath = join(nestedDir, `${sessionId}.jsonl`);

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Create response.txt",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      transcriptPath,
      '{"role":"user","parts":[{"type":"text","text":"Create response.txt"}]}\n' +
        '{"role":"assistant","parts":[{"type":"text","text":"Created response.txt with the requested content."}]}\n',
    );

    writeFileSync(filePath, "Cursor response\n");
    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync("git add response.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: cursor response recovery"`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.model, "gpt-5");
    assert.equal(note.interactions[0].prompt, "Create response.txt");
    assert.equal(note.interactions[0].response, "Created response.txt with the requested content.");
  });

  it("restores Cursor assistant responses from response hooks without transcripts", () => {
    const sessionId = "conv-cursor-4";
    const filePath = join(testDir, "hook-response.txt");

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Create hook-response.txt",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterAgentResponse",
        conversation_id: sessionId,
        text: "Created hook-response.txt and explained the change.",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    writeFileSync(filePath, "Hook response\n");
    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync("git add hook-response.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: cursor response hook recovery"`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.interactions[0].prompt, "Create hook-response.txt");
    assert.equal(
      note.interactions[0].response,
      "Created hook-response.txt and explained the change.",
    );
  });

  it("prefers Cursor afterAgentResponse text over stop text for the same turn", () => {
    const sessionId = "conv-cursor-response-priority";
    const filePath = join(testDir, "response-priority.txt");

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Create response-priority.txt",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterAgentResponse",
        conversation_id: sessionId,
        text: "Created response-priority.txt with the requested content.",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "stop",
        conversation_id: sessionId,
        text: "Agent stopped after finishing the turn.",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    writeFileSync(filePath, "Preferred response\n");
    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync("git add response-priority.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: cursor response priority"`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(
      note.interactions[0].response,
      "Created response-priority.txt with the requested content.",
    );
  });

  it("records notes for plain git commit when Cursor shell hooks fire", () => {
    const sessionId = "conv-cursor-5";
    const filePath = join(testDir, "shell-commit.txt");
    const shellCommitCommand = 'git commit -m "feat: cursor shell commit"';

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Create shell-commit.txt",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterAgentResponse",
        conversation_id: sessionId,
        text: "Created shell-commit.txt and prepared the commit.",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    writeFileSync(filePath, "Shell commit\n");
    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    const beforeShellOutput = execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeShellExecution",
        conversation_id: sessionId,
        command: shellCommitCommand,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );
    assert.equal(beforeShellOutput.trim(), '{"continue":true}');

    execSync("git add shell-commit.txt", { cwd: testDir });
    execSync(shellCommitCommand, {
      cwd: testDir,
      encoding: "utf-8",
    });

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterShellExecution",
        conversation_id: sessionId,
        command: shellCommitCommand,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.session_id, sessionId);
    assert.equal(
      note.interactions[0].response,
      "Created shell-commit.txt and prepared the commit.",
    );

    const showOutput = execSync(`node ${cliPath} show`, {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(
      showOutput.includes(`session: ${sessionId}`),
      "show should fall back to note session",
    );

    const logOutput = execSync(`node ${cliPath} log 1`, {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(logOutput.includes(sessionId.slice(0, 8)), "log should fall back to note session");
  });

  it("upgrades Cursor attribution to line-level when edit counts match the commit", () => {
    const sessionId = "conv-cursor-7";
    const filePath = join(testDir, "line-level-cursor.txt");

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Create line-level-cursor.txt with two lines",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    writeFileSync(filePath, "alpha\nbeta\n");
    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
        edits: [
          {
            old_string: "",
            new_string: "alpha\\nbeta\\n",
          },
        ],
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync("git add line-level-cursor.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: cursor line attribution"`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.attribution.method, "line");
    assert.equal(note.attribution.ai_ratio, 100);
    assert.deepEqual(note.attribution.lines, {
      ai_added: 2,
      total_added: 2,
      deleted: 0,
    });
  });

  it("falls back when the committed blob no longer matches Cursor's last AI edit", () => {
    const sessionId = "conv-cursor-8";
    const filePath = join(testDir, "cursor-human-followup.txt");

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Create cursor-human-followup.txt with two lines",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    writeFileSync(filePath, "alpha\nbeta\n");
    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
        edits: [
          {
            old_string: "",
            new_string: "alpha\\nbeta\\n",
          },
        ],
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    // Simulate a human follow-up edit that preserves the line counts but changes the blob.
    writeFileSync(filePath, "gamma\ndelta\n");

    execSync("git add cursor-human-followup.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: cursor human follow-up"`, {
      cwd: testDir,
      encoding: "utf-8",
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

  it("tracks plain git commit with default git hooks after init", () => {
    const gitHookDir = join(testDir, ".git", "hooks");
    rmSync(gitHookDir, { recursive: true, force: true });

    execSync(`node ${cliPath} init --agent cursor --no-action`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const shimPath = join(testDir, ".git", AGENTNOTE_DIR, "bin", "agentnote");
    assert.ok(existsSync(shimPath), "init should create a deterministic repo-local CLI shim");
    const postCommitHook = readFileSync(join(gitHookDir, "post-commit"), "utf-8");
    assert.ok(
      postCommitHook.includes('"$GIT_DIR/agentnote/bin/agentnote"'),
      "post-commit should prefer the repo-local shim",
    );
    assert.ok(
      !postCommitHook.includes("npx --yes @wasabeef/agentnote record"),
      "post-commit should not resolve an unpinned package at commit time",
    );

    const sessionId = "conv-cursor-6";
    const filePath = join(testDir, "git-hook-commit.txt");

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Create git-hook-commit.txt",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    writeFileSync(filePath, "Git hook commit\n");
    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync("git add git-hook-commit.txt", { cwd: testDir });
    execSync(`git commit -m "feat: cursor git hook commit"`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const note = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(note.session_id, sessionId);

    const commitMessage = execSync("git log -1 --format=%B", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(commitMessage.includes(`Agentnote-Session: ${sessionId}`));
  });

  it("keeps Cursor attribution for repeated same-file edits across split commits", () => {
    const sessionId = "conv-cursor-repeat-file";
    const filePath = join(testDir, "repeat-file.txt");

    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: sessionId,
        prompt: "Update repeat-file.txt twice",
        model: "gpt-5",
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    writeFileSync(filePath, "first edit\n");
    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync("git add repeat-file.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: cursor first split edit"`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const firstNote = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(firstNote.session_id, sessionId);
    assert.equal(firstNote.files[0].by_ai, true);
    assert.equal(firstNote.interactions[0].prompt, "Update repeat-file.txt twice");

    writeFileSync(filePath, "second edit\n");
    execSync(
      `echo '${JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: sessionId,
        file_path: filePath,
      })}' | node ${cliPath} hook --agent cursor`,
      {
        cwd: testDir,
        encoding: "utf-8",
      },
    );

    execSync("git add repeat-file.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: cursor second split edit"`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const secondNote = JSON.parse(
      execSync("git notes --ref=agentnote show HEAD", {
        cwd: testDir,
        encoding: "utf-8",
      }),
    );
    assert.equal(secondNote.session_id, sessionId);
    assert.equal(secondNote.files[0].path, "repeat-file.txt");
    assert.equal(secondNote.files[0].by_ai, true);
    assert.equal(secondNote.interactions[0].prompt, "Update repeat-file.txt twice");
  });
});
