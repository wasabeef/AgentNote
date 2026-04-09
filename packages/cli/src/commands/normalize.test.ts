import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeEntry } from "./normalize.js";

describe("normalizeEntry", () => {
  it("passes through new structured format unchanged", () => {
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

  it("converts legacy flat format to structured", () => {
    const raw = {
      v: 1,
      session_id: "abc",
      timestamp: "2026-01-01T00:00:00Z",
      interactions: [{ prompt: "hello", response: null }],
      files_in_commit: ["a.ts", "b.ts"],
      files_by_ai: ["a.ts"],
      ai_ratio: 50,
    };
    const entry = normalizeEntry(raw);
    assert.equal(entry.files.length, 2);
    assert.equal(entry.files[0].path, "a.ts");
    assert.equal(entry.files[0].by_ai, true);
    assert.equal(entry.files[1].by_ai, false);
    assert.equal(entry.attribution.ai_ratio, 50);
    assert.equal(entry.attribution.method, "file");
    assert.equal(entry.model, null);
  });

  it("converts legacy flat format with line counts", () => {
    const raw = {
      v: 1,
      session_id: "abc",
      timestamp: "2026-01-01T00:00:00Z",
      interactions: [],
      files_in_commit: ["a.ts"],
      files_by_ai: ["a.ts"],
      ai_ratio: 73,
      ai_added_lines: 146,
      total_added_lines: 200,
      deleted_lines: 12,
    };
    const entry = normalizeEntry(raw);
    assert.equal(entry.attribution.method, "line");
    assert.equal(entry.attribution.lines?.ai_added, 146);
    assert.equal(entry.attribution.lines?.total_added, 200);
    assert.equal(entry.attribution.lines?.deleted, 12);
  });

  it("handles deletion-only legacy note (total_added_lines = 0)", () => {
    const raw = {
      v: 1,
      session_id: "abc",
      timestamp: "2026-01-01T00:00:00Z",
      interactions: [],
      files_in_commit: ["a.ts"],
      files_by_ai: ["a.ts"],
      ai_ratio: 0,
      ai_added_lines: 0,
      total_added_lines: 0,
      deleted_lines: 5,
    };
    const entry = normalizeEntry(raw);
    assert.equal(entry.attribution.method, "none");
  });

  it("handles legacy prompts array", () => {
    const raw = {
      v: 1,
      session_id: "abc",
      timestamp: "2026-01-01T00:00:00Z",
      prompts: ["prompt1", "prompt2"],
      files_in_commit: [],
      files_by_ai: [],
      ai_ratio: 0,
    };
    const entry = normalizeEntry(raw);
    assert.equal(entry.interactions.length, 2);
    assert.equal(entry.interactions[0].prompt, "prompt1");
    assert.equal(entry.interactions[0].response, null);
  });
});
