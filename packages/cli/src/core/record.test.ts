import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AGENTNOTE_DIR, CHANGES_FILE, PROMPTS_FILE, SESSIONS_DIR, TURN_FILE } from "./constants.js";
import { recordCommitEntry } from "./record.js";
import { readNote } from "./storage.js";

const SESSION_ID = "a0000000-0000-4000-8000-000000000001";

function setupGitRepo(): { repoDir: string; agentnoteDirPath: string; sessionDir: string } {
  const repoDir = mkdtempSync(join(tmpdir(), "agentnote-record-"));
  execSync("git init", { cwd: repoDir });
  execSync("git config user.email test@test.com", { cwd: repoDir });
  execSync("git config user.name Test", { cwd: repoDir });
  execSync("git commit --allow-empty -m initial", { cwd: repoDir });

  const agentnoteDirPath = join(repoDir, ".git", AGENTNOTE_DIR);
  const sessionDir = join(agentnoteDirPath, SESSIONS_DIR, SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });

  // Write agent file so the adapter is known
  writeFileSync(join(sessionDir, "agent"), "claude\n");

  return { repoDir, agentnoteDirPath, sessionDir };
}

describe("recordCommitEntry", () => {
  let repoDir: string;
  let agentnoteDirPath: string;
  let sessionDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    const setup = setupGitRepo();
    repoDir = setup.repoDir;
    agentnoteDirPath = setup.agentnoteDirPath;
    sessionDir = setup.sessionDir;
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("basic: records a git note for a commit with prompts and file change", async () => {
    // Create a file and commit it
    writeFileSync(join(repoDir, "hello.ts"), "export const x = 1;\n");
    execSync("git add hello.ts", { cwd: repoDir });
    execSync('git commit -m "add hello"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    // Write session data (no turn tracking — v1 compat path)
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"write a function","timestamp":"2026-04-13T10:00:00Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"hello.ts"}\n`,
    );

    const result = await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    assert.equal(result.promptCount, 1);
    assert.ok(result.aiRatio >= 0 && result.aiRatio <= 100);

    const note = await readNote(commitSha);
    assert.ok(note !== null, "git note should exist");
    assert.equal(note.v, 1);
    assert.equal(note.session_id, SESSION_ID);
    assert.ok(Array.isArray(note.interactions));
  });

  it("idempotent: calling twice returns promptCount=0 on second call", async () => {
    writeFileSync(join(repoDir, "idem.ts"), "export const y = 2;\n");
    execSync("git add idem.ts", { cwd: repoDir });
    execSync('git commit -m "add idem"', { cwd: repoDir });

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"make it idempotent","timestamp":"2026-04-13T10:00:00Z"}\n',
    );

    const first = await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });
    assert.equal(first.promptCount, 1);

    const second = await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });
    assert.equal(second.promptCount, 0);
    assert.equal(second.aiRatio, 0);
  });

  it("excludes files not in the commit from the note", async () => {
    // Commit only one file but record changes for two files
    writeFileSync(join(repoDir, "committed.ts"), "export const a = 1;\n");
    writeFileSync(join(repoDir, "not-committed.ts"), "export const b = 2;\n");
    execSync("git add committed.ts", { cwd: repoDir });
    execSync('git commit -m "partial commit"', { cwd: repoDir });

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"add files","timestamp":"2026-04-13T10:00:00Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"committed.ts"}\n` +
        `{"event":"file_change","tool":"Write","file":"not-committed.ts"}\n`,
    );

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();
    const note = await readNote(commitSha);
    assert.ok(note !== null);

    const files = note.files as Array<{ path: string; by_ai: boolean }>;
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("committed.ts"), "committed file should be in note");
    assert.ok(!paths.includes("not-committed.ts"), "uncommitted file should not be in note");
  });

  it("cross-turn commit: exact prompt-content match recovers responses from transcript", async () => {
    // Simulate a bundled commit where edits from multiple earlier turns are
    // committed after the turn counter has moved on. Without the exact-match
    // path, this scenario would return response=null for every interaction.
    const claudeHome = mkdtempSync(join(tmpdir(), "claude-home-"));
    const prevClaudeHome = process.env.AGENTNOTE_CLAUDE_HOME;
    process.env.AGENTNOTE_CLAUDE_HOME = claudeHome;

    try {
      const transcriptPath = join(claudeHome, `${SESSION_ID}.jsonl`);
      writeFileSync(
        transcriptPath,
        [
          '{"type":"user","message":{"content":[{"type":"text","text":"first prompt"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"first response"}]}}',
          '{"type":"user","message":{"content":[{"type":"text","text":"second prompt"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"second response"}]}}',
        ].join("\n"),
      );

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"first prompt","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
          '{"event":"prompt","prompt":"second prompt","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n',
      );
      writeFileSync(
        join(sessionDir, CHANGES_FILE),
        '{"event":"file_change","tool":"Write","file":"file1.ts","turn":1}\n' +
          '{"event":"file_change","tool":"Write","file":"file2.ts","turn":2}\n',
      );
      // Current turn advanced past the relevant turns — forces crossTurnCommit = true.
      writeFileSync(join(sessionDir, TURN_FILE), "5\n");

      writeFileSync(join(repoDir, "file1.ts"), "export const a = 1;\n");
      writeFileSync(join(repoDir, "file2.ts"), "export const b = 2;\n");
      execSync("git add file1.ts file2.ts", { cwd: repoDir });
      execSync('git commit -m "cross-turn bundled commit"', { cwd: repoDir });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      await recordCommitEntry({
        agentnoteDirPath,
        sessionId: SESSION_ID,
        transcriptPath,
      });

      const note = await readNote(commitSha);
      assert.ok(note !== null);

      const interactions = note.interactions as Array<{
        prompt: string;
        response: string | null;
      }>;
      assert.equal(interactions.length, 2);
      assert.equal(interactions[0].prompt, "first prompt");
      assert.equal(
        interactions[0].response,
        "first response",
        "cross-turn commit should still recover first response via exact content match",
      );
      assert.equal(interactions[1].prompt, "second prompt");
      assert.equal(
        interactions[1].response,
        "second response",
        "cross-turn commit should still recover second response via exact content match",
      );
    } finally {
      if (prevClaudeHome === undefined) {
        delete process.env.AGENTNOTE_CLAUDE_HOME;
      } else {
        process.env.AGENTNOTE_CLAUDE_HOME = prevClaudeHome;
      }
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("cross-turn commit: Codex transcript throw does not abort note creation", async () => {
    // Codex adapter.extractInteractions() throws when the transcript path is
    // invalid or missing — by design, because Codex attribution is transcript-
    // native. Before this guard, such a throw on the cross-turn path would
    // bubble up and skip the whole note. The fix tolerates it on cross-turn
    // only (same-turn Codex still fails loudly, preserving codex.test.ts's
    // "warn + skip note" contract at commands/codex.test.ts:411).
    const codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    // Override the agent marker so this session uses the Codex adapter.
    writeFileSync(join(sessionDir, "agent"), "codex\n");

    try {
      // Path under CODEX_HOME so isValidTranscriptPath() passes; file absent
      // so extractInteractions() throws "Codex transcript not found:".
      const missingTranscript = join(codexHome, "sessions", "missing.jsonl");

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"some prompt","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n',
      );
      writeFileSync(
        join(sessionDir, CHANGES_FILE),
        '{"event":"file_change","tool":"Write","file":"file.ts","turn":1}\n',
      );
      // Current turn advanced past the relevant turns — forces crossTurnCommit = true.
      writeFileSync(join(sessionDir, TURN_FILE), "5\n");

      writeFileSync(join(repoDir, "file.ts"), "export const a = 1;\n");
      execSync("git add file.ts", { cwd: repoDir });
      execSync('git commit -m "missing codex transcript"', { cwd: repoDir });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      await recordCommitEntry({
        agentnoteDirPath,
        sessionId: SESSION_ID,
        transcriptPath: missingTranscript,
      });

      const note = await readNote(commitSha);
      assert.ok(note !== null, "note should still be written even when transcript is unreadable");
      const interactions = note.interactions as Array<{
        prompt: string;
        response: string | null;
      }>;
      assert.equal(interactions.length, 1);
      assert.equal(interactions[0].prompt, "some prompt");
      assert.equal(interactions[0].response, null, "response should fall back to null");
    } finally {
      if (prevCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prevCodexHome;
      }
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it("includes context prompts (non-edit-linked) in interactions when commit has AI edits", async () => {
    // Option B: a commit note keeps the full conversation window. Earlier
    // discussion / planning prompts that did not themselves edit files
    // should appear as interactions alongside the edit-linked prompt.
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"read the spec","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"propose an approach","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n' +
        '{"event":"prompt","prompt":"implement it","turn":3,"timestamp":"2026-04-13T10:00:02Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"impl.ts","turn":3}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "3\n");

    writeFileSync(join(repoDir, "impl.ts"), "export const a = 1;\n");
    execSync("git add impl.ts", { cwd: repoDir });
    execSync('git commit -m "feat: implement it"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const interactions = note.interactions as Array<{
      prompt: string;
      files_touched?: string[];
    }>;
    assert.equal(interactions.length, 3, "should include all 3 session prompts");
    assert.equal(interactions[0].prompt, "read the spec");
    assert.equal(interactions[1].prompt, "propose an approach");
    assert.equal(interactions[2].prompt, "implement it");
    // Only the edit-linked prompt (turn 3) carries files_touched.
    assert.equal(interactions[0].files_touched, undefined);
    assert.equal(interactions[1].files_touched, undefined);
    assert.deepEqual(interactions[2].files_touched, ["impl.ts"]);
  });

  it("skips writing note when a commit has no AI-edited files, even if session has prompts", async () => {
    // Guard for Option B: a purely human commit sharing a session with prior
    // AI work should not inherit those prompts. Without this guard the empty-
    // note skip would no longer fire for human commits in split scenarios.
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"AI please write feature.ts","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n',
    );
    // changes.jsonl references a file NOT in this commit — commit is human-only.
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"feature.ts","turn":1}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "1\n");

    writeFileSync(join(repoDir, "human-only.ts"), "export const h = 0;\n");
    execSync("git add human-only.ts", { cwd: repoDir });
    execSync('git commit -m "chore: human-only tweak"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    const result = await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });
    assert.equal(result.promptCount, 0);
    const note = await readNote(commitSha);
    assert.equal(note, null, "human-only commit should not inherit unrelated AI prompts");
  });

  it("does not leak prompts from prior commits in the same session (Option B unbilled window)", async () => {
    // Session spans two commits. Prompts from turns <= first commit's max turn
    // must not appear in the second commit's note — each commit owns its own
    // slice of the conversation.

    // --- First commit: turns 1 and 2, both edit first.ts ---
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"turn 1 intro","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"turn 2 edits first","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"first.ts","turn":2,"change_id":"c1"}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "2\n");

    writeFileSync(join(repoDir, "first.ts"), "export const a = 1;\n");
    execSync("git add first.ts", { cwd: repoDir });
    execSync('git commit -m "feat: first"', { cwd: repoDir });
    const firstSha = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8" }).trim();
    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const firstNote = await readNote(firstSha);
    assert.ok(firstNote !== null);
    const firstInteractions = firstNote.interactions as Array<{ prompt: string }>;
    assert.equal(firstInteractions.length, 2, "first commit sees both turn-1 and turn-2 prompts");

    // --- Second commit: add turn 3 and 4 prompts, turn 4 edits second.ts ---
    // Simulate rotation: archive current prompts and changes so readAllSessionJsonl
    // picks them up, then start fresh files for the new turns.
    const { rename: renameFile } = await import("node:fs/promises");
    await renameFile(join(sessionDir, PROMPTS_FILE), join(sessionDir, "prompts-archive1.jsonl"));
    await renameFile(join(sessionDir, CHANGES_FILE), join(sessionDir, "changes-archive1.jsonl"));

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"turn 3 context","turn":3,"timestamp":"2026-04-13T10:00:02Z"}\n' +
        '{"event":"prompt","prompt":"turn 4 edits second","turn":4,"timestamp":"2026-04-13T10:00:03Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"second.ts","turn":4,"change_id":"c2"}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "4\n");

    writeFileSync(join(repoDir, "second.ts"), "export const b = 2;\n");
    execSync("git add second.ts", { cwd: repoDir });
    execSync('git commit -m "feat: second"', { cwd: repoDir });
    const secondSha = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8" }).trim();
    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const secondNote = await readNote(secondSha);
    assert.ok(secondNote !== null);
    const secondInteractions = secondNote.interactions as Array<{ prompt: string }>;
    assert.equal(
      secondInteractions.length,
      2,
      "second commit should only see turn-3 and turn-4 prompts, not leak turn-1/2",
    );
    assert.equal(secondInteractions[0].prompt, "turn 3 context");
    assert.equal(secondInteractions[1].prompt, "turn 4 edits second");
  });

  it("human-only commit in Codex-style session with transcript for other files does not get a note", async () => {
    // Reviewer scenario: the transcript records AI editing file A, but the
    // commit only includes human-only.ts. Option B's empty-prompt shortcut
    // must stop `findTranscriptPromptWindow` from pulling the other file's
    // interaction into this commit's note.
    const codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    writeFileSync(join(sessionDir, "agent"), "codex\n");

    try {
      const transcriptPath = join(codexHome, `${SESSION_ID}.jsonl`);
      // Codex-style transcript with a single apply_patch for "other.ts" only.
      writeFileSync(
        transcriptPath,
        [
          `{"timestamp":"2026-04-15T09:31:23.296Z","type":"session_meta","payload":{"id":"${SESSION_ID}","timestamp":"2026-04-15T09:31:16.968Z"}}`,
          '{"timestamp":"2026-04-15T09:31:23.296Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"AI please edit other.ts"}]}}',
          '{"timestamp":"2026-04-15T09:31:35.585Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"OK, editing other.ts."}]}}',
          '{"timestamp":"2026-04-15T09:31:35.587Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","call_id":"c1","arguments":"{\\"input\\":\\"*** Begin Patch\\\\n*** Add File: other.ts\\\\n+export const x = 1;\\\\n*** End Patch\\"}"}}',
        ].join("\n"),
      );

      // Session recorded the prompt but Codex emits no file_change events.
      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"AI please edit other.ts","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n',
      );
      writeFileSync(join(sessionDir, TURN_FILE), "1\n");

      // User commits a file they created themselves — not in the transcript.
      writeFileSync(join(repoDir, "human-only.ts"), "export const h = 0;\n");
      execSync("git add human-only.ts", { cwd: repoDir });
      execSync('git commit -m "chore: human-only tweak"', { cwd: repoDir });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      await recordCommitEntry({
        agentnoteDirPath,
        sessionId: SESSION_ID,
        transcriptPath,
      });

      const note = await readNote(commitSha);
      assert.equal(
        note,
        null,
        "human-only commit must not inherit transcript interactions for other files",
      );
    } finally {
      if (prevCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prevCodexHome;
      }
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it("pre-blob-only commit records consumed pairs so prior prompts do not leak into the next commit", async () => {
    // Reviewer scenario: a commit's PostToolUse (→ changes.jsonl) was dropped
    // async, but PreToolUse (→ pre_blobs.jsonl) survived. relevantTurns still
    // forms via pre_blobs, so the note is written — but without also recording
    // pre-blob turns as consumed, the next commit's Option B window leaks
    // those prompts.

    // --- First commit: turn 1, only pre_blobs for first.ts (no change entry) ---
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"plan a","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"edit a","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n',
    );
    writeFileSync(
      join(sessionDir, "pre_blobs.jsonl"),
      '{"event":"pre_edit","file":"first.ts","turn":2,"tool_use_id":"t1","pre_blob":"e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "2\n");

    writeFileSync(join(repoDir, "first.ts"), "export const a = 1;\n");
    execSync("git add first.ts", { cwd: repoDir });
    execSync('git commit -m "feat: first (pre-blob only)"', { cwd: repoDir });
    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    // --- Second commit: new turn 3-4 for second.ts (normal hook data) ---
    // Use a 6+ char lowercase-alphanumeric suffix so ARCHIVE_ID_RE matches
    // and readAllSessionJsonl actually picks the archive up.
    const { rename: renameFile } = await import("node:fs/promises");
    await renameFile(join(sessionDir, PROMPTS_FILE), join(sessionDir, "prompts-arcvone.jsonl"));
    await renameFile(
      join(sessionDir, "pre_blobs.jsonl"),
      join(sessionDir, "pre_blobs-arcvone.jsonl"),
    );

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"plan b","turn":3,"timestamp":"2026-04-13T10:00:02Z"}\n' +
        '{"event":"prompt","prompt":"edit b","turn":4,"timestamp":"2026-04-13T10:00:03Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"second.ts","turn":4,"change_id":"c2"}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "4\n");

    writeFileSync(join(repoDir, "second.ts"), "export const b = 2;\n");
    execSync("git add second.ts", { cwd: repoDir });
    execSync('git commit -m "feat: second"', { cwd: repoDir });
    const secondSha = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8" }).trim();
    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const secondNote = await readNote(secondSha);
    assert.ok(secondNote !== null);
    const secondInteractions = secondNote.interactions as Array<{ prompt: string }>;
    const prompts = secondInteractions.map((i) => i.prompt);
    assert.deepEqual(
      prompts,
      ["plan b", "edit b"],
      "second commit should not leak prompts from the pre-blob-only first commit",
    );
  });

  it("prompt_id lookup pairs the right identical-text prompt with its response", async () => {
    // Transcript has FOUR "continue" interactions (responses A, B, C, D).
    // Session only ran turns 1 and 2 (mapped to transcript positions 0 and 1
    // → responses A and B). The old text-window algorithm descending-scans
    // and finds ["continue","continue"] at positions 2..3 first, pairing
    // session turns 1&2 with responses C&D — the WRONG ones. With prompt_id
    // lookup and adapter correlation, each session prompt finds its exact
    // transcript interaction by position.
    const claudeHome = mkdtempSync(join(tmpdir(), "claude-home-"));
    const prevClaudeHome = process.env.AGENTNOTE_CLAUDE_HOME;
    process.env.AGENTNOTE_CLAUDE_HOME = claudeHome;

    try {
      const transcriptPath = join(claudeHome, `${SESSION_ID}.jsonl`);
      writeFileSync(
        transcriptPath,
        [
          '{"type":"user","message":{"content":[{"type":"text","text":"continue"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"response A"}]}}',
          '{"type":"user","message":{"content":[{"type":"text","text":"continue"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"response B"}]}}',
          '{"type":"user","message":{"content":[{"type":"text","text":"continue"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"response C"}]}}',
          '{"type":"user","message":{"content":[{"type":"text","text":"continue"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"response D"}]}}',
        ].join("\n"),
      );

      // Session only captured turns 1 and 2. Their prompt_ids correlate to
      // transcript positions 0 and 1 (responses A and B) via the walk order.
      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"continue","prompt_id":"id-A","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
          '{"event":"prompt","prompt":"continue","prompt_id":"id-B","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n',
      );
      writeFileSync(
        join(sessionDir, CHANGES_FILE),
        '{"event":"file_change","tool":"Write","file":"a.ts","turn":1,"prompt_id":"id-A"}\n' +
          '{"event":"file_change","tool":"Write","file":"b.ts","turn":2,"prompt_id":"id-B"}\n',
      );
      writeFileSync(join(sessionDir, TURN_FILE), "2\n");

      writeFileSync(join(repoDir, "a.ts"), "export const a = 1;\n");
      writeFileSync(join(repoDir, "b.ts"), "export const b = 2;\n");
      execSync("git add a.ts b.ts", { cwd: repoDir });
      execSync('git commit -m "bundle both continues"', { cwd: repoDir });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID, transcriptPath });

      const note = await readNote(commitSha);
      assert.ok(note !== null);
      const interactions = note.interactions as Array<{ prompt: string; response: string | null }>;
      assert.equal(interactions.length, 2);
      assert.equal(interactions[0].prompt, "continue");
      assert.equal(
        interactions[0].response,
        "response A",
        "turn 1 must pair with response A, not C or D",
      );
      assert.equal(interactions[1].prompt, "continue");
      assert.equal(
        interactions[1].response,
        "response B",
        "turn 2 must pair with response B, not C or D",
      );
    } finally {
      if (prevClaudeHome === undefined) {
        delete process.env.AGENTNOTE_CLAUDE_HOME;
      } else {
        process.env.AGENTNOTE_CLAUDE_HOME = prevClaudeHome;
      }
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("correlatePromptIds skips missing transcript prompts instead of cascade-failing", async () => {
    // Session has 3 prompts [A, B, C], but the transcript only recorded A
    // and C (B missing — e.g. a dropped event or transcript truncation).
    // The walker must skip B and still tag C, not abandon the walk.
    const claudeHome = mkdtempSync(join(tmpdir(), "claude-home-"));
    const prevClaudeHome = process.env.AGENTNOTE_CLAUDE_HOME;
    process.env.AGENTNOTE_CLAUDE_HOME = claudeHome;

    try {
      const transcriptPath = join(claudeHome, `${SESSION_ID}.jsonl`);
      writeFileSync(
        transcriptPath,
        [
          '{"type":"user","message":{"content":[{"type":"text","text":"A"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"response A"}]}}',
          // B's user message is NOT in the transcript.
          '{"type":"user","message":{"content":[{"type":"text","text":"C"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"response C"}]}}',
        ].join("\n"),
      );

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"A","prompt_id":"id-A","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
          '{"event":"prompt","prompt":"B","prompt_id":"id-B","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n' +
          '{"event":"prompt","prompt":"C","prompt_id":"id-C","turn":3,"timestamp":"2026-04-13T10:00:02Z"}\n',
      );
      writeFileSync(
        join(sessionDir, CHANGES_FILE),
        '{"event":"file_change","tool":"Write","file":"a.ts","turn":1,"prompt_id":"id-A"}\n' +
          '{"event":"file_change","tool":"Write","file":"b.ts","turn":2,"prompt_id":"id-B"}\n' +
          '{"event":"file_change","tool":"Write","file":"c.ts","turn":3,"prompt_id":"id-C"}\n',
      );
      writeFileSync(join(sessionDir, TURN_FILE), "3\n");

      writeFileSync(join(repoDir, "a.ts"), "export const a = 1;\n");
      writeFileSync(join(repoDir, "b.ts"), "export const b = 2;\n");
      writeFileSync(join(repoDir, "c.ts"), "export const c = 3;\n");
      execSync("git add a.ts b.ts c.ts", { cwd: repoDir });
      execSync('git commit -m "bundle three turns"', { cwd: repoDir });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID, transcriptPath });

      const note = await readNote(commitSha);
      assert.ok(note !== null);
      const interactions = note.interactions as Array<{ prompt: string; response: string | null }>;
      assert.equal(interactions.length, 3);
      assert.equal(interactions[0].response, "response A", "A pairs with its response");
      assert.equal(
        interactions[1].response,
        null,
        "B has no transcript entry, so response stays null",
      );
      assert.equal(
        interactions[2].response,
        "response C",
        "C must still pair — the walker recovers after the missing B",
      );
    } finally {
      if (prevClaudeHome === undefined) {
        delete process.env.AGENTNOTE_CLAUDE_HOME;
      } else {
        process.env.AGENTNOTE_CLAUDE_HOME = prevClaudeHome;
      }
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("skips writing note when no prompts and no AI files exist", async () => {
    writeFileSync(join(repoDir, "empty.ts"), "export {};\n");
    execSync("git add empty.ts", { cwd: repoDir });
    execSync('git commit -m "no prompts"', { cwd: repoDir });

    // No prompts.jsonl or changes.jsonl written — e.g. rebased commit.
    const result = await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();
    const note = await readNote(commitSha);
    assert.equal(note, null, "should not write note when no AI data exists");
    assert.equal(result.promptCount, 0);
  });
});
