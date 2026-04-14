import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CHANGES_FILE, PROMPTS_FILE } from "./constants.js";
import { rotateLogs } from "./rotate.js";

describe("rotateLogs", () => {
  let sessionDir: string;
  before(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "agentnote-rotate-"));
  });
  after(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("renames prompts.jsonl and changes.jsonl with rotation ID", async () => {
    writeFileSync(join(sessionDir, PROMPTS_FILE), '{"prompt":"test"}\n');
    writeFileSync(join(sessionDir, CHANGES_FILE), '{"file":"a.ts"}\n');

    const rotateId = "abc123";
    await rotateLogs(sessionDir, rotateId);

    assert.ok(!existsSync(join(sessionDir, PROMPTS_FILE)), "prompts.jsonl should be renamed");
    assert.ok(!existsSync(join(sessionDir, CHANGES_FILE)), "changes.jsonl should be renamed");
    assert.ok(
      existsSync(join(sessionDir, `prompts-${rotateId}.jsonl`)),
      "rotated prompts file should exist",
    );
    assert.ok(
      existsSync(join(sessionDir, `changes-${rotateId}.jsonl`)),
      "rotated changes file should exist",
    );
  });

  it("does not throw when files do not exist", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "agentnote-rotate-empty-"));
    try {
      await rotateLogs(emptyDir, "xyz999");
      // No files to rename — should complete without error
      const files = await readdir(emptyDir);
      assert.equal(files.length, 0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("renames custom file names with rotation ID", async () => {
    const customDir = mkdtempSync(join(tmpdir(), "agentnote-rotate-custom-"));
    try {
      writeFileSync(join(customDir, "events.jsonl"), '{"event":"test"}\n');
      await rotateLogs(customDir, "def456", ["events.jsonl"]);

      assert.ok(!existsSync(join(customDir, "events.jsonl")), "events.jsonl should be renamed");
      assert.ok(
        existsSync(join(customDir, "events-def456.jsonl")),
        "rotated events file should exist",
      );
    } finally {
      rmSync(customDir, { recursive: true, force: true });
    }
  });

  it("only renames files that exist (partial)", async () => {
    const partialDir = mkdtempSync(join(tmpdir(), "agentnote-rotate-partial-"));
    try {
      // Only write prompts, not changes
      writeFileSync(join(partialDir, PROMPTS_FILE), '{"prompt":"p"}\n');

      await rotateLogs(partialDir, "zzz111");

      assert.ok(!existsSync(join(partialDir, PROMPTS_FILE)), "prompts.jsonl should be renamed");
      assert.ok(
        existsSync(join(partialDir, `prompts-zzz111.jsonl`)),
        "rotated prompts should exist",
      );
      assert.ok(!existsSync(join(partialDir, CHANGES_FILE)), "changes.jsonl was never created");
    } finally {
      rmSync(partialDir, { recursive: true, force: true });
    }
  });
});
