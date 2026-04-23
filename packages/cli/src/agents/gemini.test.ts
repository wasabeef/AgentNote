import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { isSynchronousHookEvent } from "../commands/hook.js";
import { gemini } from "./gemini.js";

const VALID_SESSION_ID = "a0000000-0000-4000-8000-000000000001";

describe("gemini adapter", () => {
  let repoRoot: string;
  let geminiHome: string;
  let previousGeminiHome: string | undefined;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "agentnote-gemini-repo-"));
    geminiHome = mkdtempSync(join(tmpdir(), "agentnote-gemini-home-"));
    previousGeminiHome = process.env.GEMINI_HOME;
    process.env.GEMINI_HOME = geminiHome;
  });

  afterEach(() => {
    if (previousGeminiHome === undefined) {
      delete process.env.GEMINI_HOME;
    } else {
      process.env.GEMINI_HOME = previousGeminiHome;
    }
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(geminiHome, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // parseEvent tests
  // ---------------------------------------------------------------------------

  describe("parseEvent", () => {
    it("parses SessionStart with model and transcriptPath", () => {
      const transcriptPath = join(geminiHome, "session.json");
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: VALID_SESSION_ID,
          model: "gemini-2.0-flash",
          transcript_path: transcriptPath,
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "session_start");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.model, "gemini-2.0-flash");
      assert.equal(event.transcriptPath, transcriptPath);
    });

    it("parses SessionEnd as stop kind", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionEnd",
          session_id: VALID_SESSION_ID,
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "stop");
      assert.equal(event.sessionId, VALID_SESSION_ID);
    });

    it("parses BeforeAgent with prompt", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "BeforeAgent",
          session_id: VALID_SESSION_ID,
          prompt: "Refactor the auth module",
          model: "gemini-2.0-flash",
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "prompt");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.prompt, "Refactor the auth module");
      assert.equal(event.model, "gemini-2.0-flash");
    });

    it("returns null for BeforeAgent without prompt", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "BeforeAgent",
          session_id: VALID_SESSION_ID,
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("parses AfterAgent with prompt_response", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "AfterAgent",
          session_id: VALID_SESSION_ID,
          prompt_response: "I have refactored the auth module.",
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "response");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.response, "I have refactored the auth module.");
    });

    it("returns null for AfterAgent without prompt_response", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "AfterAgent",
          session_id: VALID_SESSION_ID,
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("parses BeforeTool write_file as pre_edit", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "BeforeTool",
          session_id: VALID_SESSION_ID,
          tool_name: "write_file",
          tool_input: { file_path: "/project/src/main.ts", content: "new content" },
        }),
        sync: true,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "pre_edit");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.file, "/project/src/main.ts");
      assert.equal(event.tool, "write_file");
    });

    it("parses BeforeTool replace as pre_edit", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "BeforeTool",
          session_id: VALID_SESSION_ID,
          tool_name: "replace",
          tool_input: {
            file_path: "/project/src/main.ts",
            old_string: "before",
            new_string: "after",
          },
        }),
        sync: true,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "pre_edit");
      assert.equal(event.file, "/project/src/main.ts");
    });

    it("parses BeforeTool run_shell_command with git commit as pre_commit", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "BeforeTool",
          session_id: VALID_SESSION_ID,
          tool_name: "run_shell_command",
          tool_input: { command: "git commit -m 'fix: resolve issue'" },
        }),
        sync: true,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "pre_commit");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.commitCommand, "git commit -m 'fix: resolve issue'");
    });

    for (const toolName of ["shell", "bash", "run_command", "execute_command"]) {
      it(`parses BeforeTool ${toolName} with git commit as pre_commit`, () => {
        const event = gemini.parseEvent({
          raw: JSON.stringify({
            hook_event_name: "BeforeTool",
            session_id: VALID_SESSION_ID,
            tool_name: toolName,
            tool_input: { command: "git commit -m 'feat: add feature'" },
          }),
          sync: true,
        });
        assert.ok(event !== null);
        assert.equal(event.kind, "pre_commit");
      });
    }

    for (const toolName of ["shell", "bash", "run_command", "execute_command"]) {
      it(`parses AfterTool ${toolName} with git commit as post_commit`, () => {
        const event = gemini.parseEvent({
          raw: JSON.stringify({
            hook_event_name: "AfterTool",
            session_id: VALID_SESSION_ID,
            tool_name: toolName,
            tool_input: { command: "git commit -m 'feat: add feature'" },
          }),
          sync: false,
        });
        assert.ok(event !== null);
        assert.equal(event.kind, "post_commit");
      });
    }

    it("returns null for BeforeTool run_shell_command with git commit --amend", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "BeforeTool",
          session_id: VALID_SESSION_ID,
          tool_name: "run_shell_command",
          tool_input: { command: "git commit --amend --no-edit" },
        }),
        sync: true,
      });
      assert.equal(event, null);
    });

    it("returns null for BeforeTool with unknown tool", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "BeforeTool",
          session_id: VALID_SESSION_ID,
          tool_name: "list_files",
          tool_input: {},
        }),
        sync: true,
      });
      assert.equal(event, null);
    });

    it("parses AfterTool write_file as file_change", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "AfterTool",
          session_id: VALID_SESSION_ID,
          tool_name: "write_file",
          tool_input: { file_path: "/project/src/main.ts" },
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "file_change");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.file, "/project/src/main.ts");
      assert.equal(event.tool, "write_file");
    });

    it("parses AfterTool replace as file_change", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "AfterTool",
          session_id: VALID_SESSION_ID,
          tool_name: "replace",
          tool_input: { file_path: "/project/src/util.ts" },
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "file_change");
      assert.equal(event.file, "/project/src/util.ts");
    });

    it("parses AfterTool shell git commit as post_commit with transcriptPath", () => {
      const transcriptPath = join(geminiHome, "session.json");
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "AfterTool",
          session_id: VALID_SESSION_ID,
          tool_name: "shell",
          tool_input: { command: "git commit -m 'feat: new feature'" },
          transcript_path: transcriptPath,
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "post_commit");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.transcriptPath, transcriptPath);
    });

    it("returns null for AfterTool with unknown tool", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "AfterTool",
          session_id: VALID_SESSION_ID,
          tool_name: "list_files",
          tool_input: {},
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null for BeforeModel event", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "BeforeModel",
          session_id: VALID_SESSION_ID,
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null for AfterModel event", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "AfterModel",
          session_id: VALID_SESSION_ID,
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null for PreCompress event", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PreCompress",
          session_id: VALID_SESSION_ID,
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null for Notification event", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "Notification",
          session_id: VALID_SESSION_ID,
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("rejects transcript_path outside geminiHome", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: VALID_SESSION_ID,
          transcript_path: "/etc/passwd",
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.transcriptPath, undefined, "path outside geminiHome must be rejected");
    });

    it("rejects transcript_path with prefix trick (e.g. ~/.gemini-evil/)", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: VALID_SESSION_ID,
          transcript_path: `${geminiHome}-evil/session.json`,
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.transcriptPath, undefined, "prefix-matching path must be rejected");
    });

    it("returns null for BeforeTool write_file without file_path", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "BeforeTool",
          session_id: VALID_SESSION_ID,
          tool_name: "write_file",
          tool_input: { content: "hello" },
        }),
        sync: true,
      });
      assert.equal(event, null);
    });

    it("returns null for invalid session_id", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: "not-a-uuid",
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null when session_id is missing", () => {
      const event = gemini.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null for invalid JSON", () => {
      const event = gemini.parseEvent({
        raw: "{ not valid json }",
        sync: false,
      });
      assert.equal(event, null);
    });
  });

  // ---------------------------------------------------------------------------
  // installHooks / removeHooks / isEnabled tests
  // ---------------------------------------------------------------------------

  describe("installHooks", () => {
    it("installs hooks into an empty settings.json", async () => {
      await gemini.installHooks(repoRoot);

      const settingsPath = join(repoRoot, ".gemini", "settings.json");
      const content = readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(content) as {
        hooks: Record<string, unknown[]>;
      };

      assert.ok(settings.hooks, "hooks key should be present");
      assert.ok(
        content.includes("agent-note hook --agent gemini"),
        "should include agent-note hook command",
      );
      assert.ok(settings.hooks.SessionStart, "SessionStart hooks should be present");
      assert.ok(settings.hooks.BeforeTool, "BeforeTool hooks should be present");
      assert.ok(settings.hooks.AfterTool, "AfterTool hooks should be present");
    });

    it("merges with existing hooks and preserves non-agent-note hooks", async () => {
      const settingsDir = join(repoRoot, ".gemini");
      mkdirSync(settingsDir, { recursive: true });
      const settingsPath = join(settingsDir, "settings.json");
      writeFileSync(
        settingsPath,
        `${JSON.stringify(
          {
            theme: "dark",
            hooks: {
              BeforeTool: [
                {
                  matcher: "shell",
                  hooks: [{ name: "my-custom-hook", type: "command", command: "echo hello" }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      await gemini.installHooks(repoRoot);

      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
        theme: string;
        hooks: Record<string, Array<{ matcher: string; hooks: Array<{ name: string }> }>>;
      };
      assert.equal(settings.theme, "dark", "non-hooks settings should be preserved");
      const beforeToolEntries = settings.hooks.BeforeTool;
      const customEntry = beforeToolEntries.find((g) =>
        g.hooks.some((h) => h.name === "my-custom-hook"),
      );
      assert.ok(customEntry, "custom hook should be preserved");
    });

    it("is idempotent: running twice does not duplicate hooks", async () => {
      await gemini.installHooks(repoRoot);
      await gemini.installHooks(repoRoot);

      const settingsPath = join(repoRoot, ".gemini", "settings.json");
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ name: string }> }>>;
      };

      // Count agent-note hooks for SessionStart — should be exactly 1
      const sessionStartGroups = settings.hooks.SessionStart ?? [];
      const agentnoteHookCount = sessionStartGroups
        .flatMap((g) => g.hooks)
        .filter((h) => h.name === "agentnote-session-start").length;
      assert.equal(agentnoteHookCount, 1, "should not duplicate hooks on second install");
    });
  });

  describe("removeHooks", () => {
    it("removes agent-note hooks while preserving other hooks", async () => {
      const settingsDir = join(repoRoot, ".gemini");
      mkdirSync(settingsDir, { recursive: true });
      const settingsPath = join(settingsDir, "settings.json");
      writeFileSync(
        settingsPath,
        `${JSON.stringify(
          {
            hooks: {
              BeforeTool: [
                {
                  matcher: "shell",
                  hooks: [
                    {
                      name: "agentnote-before-shell",
                      type: "command",
                      command: "npx --yes agent-note hook --agent gemini",
                    },
                    { name: "my-custom-hook", type: "command", command: "echo hello" },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      await gemini.removeHooks(repoRoot);

      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
        hooks?: Record<string, Array<{ hooks: Array<{ name: string }> }>>;
      };
      const allHooks = settings.hooks?.BeforeTool?.flatMap((g) => g.hooks).map((h) => h.name) ?? [];
      assert.ok(!allHooks.includes("agentnote-before-shell"), "agent-note hook should be removed");
      assert.ok(allHooks.includes("my-custom-hook"), "custom hook should be preserved");
    });

    it("is a no-op when settings.json does not exist", async () => {
      // Should not throw
      await gemini.removeHooks(repoRoot);
    });
  });

  describe("isEnabled", () => {
    it("returns true when hooks are installed", async () => {
      await gemini.installHooks(repoRoot);
      const enabled = await gemini.isEnabled(repoRoot);
      assert.equal(enabled, true);
    });

    it("returns false when hooks are not installed", async () => {
      const enabled = await gemini.isEnabled(repoRoot);
      assert.equal(enabled, false);
    });

    it("returns false after hooks are removed", async () => {
      await gemini.installHooks(repoRoot);
      await gemini.removeHooks(repoRoot);
      const enabled = await gemini.isEnabled(repoRoot);
      assert.equal(enabled, false);
    });
  });

  // ---------------------------------------------------------------------------
  // findTranscript tests
  // ---------------------------------------------------------------------------

  describe("findTranscript", () => {
    it("finds transcript file containing matching sessionId", () => {
      const tmpDir = join(geminiHome, "tmp");
      mkdirSync(tmpDir, { recursive: true });
      const transcriptPath = join(tmpDir, "session.jsonl");
      writeFileSync(
        transcriptPath,
        JSON.stringify({ sessionId: VALID_SESSION_ID, projectHash: "abc" }),
      );

      const result = gemini.findTranscript(VALID_SESSION_ID);
      assert.equal(result, transcriptPath);
    });

    it("returns null when no matching transcript exists", () => {
      const tmpDir = join(geminiHome, "tmp");
      mkdirSync(tmpDir, { recursive: true });
      const otherSessionId = "b1111111-1111-4111-9111-111111111111";
      writeFileSync(join(tmpDir, "session.jsonl"), JSON.stringify({ sessionId: otherSessionId }));

      const result = gemini.findTranscript(VALID_SESSION_ID);
      assert.equal(result, null);
    });

    it("returns null for invalid session_id", () => {
      const result = gemini.findTranscript("not-a-uuid");
      assert.equal(result, null);
    });

    it("returns null when tmp directory does not exist", () => {
      // geminiHome exists but tmp/ subdirectory does not
      const result = gemini.findTranscript(VALID_SESSION_ID);
      assert.equal(result, null);
    });
  });

  // ---------------------------------------------------------------------------
  // extractInteractions tests
  // ---------------------------------------------------------------------------

  describe("extractInteractions", () => {
    it("extracts user/gemini prompt-response pairs from JSONL transcript", async () => {
      const transcriptPath = join(geminiHome, "session.jsonl");
      const lines = [
        JSON.stringify({
          sessionId: VALID_SESSION_ID,
          projectHash: "abc",
          startTime: "2026-01-01",
        }),
        JSON.stringify({
          type: "user",
          id: "m1",
          timestamp: "t1",
          content: [{ text: "Add auth middleware" }],
        }),
        JSON.stringify({
          type: "gemini",
          id: "m2",
          timestamp: "t2",
          content: [{ text: "I'll create the auth middleware." }],
          toolCalls: [
            {
              id: "tc1",
              name: "write_file",
              args: { file_path: "src/auth.ts", content: "export {}" },
              status: "completed",
              timestamp: "t3",
            },
          ],
        }),
        JSON.stringify({
          type: "user",
          id: "m3",
          timestamp: "t4",
          content: [{ text: "Add tests" }],
        }),
        JSON.stringify({ type: "gemini", id: "m4", timestamp: "t5", content: [{ text: "Done." }] }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await gemini.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 2);
      assert.equal(interactions[0].prompt, "Add auth middleware");
      assert.equal(interactions[0].response, "I'll create the auth middleware.");
      assert.deepEqual(interactions[0].files_touched, ["src/auth.ts"]);
      assert.equal(interactions[1].prompt, "Add tests");
      assert.equal(interactions[1].response, "Done.");
    });

    it("extracts files_touched from replace tool calls", async () => {
      const transcriptPath = join(geminiHome, "session.jsonl");
      const lines = [
        JSON.stringify({ sessionId: VALID_SESSION_ID }),
        JSON.stringify({
          type: "user",
          id: "m1",
          timestamp: "t1",
          content: [{ text: "Fix the bug" }],
        }),
        JSON.stringify({
          type: "gemini",
          id: "m2",
          timestamp: "t2",
          content: [{ text: "Fixed." }],
          toolCalls: [
            {
              id: "tc1",
              name: "replace",
              args: { file_path: "src/main.ts", old_string: "a", new_string: "b" },
              status: "completed",
              timestamp: "t3",
            },
            {
              id: "tc2",
              name: "replace",
              args: { file_path: "src/util.ts", old_string: "x", new_string: "y" },
              status: "completed",
              timestamp: "t4",
            },
          ],
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await gemini.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 1);
      assert.deepEqual(interactions[0].files_touched, ["src/main.ts", "src/util.ts"]);
    });

    it("skips metadata and non-message lines", async () => {
      const transcriptPath = join(geminiHome, "session.jsonl");
      const lines = [
        JSON.stringify({ sessionId: VALID_SESSION_ID, projectHash: "abc" }),
        JSON.stringify({ $rewindTo: "m1" }),
        JSON.stringify({ $set: { summary: "test" } }),
        JSON.stringify({
          type: "info",
          id: "i1",
          timestamp: "t1",
          content: [{ text: "info msg" }],
        }),
        JSON.stringify({ type: "user", id: "m1", timestamp: "t2", content: [{ text: "Hello" }] }),
        JSON.stringify({ type: "warning", id: "w1", timestamp: "t3", content: [{ text: "warn" }] }),
        JSON.stringify({ type: "gemini", id: "m2", timestamp: "t4", content: [{ text: "Hi!" }] }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await gemini.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 1);
      assert.equal(interactions[0].prompt, "Hello");
      assert.equal(interactions[0].response, "Hi!");
    });

    it("handles user prompt without response", async () => {
      const transcriptPath = join(geminiHome, "session.jsonl");
      const lines = [
        JSON.stringify({ sessionId: VALID_SESSION_ID }),
        JSON.stringify({
          type: "user",
          id: "m1",
          timestamp: "t1",
          content: [{ text: "Unanswered" }],
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await gemini.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 1);
      assert.equal(interactions[0].prompt, "Unanswered");
      assert.equal(interactions[0].response, null);
    });

    it("returns empty array for non-existent transcript path", async () => {
      const interactions = await gemini.extractInteractions(join(geminiHome, "nonexistent.json"));
      assert.deepEqual(interactions, []);
    });

    it("returns empty array for path outside geminiHome", async () => {
      const interactions = await gemini.extractInteractions("/etc/passwd");
      assert.deepEqual(interactions, []);
    });

    it("joins multiple content parts with newline", async () => {
      const transcriptPath = join(geminiHome, "session.jsonl");
      const lines = [
        JSON.stringify({ sessionId: VALID_SESSION_ID }),
        JSON.stringify({
          type: "user",
          id: "m1",
          timestamp: "t1",
          content: [{ text: "part1" }, { text: "part2" }],
        }),
        JSON.stringify({
          type: "gemini",
          id: "m2",
          timestamp: "t2",
          content: [{ text: "resp1" }, { text: "resp2" }],
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await gemini.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 1);
      assert.equal(interactions[0].prompt, "part1\npart2");
      assert.equal(interactions[0].response, "resp1\nresp2");
    });

    it("includes files from failed toolCalls (status is not checked)", async () => {
      // extractInteractions is status-agnostic by design: it records all
      // write_file/replace calls regardless of their status field.
      const transcriptPath = join(geminiHome, "session.jsonl");
      const lines = [
        JSON.stringify({ sessionId: VALID_SESSION_ID }),
        JSON.stringify({
          type: "user",
          id: "m1",
          timestamp: "t1",
          content: [{ text: "Edit the file" }],
        }),
        JSON.stringify({
          type: "gemini",
          id: "m2",
          timestamp: "t2",
          content: [{ text: "Attempted." }],
          toolCalls: [
            {
              id: "tc1",
              name: "write_file",
              args: { file_path: "src/broken.ts", content: "bad" },
              status: "failed",
              timestamp: "t3",
            },
          ],
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await gemini.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 1);
      assert.deepEqual(interactions[0].files_touched, ["src/broken.ts"]);
    });

    it("skips user message with empty content array", async () => {
      const transcriptPath = join(geminiHome, "session.jsonl");
      const lines = [
        JSON.stringify({ sessionId: VALID_SESSION_ID }),
        JSON.stringify({
          type: "user",
          id: "m1",
          timestamp: "t1",
          content: [],
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await gemini.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 0);
    });

    it("does not add non-edit tool calls to files_touched", async () => {
      const transcriptPath = join(geminiHome, "session.jsonl");
      const lines = [
        JSON.stringify({ sessionId: VALID_SESSION_ID }),
        JSON.stringify({
          type: "user",
          id: "m1",
          timestamp: "t1",
          content: [{ text: "Search for usages" }],
        }),
        JSON.stringify({
          type: "gemini",
          id: "m2",
          timestamp: "t2",
          content: [{ text: "Found results." }],
          toolCalls: [
            {
              id: "tc1",
              name: "grep_search",
              args: { pattern: "foo" },
              status: "completed",
              timestamp: "t3",
            },
            {
              id: "tc2",
              name: "read_file",
              args: { file_path: "src/main.ts" },
              status: "completed",
              timestamp: "t4",
            },
          ],
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await gemini.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 1);
      assert.equal(interactions[0].files_touched, undefined);
    });

    it("records files_touched when gemini message has toolCalls but no text content", async () => {
      const transcriptPath = join(geminiHome, "session.jsonl");
      const lines = [
        JSON.stringify({ sessionId: VALID_SESSION_ID }),
        JSON.stringify({
          type: "user",
          id: "m1",
          timestamp: "t1",
          content: [{ text: "Create the file silently" }],
        }),
        JSON.stringify({
          type: "gemini",
          id: "m2",
          timestamp: "t2",
          content: [],
          toolCalls: [
            {
              id: "tc1",
              name: "write_file",
              args: { file_path: "src/silent.ts", content: "export {}" },
              status: "completed",
              timestamp: "t3",
            },
          ],
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await gemini.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 1);
      assert.equal(interactions[0].response, null);
      assert.deepEqual(interactions[0].files_touched, ["src/silent.ts"]);
    });

    it("processes messages after $rewindTo as a normal interaction", async () => {
      const transcriptPath = join(geminiHome, "session.jsonl");
      const lines = [
        JSON.stringify({ sessionId: VALID_SESSION_ID }),
        JSON.stringify({ type: "user", id: "m1", timestamp: "t1", content: [{ text: "First" }] }),
        JSON.stringify({
          type: "gemini",
          id: "m2",
          timestamp: "t2",
          content: [{ text: "First response" }],
        }),
        // Rewind discards the previous pair in Gemini's own UI, but our extractor
        // has no context for rewinding — the $rewindTo record has no "type" field
        // and is skipped. The subsequent user/gemini pair is processed normally.
        JSON.stringify({ $rewindTo: "m1" }),
        JSON.stringify({ type: "user", id: "m1", timestamp: "t3", content: [{ text: "Retry" }] }),
        JSON.stringify({
          type: "gemini",
          id: "m3",
          timestamp: "t4",
          content: [{ text: "Retried response" }],
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await gemini.extractInteractions(transcriptPath);
      // The last pair after $rewindTo is correctly captured.
      const last = interactions[interactions.length - 1];
      assert.equal(last.prompt, "Retry");
      assert.equal(last.response, "Retried response");
    });
  });

  // ---------------------------------------------------------------------------
  // isSynchronousHookEvent regression tests
  // ---------------------------------------------------------------------------

  describe("isSynchronousHookEvent", () => {
    it("returns true for BeforeTool (Gemini hook event)", () => {
      assert.equal(isSynchronousHookEvent({ hook_event_name: "BeforeTool" }), true);
    });

    it("returns false for AfterTool", () => {
      assert.equal(isSynchronousHookEvent({ hook_event_name: "AfterTool" }), false);
    });

    it("returns true for PreToolUse (Claude Code hook event)", () => {
      assert.equal(isSynchronousHookEvent({ hook_event_name: "PreToolUse" }), true);
    });

    it("returns true for beforeSubmitPrompt (Cursor hook event)", () => {
      assert.equal(isSynchronousHookEvent({ hook_event_name: "beforeSubmitPrompt" }), true);
    });

    it("returns true for beforeShellExecution (Cursor hook event)", () => {
      assert.equal(isSynchronousHookEvent({ hook_event_name: "beforeShellExecution" }), true);
    });

    it("returns false for AfterAgent", () => {
      assert.equal(isSynchronousHookEvent({ hook_event_name: "AfterAgent" }), false);
    });

    it("returns false for non-object input", () => {
      assert.equal(isSynchronousHookEvent("BeforeTool"), false);
      assert.equal(isSynchronousHookEvent(null), false);
      assert.equal(isSynchronousHookEvent(undefined), false);
    });

    it("returns false when hook_event_name is missing", () => {
      assert.equal(isSynchronousHookEvent({}), false);
    });
  });
});
