import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { cursor } from "./cursor.js";

describe("cursor adapter", () => {
  let repoRoot: string;
  let transcriptDir: string;
  let previousTranscriptDir: string | undefined;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "agentnote-cursor-"));
    transcriptDir = mkdtempSync(join(tmpdir(), "agentnote-cursor-transcripts-"));
    previousTranscriptDir = process.env.AGENTNOTE_CURSOR_TRANSCRIPTS_DIR;
    process.env.AGENTNOTE_CURSOR_TRANSCRIPTS_DIR = transcriptDir;
  });

  afterEach(() => {
    if (previousTranscriptDir === undefined) {
      delete process.env.AGENTNOTE_CURSOR_TRANSCRIPTS_DIR;
    } else {
      process.env.AGENTNOTE_CURSOR_TRANSCRIPTS_DIR = previousTranscriptDir;
    }
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(transcriptDir, { recursive: true, force: true });
  });

  it("installs repo-local Cursor hooks", async () => {
    await cursor.installHooks(repoRoot);

    const hooksPath = join(repoRoot, ".cursor", "hooks.json");
    const content = readFileSync(hooksPath, "utf-8");
    assert.match(content, /"version": 1/);
    assert.match(content, /beforeSubmitPrompt/);
    assert.match(content, /beforeShellExecution/);
    assert.match(content, /afterAgentResponse/);
    assert.match(content, /afterFileEdit/);
    assert.match(content, /afterTabFileEdit/);
    assert.match(content, /afterShellExecution/);
    assert.match(content, /stop/);
    assert.match(content, /agent-note hook --agent cursor/);
  });

  it("replaces existing agent-note hooks without removing unrelated hooks", async () => {
    const hooksPath = join(repoRoot, ".cursor", "hooks.json");
    mkdirSync(join(repoRoot, ".cursor"), { recursive: true });
    writeFileSync(
      hooksPath,
      `${JSON.stringify(
        {
          version: 1,
          hooks: {
            beforeSubmitPrompt: [{ command: "npx --yes agent-note hook" }, { command: "echo ok" }],
            afterShellExecution: [{ command: "node packages/cli/dist/cli.js hook --agent cursor" }],
          },
        },
        null,
        2,
      )}\n`,
    );

    await cursor.installHooks(repoRoot);

    const parsed = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
      hooks: Record<string, Array<{ command: string }>>;
    };
    assert.equal(parsed.hooks.beforeSubmitPrompt.length, 2);
    assert.equal(
      parsed.hooks.beforeSubmitPrompt.filter((entry) => entry.command.includes("agent-note hook"))
        .length,
      1,
      "should keep a single Cursor hook command for beforeSubmitPrompt",
    );
    assert.ok(
      parsed.hooks.beforeSubmitPrompt.some((entry) => entry.command === "echo ok"),
      "should preserve unrelated hooks",
    );
    assert.equal(parsed.hooks.afterFileEdit.length, 1);
    assert.equal(parsed.hooks.afterTabFileEdit.length, 1);
    assert.equal(parsed.hooks.afterAgentResponse.length, 1);
    assert.equal(parsed.hooks.beforeShellExecution.length, 1);
    assert.equal(parsed.hooks.afterShellExecution.length, 1);
    assert.equal(parsed.hooks.stop.length, 1);
  });

  it("accepts repo-local dist hook commands as managed Cursor hooks", async () => {
    const hooksPath = join(repoRoot, ".cursor", "hooks.json");
    mkdirSync(join(repoRoot, ".cursor"), { recursive: true });
    writeFileSync(
      hooksPath,
      `${JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "node packages/cli/dist/cli.js hook --agent cursor" }],
        },
      })}\n`,
    );

    assert.equal(await cursor.isEnabled(repoRoot), true);
  });

  it("parses prompt and file edit events", () => {
    const promptEvent = cursor.parseEvent({
      raw: JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: "conv-123",
        prompt: "Refactor src/main.ts",
        model: "gpt-5",
      }),
      sync: true,
    });
    assert.deepEqual(promptEvent, {
      kind: "prompt",
      sessionId: "conv-123",
      timestamp: promptEvent?.timestamp,
      prompt: "Refactor src/main.ts",
      model: "gpt-5",
    });

    const fileEvent = cursor.parseEvent({
      raw: JSON.stringify({
        hook_event_name: "afterFileEdit",
        conversation_id: "conv-123",
        file_path: "/tmp/project/src/main.ts",
        edits: [
          {
            old_string: "before\n",
            new_string: "after\nnext\n",
          },
        ],
      }),
      sync: false,
    });
    assert.deepEqual(fileEvent, {
      kind: "file_change",
      sessionId: "conv-123",
      timestamp: fileEvent?.timestamp,
      file: "/tmp/project/src/main.ts",
      tool: "afterFileEdit",
      editStats: {
        added: 2,
        deleted: 1,
      },
    });

    const tabFileEvent = cursor.parseEvent({
      raw: JSON.stringify({
        hook_event_name: "afterTabFileEdit",
        conversation_id: "conv-123",
        file_path: "/tmp/project/src/tab.ts",
      }),
      sync: false,
    });
    assert.deepEqual(tabFileEvent, {
      kind: "file_change",
      sessionId: "conv-123",
      timestamp: tabFileEvent?.timestamp,
      file: "/tmp/project/src/tab.ts",
      tool: "afterTabFileEdit",
    });

    const responseEvent = cursor.parseEvent({
      raw: JSON.stringify({
        hook_event_name: "afterAgentResponse",
        conversation_id: "conv-123",
        text: "Done. I updated src/main.ts.",
      }),
      sync: false,
    });
    assert.deepEqual(responseEvent, {
      kind: "response",
      sessionId: "conv-123",
      timestamp: responseEvent?.timestamp,
      response: "Done. I updated src/main.ts.",
    });

    const stopEvent = cursor.parseEvent({
      raw: JSON.stringify({
        hook_event_name: "stop",
        conversation_id: "conv-123",
        text: "Stopped after finishing the turn.",
      }),
      sync: false,
    });
    assert.deepEqual(stopEvent, {
      kind: "stop",
      sessionId: "conv-123",
      timestamp: stopEvent?.timestamp,
      response: "Stopped after finishing the turn.",
    });

    const beforeShellEvent = cursor.parseEvent({
      raw: JSON.stringify({
        hook_event_name: "beforeShellExecution",
        conversation_id: "conv-123",
        command: "git commit -m 'test'",
      }),
      sync: true,
    });
    assert.deepEqual(beforeShellEvent, {
      kind: "pre_commit",
      sessionId: "conv-123",
      timestamp: beforeShellEvent?.timestamp,
      commitCommand: "git commit -m 'test'",
    });

    const afterShellEvent = cursor.parseEvent({
      raw: JSON.stringify({
        hook_event_name: "afterShellExecution",
        conversation_id: "conv-123",
        command: "git commit -m 'test'",
      }),
      sync: false,
    });
    assert.deepEqual(afterShellEvent, {
      kind: "post_commit",
      sessionId: "conv-123",
      timestamp: afterShellEvent?.timestamp,
    });
  });

  it("returns null when shell hooks only mention git commit in a quoted string or comment", () => {
    for (const command of ['echo "git commit -m test"', "git status # git commit -m test"]) {
      const before = cursor.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "beforeShellExecution",
          conversation_id: "conv-123",
          command,
        }),
        sync: true,
      });
      const after = cursor.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "afterShellExecution",
          conversation_id: "conv-123",
          command,
        }),
        sync: false,
      });

      assert.equal(before, null, `beforeShellExecution ${command}`);
      assert.equal(after, null, `afterShellExecution ${command}`);
    }
  });

  it("finds Cursor transcripts in nested and flat layouts", () => {
    const nestedSessionId = "cursor-nested";
    const flatSessionId = "cursor-flat";
    const nestedDir = join(transcriptDir, nestedSessionId);
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, `${nestedSessionId}.jsonl`), "");
    writeFileSync(join(transcriptDir, `${flatSessionId}.jsonl`), "");

    assert.equal(
      cursor.findTranscript(nestedSessionId),
      join(nestedDir, `${nestedSessionId}.jsonl`),
    );
    assert.equal(
      cursor.findTranscript(flatSessionId),
      join(transcriptDir, `${flatSessionId}.jsonl`),
    );
  });

  it("extracts prompt-response pairs from Cursor JSONL transcripts", async () => {
    const transcriptPath = join(transcriptDir, "cursor-response.jsonl");
    writeFileSync(
      transcriptPath,
      '{"role":"user","parts":[{"type":"text","text":"Refactor the greeting helper"}]}\n' +
        '{"role":"assistant","parts":[{"type":"text","text":"I will update the helper."}]}\n' +
        '{"payload":{"role":"user","content":[{"type":"text","text":"Add tests too"}]}}\n' +
        '{"payload":{"role":"assistant","content":[{"type":"text","text":"Adding tests now."}]}}\n',
    );

    const interactions = await cursor.extractInteractions(transcriptPath);
    assert.deepEqual(interactions, [
      { prompt: "Refactor the greeting helper", response: "I will update the helper." },
      { prompt: "Add tests too", response: "Adding tests now." },
    ]);
  });
});
