import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { codex } from "./codex.js";

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
});
