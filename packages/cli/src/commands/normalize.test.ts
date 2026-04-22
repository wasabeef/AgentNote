import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeEntry } from "./normalize.js";

describe("normalizeEntry", () => {
  it("passes through the current structured format unchanged", () => {
    const raw = {
      v: 1,
      session_id: "abc",
      timestamp: "2026-01-01T00:00:00Z",
      model: "claude-sonnet-4-20250514",
      interactions: [
        { prompt: "hello", response: "world", files_touched: ["a.ts"], tools: ["Edit"] },
      ],
      files: [{ path: "a.ts", by_ai: true }],
      attribution: {
        ai_ratio: 100,
        method: "line",
        lines: { ai_added: 10, total_added: 10, deleted: 0 },
      },
    };

    const entry = normalizeEntry(raw);
    assert.equal(entry.model, "claude-sonnet-4-20250514");
    assert.equal(entry.attribution.method, "line");
    assert.equal(entry.files[0].path, "a.ts");
    assert.equal(entry.interactions[0].tools?.[0], "Edit");
  });

  it("rejects unsupported note shapes", () => {
    assert.throws(
      () =>
        normalizeEntry({
          v: 1,
          session_id: "abc",
          timestamp: "2026-01-01T00:00:00Z",
          files_in_commit: ["a.ts"],
          files_by_ai: ["a.ts"],
          ai_ratio: 100,
        }),
      /unsupported agent-note entry format/,
    );
  });
});
