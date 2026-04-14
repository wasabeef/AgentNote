import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  readSessionAgent,
  readSessionTranscriptPath,
  writeSessionAgent,
  writeSessionTranscriptPath,
} from "./session.js";

describe("session agent round-trip", () => {
  let sessionDir: string;
  before(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "agentnote-session-"));
  });
  after(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("writes and reads agent name", async () => {
    await writeSessionAgent(sessionDir, "claude");
    const result = await readSessionAgent(sessionDir);
    assert.equal(result, "claude");
  });

  it("returns null when agent file does not exist", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "agentnote-session-empty-"));
    try {
      const result = await readSessionAgent(emptyDir);
      assert.equal(result, null);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("overwrites existing agent name", async () => {
    await writeSessionAgent(sessionDir, "codex");
    const result = await readSessionAgent(sessionDir);
    assert.equal(result, "codex");
  });
});

describe("session transcript path round-trip", () => {
  let sessionDir: string;
  before(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "agentnote-session-transcript-"));
  });
  after(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("writes and reads transcript path", async () => {
    const path = "/home/user/.claude/projects/abc/transcript.jsonl";
    await writeSessionTranscriptPath(sessionDir, path);
    const result = await readSessionTranscriptPath(sessionDir);
    assert.equal(result, path);
  });

  it("returns null when transcript_path file does not exist", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "agentnote-session-tp-empty-"));
    try {
      const result = await readSessionTranscriptPath(emptyDir);
      assert.equal(result, null);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("preserves path with spaces and special characters", async () => {
    const path = "/home/user/.claude/projects/my project (2)/transcript.jsonl";
    await writeSessionTranscriptPath(sessionDir, path);
    const result = await readSessionTranscriptPath(sessionDir);
    assert.equal(result, path);
  });
});
