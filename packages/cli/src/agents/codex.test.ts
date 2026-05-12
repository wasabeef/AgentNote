import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { codex } from "./codex.js";

const VALID_SESSION_ID = "a0000000-0000-4000-8000-000000000001";

function buildRealSessionPatchTranscript(opts: {
  sessionId: string;
  workdir: string;
  prompt: string;
  response: string;
  patchPath: string;
}): string {
  return (
    `{"timestamp":"2026-04-15T09:31:23.296Z","type":"session_meta","payload":{"id":"${opts.sessionId}","timestamp":"2026-04-15T09:31:16.968Z","cwd":"${opts.workdir}","originator":"codex-tui","cli_version":"0.120.0","source":"cli","model_provider":"openai"}}\n` +
    `{"timestamp":"2026-04-15T09:31:23.296Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"${opts.prompt}"}]}}\n` +
    `{"timestamp":"2026-04-15T09:31:35.585Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"${opts.response}"}],"phase":"commentary"}}\n` +
    `{"timestamp":"2026-04-15T09:31:35.587Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"git status --short\\",\\"workdir\\":\\"${opts.workdir}\\",\\"yield_time_ms\\":1000,\\"max_output_tokens\\":3000}","call_id":"call_exec_command"}}\n` +
    `{"timestamp":"2026-04-15T09:46:45.780Z","type":"response_item","payload":{"type":"custom_tool_call","status":"completed","call_id":"call_apply_patch","name":"apply_patch","input":"*** Begin Patch\\n*** Add File: ${opts.patchPath}\\n+new status\\n*** End Patch\\n"}}\n`
  );
}

function buildShellCommandTranscript(command: string): string {
  return (
    '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Run the shell command"}]}}\n' +
    '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Running it now."}]}}\n' +
    `${JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: { cmd: command },
      },
    })}\n`
  );
}

describe("codex adapter", () => {
  let codexHome: string;
  let previousCodexHome: string | undefined;

  beforeEach(() => {
    previousCodexHome = process.env.CODEX_HOME;
    codexHome = mkdtempSync(join(tmpdir(), "agentnote-codex-home-"));
    process.env.CODEX_HOME = codexHome;
  });

  afterEach(() => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    rmSync(codexHome, { recursive: true, force: true });
  });

  describe("parseEvent", () => {
    it("accepts transcript_path under codexHome", () => {
      const transcriptPath = join(codexHome, "sessions", "session.jsonl");
      const event = codex.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: VALID_SESSION_ID,
          transcript_path: transcriptPath,
        }),
        sync: false,
      });

      assert.ok(event !== null);
      assert.equal(event.kind, "session_start");
      assert.equal(event.transcriptPath, transcriptPath);
    });

    it("rejects transcript_path outside codexHome", () => {
      const event = codex.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: VALID_SESSION_ID,
          transcript_path: "/etc/passwd",
        }),
        sync: false,
      });

      assert.ok(event !== null);
      assert.equal(event.transcriptPath, undefined, "path outside codexHome must be rejected");
    });

    it("rejects transcript_path with prefix trick (e.g. codexHome-evil/)", () => {
      const event = codex.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: VALID_SESSION_ID,
          transcript_path: `${codexHome}-evil/session.jsonl`,
        }),
        sync: false,
      });

      assert.ok(event !== null);
      assert.equal(event.transcriptPath, undefined, "prefix-matching path must be rejected");
    });

    it("rejects transcript_path that escapes codexHome with .. segments", () => {
      const event = codex.parseEvent({
        raw: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: VALID_SESSION_ID,
          transcript_path: join(codexHome, "..", "outside", "session.jsonl"),
        }),
        sync: false,
      });

      assert.ok(event !== null);
      assert.equal(event.transcriptPath, undefined, "escaped path must be rejected");
    });
  });

  it("extracts interactions from nested message content and function_call apply_patch payloads", async () => {
    const transcriptDir = join(codexHome, "sessions", "nested");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, "rollout.jsonl");

    writeFileSync(
      transcriptPath,
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":{"value":"Refactor greeting"}},{"type":"input_text","text":"Add details"}]}}\n' +
        '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":{"value":"I will refactor it."}},{"type":"output_text","text":"Adding details now."}]}}\n' +
        '{"type":"response_item","payload":{"type":"function_call","call_name":"apply_patch","arguments":"{\\"patch\\":\\"*** Begin Patch\\\\n*** Update File: src/greet.ts\\\\n@@\\\\n-Hello\\\\n+Hello from Codex\\\\n*** End Patch\\\\n\\"}"}}\n',
    );

    const interactions = await codex.extractInteractions(transcriptPath);
    assert.equal(interactions.length, 1);
    assert.equal(interactions[0].prompt, "Refactor greeting\nAdd details");
    assert.equal(interactions[0].response, "I will refactor it.\nAdding details now.");
    assert.deepEqual(interactions[0].files_touched, ["src/greet.ts"]);
    assert.deepEqual(interactions[0].line_stats, { "src/greet.ts": { added: 1, deleted: 1 } });
  });

  it("extracts tools and patch metadata from a real-session-derived fixture", async () => {
    const transcriptDir = join(codexHome, "sessions", "fixture");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, "real-session.jsonl");

    writeFileSync(
      transcriptPath,
      buildRealSessionPatchTranscript({
        sessionId: VALID_SESSION_ID,
        workdir: "/repo",
        patchPath: "src/status.ts",
        prompt: "Review the status output.",
        response: "I will inspect the current state and update the status output.",
      }),
    );

    const interactions = await codex.extractInteractions(transcriptPath);
    assert.equal(interactions.length, 1);
    assert.equal(interactions[0].prompt, "Review the status output.");
    assert.equal(
      interactions[0].response,
      "I will inspect the current state and update the status output.",
    );
    assert.deepEqual(interactions[0].tools, ["exec_command", "apply_patch"]);
    assert.deepEqual(interactions[0].mutation_tools, ["apply_patch"]);
    assert.deepEqual(interactions[0].files_touched, ["src/status.ts"]);
    assert.deepEqual(interactions[0].line_stats, {
      "src/status.ts": { added: 1, deleted: 0 },
    });
  });

  it("marks mutating shell commands as mutation tools", async () => {
    const transcriptDir = join(codexHome, "sessions", "shell-mutation");
    mkdirSync(transcriptDir, { recursive: true });
    const commands = [
      "apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: src/app.ts\n+ok\n*** End Patch\nPATCH",
      "cat > src/app.ts",
      "cp src/a.ts src/b.ts",
      "mkdir -p src/generated",
      "mv src/a.ts src/b.ts",
      "npm install",
      "npm audit fix",
      "perl -pi -e 's/a/b/g' src/app.ts",
      "pnpm add left-pad",
      "rm src/app.ts",
      "sed -i '' 's/a/b/g' src/app.ts",
      "tee src/app.ts",
      "touch src/app.ts",
      "yarn upgrade",
      "printf ok > src/app.ts",
    ];

    for (const [index, command] of commands.entries()) {
      const transcriptPath = join(transcriptDir, `mutating-${index}.jsonl`);
      writeFileSync(transcriptPath, buildShellCommandTranscript(command));

      const interactions = await codex.extractInteractions(transcriptPath);

      assert.deepEqual(interactions[0].tools, ["exec_command"], command);
      assert.deepEqual(interactions[0].mutation_tools, ["exec_command"], command);
    }
  });

  it("does not mark read-only shell commands as mutation tools", async () => {
    const transcriptDir = join(codexHome, "sessions", "shell-readonly");
    mkdirSync(transcriptDir, { recursive: true });
    const commands = [
      "git status --short",
      "npm test",
      "pnpm test",
      "yarn test",
      "cat src/app.ts",
      "grep rm src/app.ts",
      'echo "rm src/app.ts"',
      "printf '>'",
    ];

    for (const [index, command] of commands.entries()) {
      const transcriptPath = join(transcriptDir, `readonly-${index}.jsonl`);
      writeFileSync(transcriptPath, buildShellCommandTranscript(command));

      const interactions = await codex.extractInteractions(transcriptPath);

      assert.deepEqual(interactions[0].tools, ["exec_command"], command);
      assert.equal(interactions[0].mutation_tools, undefined, command);
    }
  });

  it("normalizes absolute patch paths and ignores nested patch markers inside added code", async () => {
    const transcriptDir = join(codexHome, "sessions", "normalized");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, "rollout.jsonl");

    writeFileSync(
      transcriptPath,
      '{"type":"session_meta","payload":{"id":"normalized-session","cwd":"/repo"}}\n' +
        '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Tighten Codex parser tests"}]}}\n' +
        '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Updating parser coverage."}]}}\n' +
        '{"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch\\n*** Update File: /repo/src/codex.test.ts\\n@@\\n-const oldValue = 1;\\n+const embedded = `*** Begin Patch\\\\n*** Add File: fake.txt\\\\n+oops\\\\n*** End Patch\\\\n`;\\n*** End Patch\\n"}}\n',
    );

    const interactions = await codex.extractInteractions(transcriptPath);
    assert.equal(interactions.length, 1);
    assert.deepEqual(interactions[0].files_touched, ["src/codex.test.ts"]);
    assert.deepEqual(interactions[0].line_stats, {
      "src/codex.test.ts": { added: 1, deleted: 1 },
    });
  });

  it("finds transcripts by embedded session id when the filename is not the session id", () => {
    const sessionId = "codex-session-fallback";
    const transcriptDir = join(codexHome, "sessions", "2026", "04", "10");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, "rollout.jsonl");

    writeFileSync(
      transcriptPath,
      '{"type":"session_meta","payload":{"id":"codex-session-fallback","timestamp":"2026-04-10T00:00:00Z"}}\n',
    );

    assert.equal(codex.findTranscript(sessionId), transcriptPath);
  });

  it("prefers the session_meta payload id over unrelated ids in earlier transcript lines", () => {
    const sessionId = "codex-session-meta-id";
    const transcriptDir = join(codexHome, "sessions", "2026", "04", "11");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, "rollout.jsonl");

    writeFileSync(
      transcriptPath,
      '{"type":"response_item","payload":{"type":"function_call","id":"call_unrelated"}}\n' +
        '{"type":"session_meta","payload":{"id":"codex-session-meta-id","timestamp":"2026-04-11T00:00:00Z"}}\n',
    );

    assert.equal(codex.findTranscript(sessionId), transcriptPath);
  });

  it("ignores unknown roles and unrelated payload types in transcripts", async () => {
    const transcriptDir = join(codexHome, "sessions", "roles");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, "rollout.jsonl");

    writeFileSync(
      transcriptPath,
      '{"type":"response_item","payload":{"type":"message","role":"system","content":[{"type":"output_text","text":"System guidance"}]}}\n' +
        '{"type":"response_item","payload":{"type":"tool_use","name":"shell","input":{"command":"pwd"}}}\n' +
        '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Create a note"}]}}\n' +
        '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Working on it."}]}}\n',
    );

    const interactions = await codex.extractInteractions(transcriptPath);
    assert.equal(interactions.length, 1);
    assert.equal(interactions[0].prompt, "Create a note");
    assert.equal(interactions[0].response, "Working on it.");
  });

  it("rejects transcript paths outside codexHome during extraction", async () => {
    await assert.rejects(codex.extractInteractions("/etc/passwd"), /Invalid Codex transcript path/);
  });

  it("rejects prefix-matching transcript paths during extraction", async () => {
    await assert.rejects(
      codex.extractInteractions(`${codexHome}-evil/session.jsonl`),
      /Invalid Codex transcript path/,
    );
  });

  it("rejects transcript paths that escape codexHome during extraction", async () => {
    await assert.rejects(
      codex.extractInteractions(join(codexHome, "..", "outside", "session.jsonl")),
      /Invalid Codex transcript path/,
    );
  });

  describe("hooks config", () => {
    function writeCodexConfig(repoRoot: string, hooksCommand: string, extraCommand?: string): void {
      const codexDir = join(repoRoot, ".codex");
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(join(codexDir, "config.toml"), "[features]\ncodex_hooks = true\n");
      writeFileSync(
        join(codexDir, "hooks.json"),
        `${JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    { type: "command", command: hooksCommand },
                    ...(extraCommand ? [{ type: "command", command: extraCommand }] : []),
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );
    }

    it("accepts repo-local dist hook commands as managed Codex hooks", async () => {
      const repoRoot = mkdtempSync(join(tmpdir(), "agentnote-codex-repo-"));
      try {
        writeCodexConfig(repoRoot, "node packages/cli/dist/cli.js hook --agent codex");

        assert.equal(await codex.isEnabled(repoRoot), true);
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
      }
    });

    it("removes legacy repo-local dist hooks while preserving unrelated hooks", async () => {
      const repoRoot = mkdtempSync(join(tmpdir(), "agentnote-codex-repo-"));
      try {
        writeCodexConfig(
          repoRoot,
          "node packages/cli/dist/cli.js hook --agent codex",
          "echo keep-me",
        );

        await codex.removeHooks(repoRoot);

        const hooksContent = readFileSync(join(repoRoot, ".codex", "hooks.json"), "utf8");
        assert.equal(hooksContent.includes("cli.js hook --agent codex"), false);
        assert.equal(hooksContent.includes("echo keep-me"), true);
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
      }
    });

    it("upgrades legacy repo-local dist hooks to the public Codex hook command", async () => {
      const repoRoot = mkdtempSync(join(tmpdir(), "agentnote-codex-repo-"));
      try {
        writeCodexConfig(repoRoot, "node packages/cli/dist/cli.js hook --agent codex");

        await codex.installHooks(repoRoot);

        const hooksContent = readFileSync(join(repoRoot, ".codex", "hooks.json"), "utf8");
        assert.equal(
          hooksContent.includes("node packages/cli/dist/cli.js hook --agent codex"),
          false,
        );
        assert.equal(hooksContent.includes("npx --yes agent-note hook --agent codex"), true);
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
      }
    });
  });
});
