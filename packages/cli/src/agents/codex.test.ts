import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { codex } from "./codex.js";

const VALID_SESSION_ID = "a0000000-0000-4000-8000-000000000001";
const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));

function loadFixture(name: string, replacements: Record<string, string>): string {
  let content = readFileSync(join(FIXTURES_DIR, name), "utf-8");
  for (const [token, value] of Object.entries(replacements)) {
    content = content.replaceAll(token, value);
  }
  return content;
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
      loadFixture("codex-real-session-patch.jsonl", {
        __SESSION_ID__: VALID_SESSION_ID,
        __WORKDIR__: "/repo",
        __PATCH_PATH__: "src/status.ts",
        __PROMPT__: "Review the status output.",
        __RESPONSE__: "I will inspect the current state and update the status output.",
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
    assert.deepEqual(interactions[0].files_touched, ["src/status.ts"]);
    assert.deepEqual(interactions[0].line_stats, {
      "src/status.ts": { added: 1, deleted: 0 },
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
});
