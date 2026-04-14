import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SCHEMA_VERSION } from "./constants.js";
import type { FileEntry, LineCounts } from "./entry.js";
import { buildEntry, calcAiRatio } from "./entry.js";

describe("calcAiRatio", () => {
  it("uses line counts when totalAddedLines > 0", () => {
    const files: FileEntry[] = [
      { path: "a.ts", by_ai: true },
      { path: "b.ts", by_ai: false },
    ];
    const lineCounts: LineCounts = { aiAddedLines: 30, totalAddedLines: 100, deletedLines: 5 };
    assert.equal(calcAiRatio(files, lineCounts), 30);
  });

  it("falls back to file ratio when lineCounts is undefined", () => {
    const files: FileEntry[] = [
      { path: "a.ts", by_ai: true },
      { path: "b.ts", by_ai: true },
      { path: "c.ts", by_ai: false },
    ];
    assert.equal(calcAiRatio(files), 67);
  });

  it("returns 0 when files is empty", () => {
    assert.equal(calcAiRatio([]), 0);
  });

  it("falls back to file ratio when totalAddedLines is 0", () => {
    const files: FileEntry[] = [
      { path: "a.ts", by_ai: true },
      { path: "b.ts", by_ai: false },
    ];
    const lineCounts: LineCounts = { aiAddedLines: 0, totalAddedLines: 0, deletedLines: 3 };
    // totalAddedLines=0 → file ratio: 1/2 = 50%
    assert.equal(calcAiRatio(files, lineCounts), 50);
  });

  it("returns 100 when all files are AI-authored", () => {
    const files: FileEntry[] = [{ path: "a.ts", by_ai: true }];
    assert.equal(calcAiRatio(files), 100);
  });

  it("returns 0 when no files are AI-authored", () => {
    const files: FileEntry[] = [
      { path: "a.ts", by_ai: false },
      { path: "b.ts", by_ai: false },
    ];
    assert.equal(calcAiRatio(files), 0);
  });
});

describe("buildEntry", () => {
  const sessionId = "a0000000-0000-4000-8000-000000000001";

  it("builds a basic entry with correct schema version", () => {
    const entry = buildEntry({
      agent: "claude",
      sessionId,
      model: "claude-3-opus",
      interactions: [{ prompt: "write a function", response: "here it is" }],
      commitFiles: ["src/foo.ts"],
      aiFiles: ["src/foo.ts"],
    });
    assert.equal(entry.v, SCHEMA_VERSION);
    assert.equal(entry.session_id, sessionId);
    assert.equal(entry.agent, "claude");
    assert.equal(entry.model, "claude-3-opus");
    assert.equal(typeof entry.timestamp, "string");
    assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
  });

  it("sets method=line and attaches lines when lineCounts provided", () => {
    const lineCounts: LineCounts = { aiAddedLines: 50, totalAddedLines: 100, deletedLines: 10 };
    const entry = buildEntry({
      sessionId,
      interactions: [{ prompt: "p", response: "r" }],
      commitFiles: ["a.ts"],
      aiFiles: ["a.ts"],
      lineCounts,
    });
    assert.equal(entry.attribution.method, "line");
    assert.equal(entry.attribution.ai_ratio, 50);
    assert.deepEqual(entry.attribution.lines, {
      ai_added: 50,
      total_added: 100,
      deleted: 10,
    });
  });

  it("sets method=file when lineCounts is undefined", () => {
    const entry = buildEntry({
      sessionId,
      interactions: [{ prompt: "p", response: "r" }],
      commitFiles: ["a.ts", "b.ts"],
      aiFiles: ["a.ts"],
    });
    assert.equal(entry.attribution.method, "file");
    assert.equal(entry.attribution.ai_ratio, 50);
    assert.equal(entry.attribution.lines, undefined);
  });

  it("sets method=none and ai_ratio=0 when totalAddedLines is 0", () => {
    const lineCounts: LineCounts = { aiAddedLines: 0, totalAddedLines: 0, deletedLines: 5 };
    const entry = buildEntry({
      sessionId,
      interactions: [],
      commitFiles: ["a.ts"],
      aiFiles: ["a.ts"],
      lineCounts,
    });
    assert.equal(entry.attribution.method, "none");
    assert.equal(entry.attribution.ai_ratio, 0);
  });

  it("attaches tools from interactionTools map", () => {
    const interactionTools = new Map<number, string[] | null>([
      [0, ["Edit", "Write"]],
      [1, null],
    ]);
    const entry = buildEntry({
      sessionId,
      interactions: [
        { prompt: "p1", response: "r1" },
        { prompt: "p2", response: "r2" },
      ],
      commitFiles: [],
      aiFiles: [],
      interactionTools,
    });
    assert.deepEqual(entry.interactions[0].tools, ["Edit", "Write"]);
    assert.equal(entry.interactions[1].tools, null);
  });

  it("defaults agent and model to null when not provided", () => {
    const entry = buildEntry({
      sessionId,
      interactions: [],
      commitFiles: [],
      aiFiles: [],
    });
    assert.equal(entry.agent, null);
    assert.equal(entry.model, null);
  });

  it("builds files array with correct by_ai flags", () => {
    const entry = buildEntry({
      sessionId,
      interactions: [],
      commitFiles: ["a.ts", "b.ts", "c.ts"],
      aiFiles: ["a.ts", "c.ts"],
    });
    assert.deepEqual(entry.files, [
      { path: "a.ts", by_ai: true },
      { path: "b.ts", by_ai: false },
      { path: "c.ts", by_ai: true },
    ]);
  });

  it("inherits tools from interaction when interactionTools has no entry for that index", () => {
    const entry = buildEntry({
      sessionId,
      interactions: [{ prompt: "p", response: "r", tools: ["Bash"] }],
      commitFiles: [],
      aiFiles: [],
    });
    assert.deepEqual(entry.interactions[0].tools, ["Bash"]);
  });

  it("omits files_touched when empty", () => {
    const entry = buildEntry({
      sessionId,
      interactions: [{ prompt: "p", response: "r", files_touched: [] }],
      commitFiles: [],
      aiFiles: [],
    });
    assert.equal(entry.interactions[0].files_touched, undefined);
  });
});
