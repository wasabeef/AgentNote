import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { isSynchronousHookEvent } from "../commands/hook.js";
import { claude } from "./claude.js";

const VALID_SESSION_ID = "a0000000-0000-4000-8000-000000000001";

describe("claude adapter", () => {
  let repoRoot: string;
  let claudeHome: string;
  let previousClaudeHome: string | undefined;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "agentnote-claude-repo-"));
    claudeHome = mkdtempSync(join(tmpdir(), "agentnote-claude-home-"));
    previousClaudeHome = process.env.AGENTNOTE_CLAUDE_HOME;
    process.env.AGENTNOTE_CLAUDE_HOME = claudeHome;
  });

  afterEach(() => {
    if (previousClaudeHome === undefined) {
      delete process.env.AGENTNOTE_CLAUDE_HOME;
    } else {
      process.env.AGENTNOTE_CLAUDE_HOME = previousClaudeHome;
    }
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // parseEvent tests
  // ---------------------------------------------------------------------------

  describe("parseEvent", () => {
    it("parses SessionStart with model and transcriptPath", () => {
      const transcriptPath = join(claudeHome, "session.jsonl");
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: VALID_SESSION_ID,
          model: "claude-opus-4-5",
          transcript_path: transcriptPath,
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "session_start");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.model, "claude-opus-4-5");
      assert.equal(event.transcriptPath, transcriptPath);
    });

    it("parses Stop as stop kind", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "Stop",
          session_id: VALID_SESSION_ID,
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "stop");
      assert.equal(event.sessionId, VALID_SESSION_ID);
    });

    it("parses UserPromptSubmit with prompt", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: VALID_SESSION_ID,
          prompt: "Refactor the auth module",
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "prompt");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.prompt, "Refactor the auth module");
    });

    it("returns null for UserPromptSubmit without prompt", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: VALID_SESSION_ID,
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null for system-injected task-notification prompt", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: VALID_SESSION_ID,
          prompt: "<task-notification>\n<task-id>abc123</task-id>\n</task-notification>",
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null for system-injected system-reminder prompt", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: VALID_SESSION_ID,
          prompt: "<system-reminder>\nAuto mode active.\n</system-reminder>",
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null for system-injected teammate-message prompt", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: VALID_SESSION_ID,
          prompt: '<teammate-message teammate_id="planner">Done.</teammate-message>',
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("does NOT filter prompts that merely contain system tag names", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: VALID_SESSION_ID,
          prompt: "Please check the <task-notification> handler in hook.ts",
        }),
        sync: false,
      });
      assert.ok(event !== null, "prompt containing system tag as substring should not be filtered");
      assert.equal(event.kind, "prompt");
    });

    it("does NOT filter prompts starting with similar but non-matching tags", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: VALID_SESSION_ID,
          prompt: "<task-notifications-are-cool>test</task-notifications-are-cool>",
        }),
        sync: false,
      });
      assert.ok(event !== null, "tag with extra suffix should not be filtered");
      assert.equal(event.kind, "prompt");
    });

    it("parses PreToolUse Edit as pre_edit", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "Edit",
          tool_input: { file_path: "/project/src/main.ts" },
          tool_use_id: "tu-1",
        }),
        sync: true,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "pre_edit");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.file, "/project/src/main.ts");
      assert.equal(event.tool, "Edit");
      assert.equal(event.toolUseId, "tu-1");
    });

    it("parses PreToolUse Write as pre_edit", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "Write",
          tool_input: { file_path: "/project/src/util.ts" },
        }),
        sync: true,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "pre_edit");
      assert.equal(event.file, "/project/src/util.ts");
      assert.equal(event.tool, "Write");
    });

    it("parses PreToolUse MultiEdit as pre_edit", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "MultiEdit",
          tool_input: { file_path: "/project/src/index.ts" },
        }),
        sync: true,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "pre_edit");
      assert.equal(event.tool, "MultiEdit");
    });

    it("parses PreToolUse NotebookEdit as pre_edit", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "NotebookEdit",
          tool_input: { file_path: "/project/notebook.ipynb" },
        }),
        sync: true,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "pre_edit");
      assert.equal(event.tool, "NotebookEdit");
    });

    it("returns null for PreToolUse Edit without file_path", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "Edit",
          tool_input: {},
        }),
        sync: true,
      });
      assert.equal(event, null);
    });

    it("parses PreToolUse Bash git commit as pre_commit", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "Bash",
          tool_input: { command: "git commit -m 'fix: resolve issue'" },
        }),
        sync: true,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "pre_commit");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.commitCommand, "git commit -m 'fix: resolve issue'");
    });

    it("returns null for PreToolUse Bash git commit --amend", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "Bash",
          tool_input: { command: "git commit --amend --no-edit" },
        }),
        sync: true,
      });
      assert.equal(event, null);
    });

    it("parses PreToolUse Bash chained git commit && git push as pre_commit", () => {
      const cmd = "git commit -m 'feat: add feature' && git push";
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "Bash",
          tool_input: { command: cmd },
        }),
        sync: true,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "pre_commit");
      assert.equal(event.commitCommand, cmd);
    });

    it("returns null for PreToolUse Bash non-commit command", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "Bash",
          tool_input: { command: "ls -la" },
        }),
        sync: true,
      });
      assert.equal(event, null);
    });

    it("returns null when Bash only mentions git commit in a quoted string or comment", () => {
      for (const command of ['echo "git commit -m test"', "git status # git commit -m test"]) {
        const event = claude.parseEvent({
          raw: JSON.stringify({
            hook_event_name: "PreToolUse",
            session_id: VALID_SESSION_ID,
            tool_name: "Bash",
            tool_input: { command },
          }),
          sync: true,
        });
        assert.equal(event, null, command);
      }
    });

    it("parses PostToolUse Edit as file_change with toolUseId", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PostToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "Edit",
          tool_input: { file_path: "/project/src/main.ts" },
          tool_use_id: "tu-2",
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.kind, "file_change");
      assert.equal(event.sessionId, VALID_SESSION_ID);
      assert.equal(event.file, "/project/src/main.ts");
      assert.equal(event.tool, "Edit");
      assert.equal(event.toolUseId, "tu-2");
    });

    it("parses PostToolUse Bash git commit as post_commit with transcriptPath", () => {
      const transcriptPath = join(claudeHome, "session.jsonl");
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PostToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "Bash",
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

    it("returns null for PostToolUse Bash non-commit command", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "PostToolUse",
          session_id: VALID_SESSION_ID,
          tool_name: "Bash",
          tool_input: { command: "npm test" },
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null for invalid session_id", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: "not-a-uuid",
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null when session_id is missing", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
        }),
        sync: false,
      });
      assert.equal(event, null);
    });

    it("returns null for invalid JSON", () => {
      const event = claude.parseEvent({
        raw: "{ not valid json }",
        sync: false,
      });
      assert.equal(event, null);
    });

    it("rejects transcript_path outside claudeHome", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: VALID_SESSION_ID,
          transcript_path: "/etc/passwd",
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.transcriptPath, undefined, "path outside claudeHome must be rejected");
    });

    it("rejects transcript_path with prefix trick (e.g. claudeHome-evil/)", () => {
      const event = claude.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: VALID_SESSION_ID,
          transcript_path: `${claudeHome}-evil/session.jsonl`,
        }),
        sync: false,
      });
      assert.ok(event !== null);
      assert.equal(event.transcriptPath, undefined, "prefix-matching path must be rejected");
    });
  });

  // ---------------------------------------------------------------------------
  // installHooks / removeHooks / isEnabled tests
  // ---------------------------------------------------------------------------

  describe("installHooks", () => {
    it("installs hooks into an empty settings.json", async () => {
      await claude.installHooks(repoRoot);

      const settingsPath = join(repoRoot, ".claude", "settings.json");
      const content = readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(content) as {
        hooks: Record<string, unknown[]>;
      };

      assert.ok(settings.hooks, "hooks key should be present");
      assert.ok(
        content.includes("agent-note hook --agent claude"),
        "should include agent-note hook command",
      );
      assert.ok(settings.hooks.SessionStart, "SessionStart hooks should be present");
      assert.ok(settings.hooks.PreToolUse, "PreToolUse hooks should be present");
      assert.ok(settings.hooks.PostToolUse, "PostToolUse hooks should be present");
    });

    it("merges with existing hooks and preserves non-agent-note hooks", async () => {
      const settingsDir = join(repoRoot, ".claude");
      mkdirSync(settingsDir, { recursive: true });
      const settingsPath = join(settingsDir, "settings.json");
      writeFileSync(
        settingsPath,
        `${JSON.stringify(
          {
            theme: "dark",
            hooks: {
              PostToolUse: [
                {
                  matcher: "Bash",
                  hooks: [{ type: "command", command: "echo custom-hook" }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      await claude.installHooks(repoRoot);

      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
        theme: string;
        hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
      };
      assert.equal(settings.theme, "dark", "non-hooks settings should be preserved");
      const postToolEntries = settings.hooks.PostToolUse;
      const customEntry = postToolEntries.find((g) =>
        g.hooks.some((h) => h.command === "echo custom-hook"),
      );
      assert.ok(customEntry, "custom hook should be preserved");
    });

    it("is idempotent: running twice does not duplicate hooks", async () => {
      await claude.installHooks(repoRoot);
      await claude.installHooks(repoRoot);

      const settingsPath = join(repoRoot, ".claude", "settings.json");
      const content = readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(content) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };

      // Count agentnote entries for SessionStart — should be exactly 1
      const sessionStartGroups = settings.hooks.SessionStart ?? [];
      const agentnoteCount = sessionStartGroups
        .flatMap((g) => g.hooks)
        .filter((h) => h.command?.includes("agent-note hook --agent claude")).length;
      assert.equal(agentnoteCount, 1, "should not duplicate hooks on second install");
    });
  });

  describe("removeHooks", () => {
    it("removes agent-note hooks while preserving other hooks", async () => {
      const settingsDir = join(repoRoot, ".claude");
      mkdirSync(settingsDir, { recursive: true });
      const settingsPath = join(settingsDir, "settings.json");
      writeFileSync(
        settingsPath,
        `${JSON.stringify(
          {
            hooks: {
              PostToolUse: [
                {
                  matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash",
                  hooks: [
                    {
                      type: "command",
                      command: "npx --yes agent-note hook --agent claude",
                      async: true,
                    },
                    {
                      type: "command",
                      command: "node packages/cli/dist/cli.js hook --agent claude",
                      async: true,
                    },
                    {
                      type: "command",
                      command: "echo keep-inline",
                    },
                  ],
                },
                {
                  matcher: "Bash",
                  hooks: [{ type: "command", command: "echo custom-hook" }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      await claude.removeHooks(repoRoot);

      const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
        hooks?: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      const allCommands =
        settings.hooks?.PostToolUse?.flatMap((g) => g.hooks).map((h) => h.command) ?? [];
      assert.ok(
        !allCommands.some(
          (c) => c?.includes("agent-note hook") || c?.includes("cli.js hook --agent claude"),
        ),
        "agent-note hook should be removed",
      );
      assert.ok(allCommands.includes("echo custom-hook"), "custom hook should be preserved");
      assert.ok(allCommands.includes("echo keep-inline"), "inline custom hook should be preserved");
    });

    it("is a no-op when settings.json does not exist", async () => {
      // Should not throw
      await claude.removeHooks(repoRoot);
    });
  });

  describe("isEnabled", () => {
    it("returns true when hooks are installed", async () => {
      await claude.installHooks(repoRoot);
      const enabled = await claude.isEnabled(repoRoot);
      assert.equal(enabled, true);
    });

    it("returns true for legacy repo-local dist hooks", async () => {
      const settingsDir = join(repoRoot, ".claude");
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(
        join(settingsDir, "settings.json"),
        `${JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "node packages/cli/dist/cli.js hook --agent claude",
                    async: true,
                  },
                ],
              },
            ],
          },
        })}\n`,
      );

      const enabled = await claude.isEnabled(repoRoot);
      assert.equal(enabled, true);
    });

    it("does not infer enabled state from unrelated hook command fragments", async () => {
      const settingsDir = join(repoRoot, ".claude");
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(
        join(settingsDir, "settings.json"),
        `${JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "echo agent-note hook",
                    async: true,
                  },
                  {
                    type: "command",
                    command: "echo --agent claude",
                    async: true,
                  },
                ],
              },
            ],
          },
        })}\n`,
      );

      const enabled = await claude.isEnabled(repoRoot);
      assert.equal(enabled, false);
    });

    it("returns false when hooks are not installed", async () => {
      const enabled = await claude.isEnabled(repoRoot);
      assert.equal(enabled, false);
    });

    it("returns false after hooks are removed", async () => {
      await claude.installHooks(repoRoot);
      await claude.removeHooks(repoRoot);
      const enabled = await claude.isEnabled(repoRoot);
      assert.equal(enabled, false);
    });
  });

  // ---------------------------------------------------------------------------
  // findTranscript tests
  // ---------------------------------------------------------------------------

  describe("findTranscript", () => {
    it("finds transcript file for matching sessionId", () => {
      const sessionsDir = join(claudeHome, "projects", "my-project", "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const transcriptPath = join(sessionsDir, `${VALID_SESSION_ID}.jsonl`);
      writeFileSync(transcriptPath, JSON.stringify({ type: "user" }));

      const result = claude.findTranscript(VALID_SESSION_ID);
      assert.equal(result, transcriptPath);
    });

    it("returns null when no matching sessionId exists", () => {
      const sessionsDir = join(claudeHome, "projects", "my-project", "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const otherSessionId = "b1111111-1111-4111-9111-111111111111";
      writeFileSync(join(sessionsDir, `${otherSessionId}.jsonl`), "{}");

      const result = claude.findTranscript(VALID_SESSION_ID);
      assert.equal(result, null);
    });

    it("returns null for invalid session_id", () => {
      const result = claude.findTranscript("not-a-uuid");
      assert.equal(result, null);
    });

    it("returns null when projects directory does not exist", () => {
      // claudeHome exists but projects/ subdirectory does not
      const result = claude.findTranscript(VALID_SESSION_ID);
      assert.equal(result, null);
    });
  });

  // ---------------------------------------------------------------------------
  // extractInteractions tests
  // ---------------------------------------------------------------------------

  describe("extractInteractions", () => {
    it("extracts user/assistant prompt-response pairs from JSONL transcript", async () => {
      const transcriptPath = join(claudeHome, "session.jsonl");
      const lines = [
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "text", text: "Add auth middleware" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "I'll create the auth middleware." }] },
        }),
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "text", text: "Add tests" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Done." }] },
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await claude.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 2);
      assert.equal(interactions[0].prompt, "Add auth middleware");
      assert.equal(interactions[0].response, "I'll create the auth middleware.");
      assert.equal(interactions[1].prompt, "Add tests");
      assert.equal(interactions[1].response, "Done.");
    });

    it("handles user prompt without response", async () => {
      const transcriptPath = join(claudeHome, "session.jsonl");
      const lines = [
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "text", text: "Unanswered" }] },
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await claude.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 1);
      assert.equal(interactions[0].prompt, "Unanswered");
      assert.equal(interactions[0].response, null);
    });

    it("aggregates response text across assistant messages interleaved with tool_result user messages", async () => {
      const transcriptPath = join(claudeHome, "session.jsonl");
      const lines = [
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "text", text: "Fix the bug" }] },
        }),
        // Assistant thinks first (no text)
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "thinking", thinking: "Let me check..." }] },
        }),
        // Assistant uses a tool
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: "tu1", name: "Read", input: { file_path: "a.ts" } }],
          },
        }),
        // User message carries only tool_result (no actual prompt)
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu1", content: "file content" }],
          },
        }),
        // Assistant finally replies with text
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Found it — missing null check." }] },
        }),
        // Second text message from the same assistant turn
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Fixed in a.ts." }] },
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await claude.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 1);
      assert.equal(interactions[0].prompt, "Fix the bug");
      assert.equal(
        interactions[0].response,
        "Found it — missing null check.\nFixed in a.ts.",
        "should aggregate text across multiple assistant messages and skip tool_result-only user messages",
      );
    });

    it("joins multiple user text blocks into a single prompt", async () => {
      const transcriptPath = join(claudeHome, "session.jsonl");
      const lines = [
        JSON.stringify({
          type: "user",
          message: {
            content: [
              { type: "text", text: "Here's the code:" },
              { type: "text", text: "```ts\nconst x = 1;\n```" },
            ],
          },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Looks good." }] },
        }),
      ];
      writeFileSync(transcriptPath, lines.join("\n"));

      const interactions = await claude.extractInteractions(transcriptPath);
      assert.equal(interactions.length, 1);
      assert.equal(
        interactions[0].prompt,
        "Here's the code:\n```ts\nconst x = 1;\n```",
        "should join all user text blocks",
      );
      assert.equal(interactions[0].response, "Looks good.");
    });

    it("returns empty array for non-existent transcript path", async () => {
      const interactions = await claude.extractInteractions(join(claudeHome, "nonexistent.jsonl"));
      assert.deepEqual(interactions, []);
    });

    it("returns empty array for path outside claudeHome", async () => {
      const interactions = await claude.extractInteractions("/etc/passwd");
      assert.deepEqual(interactions, []);
    });
  });

  // ---------------------------------------------------------------------------
  // isSynchronousHookEvent regression tests
  // ---------------------------------------------------------------------------

  describe("isSynchronousHookEvent", () => {
    it("returns true for PreToolUse (Claude Code hook event)", () => {
      assert.equal(isSynchronousHookEvent({ hook_event_name: "PreToolUse" }), true);
    });

    it("returns false for PostToolUse", () => {
      assert.equal(isSynchronousHookEvent({ hook_event_name: "PostToolUse" }), false);
    });
  });
});
