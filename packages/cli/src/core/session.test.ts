import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  CHANGES_FILE,
  PROMPTS_FILE,
  SESSION_AGENT_FILE,
  TRANSCRIPT_PATH_FILE,
} from "./constants.js";
import {
  hasRecordableSessionData,
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

describe("hasRecordableSessionData", () => {
  let sessionDir: string;

  before(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "agentnote-session-recordable-"));
  });

  after(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("returns false for metadata-only sessions", async () => {
    writeFileSync(join(sessionDir, SESSION_AGENT_FILE), "claude\n");
    writeFileSync(join(sessionDir, TRANSCRIPT_PATH_FILE), "/tmp/transcript.jsonl\n");

    assert.equal(await hasRecordableSessionData(sessionDir), false);
  });

  it("returns true when prompt data exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-session-recordable-prompt-"));
    try {
      writeFileSync(join(dir, PROMPTS_FILE), '{"event":"prompt","prompt":"fix"}\n');

      assert.equal(await hasRecordableSessionData(dir), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns true when change data exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-session-recordable-change-"));
    try {
      writeFileSync(join(dir, CHANGES_FILE), '{"event":"file_change","file":"src/app.ts"}\n');

      assert.equal(await hasRecordableSessionData(dir), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows Codex transcript-driven sessions with only transcript metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-session-recordable-codex-"));
    try {
      writeFileSync(join(dir, SESSION_AGENT_FILE), "codex\n");
      writeFileSync(join(dir, TRANSCRIPT_PATH_FILE), "/tmp/codex-rollout.jsonl\n");

      assert.equal(await hasRecordableSessionData(dir), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when the session directory is missing", async () => {
    const missingDir = join(tmpdir(), "agentnote-session-recordable-missing");

    assert.equal(await hasRecordableSessionData(missingDir), false);
  });
});
