import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  AGENTNOTE_DIR,
  CHANGES_FILE,
  COMMITTED_PAIRS_FILE,
  EMPTY_BLOB,
  PRE_BLOBS_FILE,
  PROMPTS_FILE,
  SESSIONS_DIR,
  TURN_FILE,
} from "./constants.js";
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

function hashBlob(repoDir: string, content: string): string {
  return execSync("git hash-object -w --stdin", {
    cwd: repoDir,
    encoding: "utf-8",
    input: content,
  }).trim();
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
        '{"event":"prompt","prompt":"first prompt","prompt_id":"id-first","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
          '{"event":"prompt","prompt":"second prompt","prompt_id":"id-second","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n',
      );
      writeFileSync(
        join(sessionDir, CHANGES_FILE),
        '{"event":"file_change","tool":"Write","file":"file1.ts","turn":1,"prompt_id":"id-first"}\n' +
          '{"event":"file_change","tool":"Write","file":"file2.ts","turn":2,"prompt_id":"id-second"}\n',
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
    // The causal window should keep nearby planning prompts that lead into
    // the surviving edit block, even when those prompts did not edit files.
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

  it("excludes older overwritten edit turns from the causal prompt window", async () => {
    const draftBlob = hashBlob(repoDir, "export const note = 'draft';\n");
    const finalBlob = hashBlob(repoDir, "export const note = 'final';\n");

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"rough draft","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"ship the final version","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n',
    );
    writeFileSync(
      join(sessionDir, PRE_BLOBS_FILE),
      `{"event":"pre_edit","file":"impl.ts","turn":1,"tool_use_id":"t1","blob":"${EMPTY_BLOB}"}\n` +
        `{"event":"pre_edit","file":"impl.ts","turn":2,"tool_use_id":"t2","blob":"${draftBlob}"}\n`,
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"impl.ts","turn":1,"tool_use_id":"t1","blob":"${draftBlob}"}\n` +
        `{"event":"file_change","tool":"Write","file":"impl.ts","turn":2,"tool_use_id":"t2","blob":"${finalBlob}"}\n`,
    );
    writeFileSync(join(sessionDir, TURN_FILE), "2\n");

    writeFileSync(join(repoDir, "impl.ts"), "export const note = 'final';\n");
    execSync("git add impl.ts", { cwd: repoDir });
    execSync('git commit -m "feat: finalize impl"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const prompts = (note.interactions as Array<{ prompt: string }>).map(
      (interaction) => interaction.prompt,
    );
    assert.deepEqual(prompts, ["ship the final version"]);
  });

  it("keeps prompt-only fallback for overwritten cross-turn Codex commits when transcript is missing", async () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    // Force this session onto the Codex adapter.
    writeFileSync(join(sessionDir, "agent"), "codex\n");

    try {
      const draftBlob = hashBlob(repoDir, "export const note = 'draft';\n");
      const finalBlob = hashBlob(repoDir, "export const note = 'final';\n");
      const missingTranscript = join(codexHome, "sessions", "missing.jsonl");

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"rough draft","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
          '{"event":"prompt","prompt":"ship the final version","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n',
      );
      writeFileSync(
        join(sessionDir, PRE_BLOBS_FILE),
        `{"event":"pre_edit","file":"impl.ts","turn":1,"tool_use_id":"t1","blob":"${EMPTY_BLOB}"}\n` +
          `{"event":"pre_edit","file":"impl.ts","turn":2,"tool_use_id":"t2","blob":"${draftBlob}"}\n`,
      );
      writeFileSync(
        join(sessionDir, CHANGES_FILE),
        `{"event":"file_change","tool":"Write","file":"impl.ts","turn":1,"tool_use_id":"t1","blob":"${draftBlob}"}\n` +
          `{"event":"file_change","tool":"Write","file":"impl.ts","turn":2,"tool_use_id":"t2","blob":"${finalBlob}"}\n`,
      );
      // The commit spans turns 1 and 2, but the final diff only keeps turn 2.
      writeFileSync(join(sessionDir, TURN_FILE), "2\n");

      writeFileSync(join(repoDir, "impl.ts"), "export const note = 'final';\n");
      execSync("git add impl.ts", { cwd: repoDir });
      execSync('git commit -m "feat: codex fallback"', { cwd: repoDir });

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
      assert.ok(note !== null, "missing transcript should still leave a prompt-only note");
      const interactions = note.interactions as Array<{
        prompt: string;
        response: string | null;
        files_touched?: string[];
        tools?: string[] | null;
      }>;
      assert.deepEqual(
        interactions,
        [
          {
            prompt: "ship the final version",
            response: null,
            files_touched: ["impl.ts"],
            tools: ["Write"],
          },
        ],
        "overwritten earlier turns should not disable cross-turn fallback",
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

  it("file-level fallback keeps only the latest touch per committed file", async () => {
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"old dashboard config","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"old sidebar tree","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n' +
        '{"event":"prompt","prompt":"unrelated docs change","turn":3,"timestamp":"2026-04-13T10:00:02Z"}\n' +
        '{"event":"prompt","prompt":"generic deploy defaults","turn":4,"timestamp":"2026-04-13T10:00:03Z"}\n' +
        '{"event":"prompt","prompt":"repo env docs","turn":5,"timestamp":"2026-04-13T10:00:04Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"dashboard.config.ts","turn":1}\n' +
        '{"event":"file_change","tool":"Write","file":"viewer.ts","turn":2}\n' +
        '{"event":"file_change","tool":"Write","file":"README.md","turn":3}\n' +
        '{"event":"file_change","tool":"Write","file":"dashboard.config.ts","turn":4}\n' +
        '{"event":"file_change","tool":"Write","file":"viewer.ts","turn":5}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "5\n");

    writeFileSync(join(repoDir, "dashboard.config.ts"), "export const base = '/';\n");
    writeFileSync(join(repoDir, "viewer.ts"), "export const repo = 'env';\n");
    execSync("git add dashboard.config.ts viewer.ts", { cwd: repoDir });
    execSync('git commit -m "fix: generic dashboard defaults"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const attribution = note.attribution as { method?: string } | undefined;
    assert.equal(attribution?.method, "file");
    const prompts = (note.interactions as Array<{ prompt: string }>).map(
      (interaction) => interaction.prompt,
    );
    assert.deepEqual(prompts, ["generic deploy defaults", "repo env docs"]);
  });

  it("file-level fallback keeps only backward context around the latest touch", async () => {
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"old README cleanup","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"unrelated docs edit","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n' +
        '{"event":"prompt","prompt":"clarify env defaults","turn":3,"timestamp":"2026-04-13T10:00:02Z"}\n' +
        '{"event":"prompt","prompt":"ship final README change","turn":4,"timestamp":"2026-04-13T10:00:03Z"}\n' +
        '{"event":"prompt","prompt":"explain the fix","turn":5,"timestamp":"2026-04-13T10:00:04Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"README.md","turn":1}\n' +
        '{"event":"file_change","tool":"Write","file":"docs/guide.md","turn":2}\n' +
        '{"event":"file_change","tool":"Write","file":"README.md","turn":4}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "5\n");

    mkdirSync(join(repoDir, "docs"), { recursive: true });
    writeFileSync(join(repoDir, "README.md"), "## Agent Note\n");
    execSync("git add README.md", { cwd: repoDir });
    execSync('git commit -m "docs: tighten README note window"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const prompts = (note.interactions as Array<{ prompt: string }>).map(
      (interaction) => interaction.prompt,
    );
    assert.deepEqual(prompts, ["clarify env defaults", "ship final README change"]);
  });

  it("file-level fallback can keep multiple latest clusters without leaking unrelated edits", async () => {
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"touch a.ts","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"unrelated c.ts","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n' +
        '{"event":"prompt","prompt":"touch b.ts","turn":3,"timestamp":"2026-04-13T10:00:02Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"a.ts","turn":1}\n' +
        '{"event":"file_change","tool":"Write","file":"c.ts","turn":2}\n' +
        '{"event":"file_change","tool":"Write","file":"b.ts","turn":3}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "3\n");

    writeFileSync(join(repoDir, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(repoDir, "b.ts"), "export const b = 1;\n");
    execSync("git add a.ts b.ts", { cwd: repoDir });
    execSync('git commit -m "feat: keep disjoint file clusters"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const attribution = note.attribution as { method?: string } | undefined;
    assert.equal(attribution?.method, "file");
    const prompts = (note.interactions as Array<{ prompt: string }>).map(
      (interaction) => interaction.prompt,
    );
    assert.deepEqual(prompts, ["touch a.ts", "touch b.ts"]);
  });

  it("file-level fallback keeps prompt-only context between primary turns", async () => {
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"touch a.ts","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"bridge the follow-up change","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n' +
        '{"event":"prompt","prompt":"touch b.ts","turn":3,"timestamp":"2026-04-13T10:00:02Z"}\n' +
        '{"event":"prompt","prompt":"summarize the commit","turn":4,"timestamp":"2026-04-13T10:00:03Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"a.ts","turn":1}\n' +
        '{"event":"file_change","tool":"Write","file":"b.ts","turn":3}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "4\n");

    writeFileSync(join(repoDir, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(repoDir, "b.ts"), "export const b = 1;\n");
    execSync("git add a.ts b.ts", { cwd: repoDir });
    execSync('git commit -m "feat: keep bridge context only"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const prompts = (note.interactions as Array<{ prompt: string }>).map(
      (interaction) => interaction.prompt,
    );
    assert.deepEqual(prompts, ["touch a.ts", "bridge the follow-up change", "touch b.ts"]);
  });

  it("file-level fallback keeps context before a short primary prompt without keyword filtering", async () => {
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"long earlier discussion about generated files and dashboard deploy details that is no longer the best explanation","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"Missing commit notes should keep a prompt-only note when Codex misses commit files\\n- keep the human-only skip\\n- rescue only the current implementation thread","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n' +
        '{"event":"prompt","prompt":"yes, implement that","turn":3,"timestamp":"2026-04-13T10:00:02Z"}\n' +
        '{"event":"prompt","prompt":"apply the record fallback in record.ts","turn":4,"timestamp":"2026-04-13T10:00:03Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"record.ts","turn":4}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "4\n");

    writeFileSync(join(repoDir, "record.ts"), "export const record = true;\n");
    execSync("git add record.ts", { cwd: repoDir });
    execSync('git commit -m "fix: keep prompt window context"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const prompts = (note.interactions as Array<{ prompt: string }>).map(
      (interaction) => interaction.prompt,
    );
    assert.deepEqual(prompts, [
      "Missing commit notes should keep a prompt-only note when Codex misses commit files\n- keep the human-only skip\n- rescue only the current implementation thread",
      "yes, implement that",
      "apply the record fallback in record.ts",
    ]);
  });

  it("prompt window keeps commit-to-commit context and trims stale leading chatter", async () => {
    writeFileSync(
      join(sessionDir, COMMITTED_PAIRS_FILE),
      '{"turn":355,"file":"previous.ts","change_id":null,"tool_use_id":null}\n',
    );
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"review the previous PR one last time","turn":356,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"was that branch pushed?","turn":357,"timestamp":"2026-04-13T10:00:01Z"}\n' +
        '{"event":"prompt","prompt":"the merge is done, switch back to main","turn":358,"timestamp":"2026-04-13T10:00:02Z"}\n' +
        '{"event":"prompt","prompt":"do you remember the packages redesign discussion?","turn":359,"timestamp":"2026-04-13T10:00:03Z"}\n' +
        '{"event":"prompt","prompt":"cut a branch and start the work","turn":360,"timestamp":"2026-04-13T10:00:04Z"}\n' +
        '{"event":"prompt","prompt":"do not keep backward compatibility; remove obsolete paths","turn":361,"timestamp":"2026-04-13T10:00:05Z"}\n' +
        '{"event":"prompt","prompt":"c","turn":362,"timestamp":"2026-04-13T10:00:06Z"}\n' +
        '{"event":"prompt","prompt":"after implementation, check:\\n- no missing implementation\\n- CLI agents still work\\n- docs, README, CLAUDE.md, AGENTS.md, and website locales are updated","turn":363,"timestamp":"2026-04-13T10:00:07Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"packages/pr-report/src/index.ts","turn":363}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "363\n");

    mkdirSync(join(repoDir, "packages", "pr-report", "src"), { recursive: true });
    writeFileSync(join(repoDir, "packages", "pr-report", "src", "index.ts"), "export {};\n");
    execSync("git add packages/pr-report/src/index.ts", { cwd: repoDir });
    execSync('git commit -m "refactor(repo): split pr report and dashboard logic"', {
      cwd: repoDir,
    });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const prompts = (note.interactions as Array<{ prompt: string }>).map(
      (interaction) => interaction.prompt,
    );
    assert.deepEqual(prompts, [
      "do you remember the packages redesign discussion?",
      "cut a branch and start the work",
      "do not keep backward compatibility; remove obsolete paths",
      "after implementation, check:\n- no missing implementation\n- CLI agents still work\n- docs, README, CLAUDE.md, AGENTS.md, and website locales are updated",
    ]);
  });

  it("prompt window drops quoted prompt-history meta before the current work", async () => {
    writeFileSync(
      join(sessionDir, COMMITTED_PAIRS_FILE),
      '{"turn":365,"file":"previous.ts","change_id":null,"tool_use_id":null}\n',
    );
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"In the current PR, the first prompt was\\n\\n🧑 Prompt: old package split prompt\\n\\n🤖 Response: old implementation response\\n  with lots of quoted lines\\n  and prior context\\n\\nWhy was the previous prompt not selected?","turn":366,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"For now, review the PR scope later","turn":368,"timestamp":"2026-04-13T10:00:01Z"}\n' +
        '{"event":"prompt","prompt":"@.github/workflows/agentnote-dashboard.yml\\n\\nWhy is this much larger than the PR Report workflow?","turn":369,"timestamp":"2026-04-13T10:00:02Z"}\n' +
        '{"event":"prompt","prompt":"@.github/workflows/agentnote-dashboard.yml#L37\\n\\nIs this line still needed?","turn":370,"timestamp":"2026-04-13T10:00:03Z"}\n' +
        '{"event":"prompt","prompt":"Can the dashboard be generated in this PR?","turn":371,"timestamp":"2026-04-13T10:00:04Z"}\n' +
        '{"event":"prompt","prompt":"fix it","turn":372,"timestamp":"2026-04-13T10:00:05Z"}\n' +
        '{"event":"prompt","prompt":"Consider both this repository and the common setup users will have.","turn":373,"timestamp":"2026-04-13T10:00:06Z"}\n' +
        '{"event":"prompt","prompt":"@.github/workflows/agentnote-dashboard.yml#L51\\n\\nAre these prefixes specific to this repository?","turn":374,"timestamp":"2026-04-13T10:00:07Z"}\n' +
        '{"event":"prompt","prompt":"Is packages/dashboard itself repository-specific?","turn":375,"timestamp":"2026-04-13T10:00:08Z"}\n' +
        '{"event":"prompt","prompt":"improve it","turn":376,"timestamp":"2026-04-13T10:00:09Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":".github/workflows/agentnote-dashboard.yml","turn":376}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "376\n");

    mkdirSync(join(repoDir, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(repoDir, ".github", "workflows", "agentnote-dashboard.yml"),
      "name: Dashboard\n",
    );
    execSync("git add .github/workflows/agentnote-dashboard.yml", { cwd: repoDir });
    execSync('git commit -m "fix(workflow): hide dashboard package paths"', {
      cwd: repoDir,
    });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const prompts = (note.interactions as Array<{ prompt: string }>).map(
      (interaction) => interaction.prompt,
    );
    assert.deepEqual(prompts, [
      "@.github/workflows/agentnote-dashboard.yml\n\nWhy is this much larger than the PR Report workflow?",
      "@.github/workflows/agentnote-dashboard.yml#L37\n\nIs this line still needed?",
      "Can the dashboard be generated in this PR?",
      "fix it",
      "Consider both this repository and the common setup users will have.",
      "@.github/workflows/agentnote-dashboard.yml#L51\n\nAre these prefixes specific to this repository?",
      "Is packages/dashboard itself repository-specific?",
      "improve it",
    ]);
  });

  it("excludes generated artifacts from line-level AI ratio", async () => {
    const sourceBlob = hashBlob(repoDir, "export const status = 'done';\n");

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"finish service.ts","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n',
    );
    writeFileSync(
      join(sessionDir, PRE_BLOBS_FILE),
      `{"event":"pre_edit","file":"src/service.ts","turn":1,"tool_use_id":"t1","blob":"${EMPTY_BLOB}"}\n`,
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"src/service.ts","turn":1,"tool_use_id":"t1","blob":"${sourceBlob}"}\n`,
    );
    writeFileSync(join(sessionDir, TURN_FILE), "1\n");

    mkdirSync(join(repoDir, "src"), { recursive: true });
    mkdirSync(join(repoDir, "dist"), { recursive: true });
    writeFileSync(join(repoDir, "src", "service.ts"), "export const status = 'done';\n");
    writeFileSync(join(repoDir, "dist", "index.js"), "/* compiled */\n");
    execSync("git add src/service.ts dist/index.js", { cwd: repoDir });
    execSync('git commit -m "feat: generated line attribution"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const typedNote = note as {
      attribution: { method: string; ai_ratio: number };
      files: Array<{ path: string; generated?: boolean }>;
    };
    assert.equal(typedNote.attribution.method, "line");
    assert.equal(
      typedNote.attribution.ai_ratio,
      100,
      "generated files should be ignored even when line-level attribution is available",
    );
    const files = typedNote.files;
    assert.equal(files.find((file) => file.path === "dist/index.js")?.generated, true);
  });

  it("marks generated files from committed content without reading the whole blob into attribution", async () => {
    const source = `// Code generated by sqlc. DO NOT EDIT.\n${"x".repeat(8192)}\n`;

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"check generated client","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"snapshots/client.txt","turn":1}\n',
    );
    writeFileSync(join(sessionDir, TURN_FILE), "1\n");

    mkdirSync(join(repoDir, "snapshots"), { recursive: true });
    writeFileSync(join(repoDir, "snapshots", "client.txt"), source);
    execSync("git add snapshots/client.txt", { cwd: repoDir });
    execSync('git commit -m "test: generated content markers"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const files = note.files as Array<{ path: string; generated?: boolean }>;
    assert.equal(files.find((file) => file.path === "snapshots/client.txt")?.generated, true);
    assert.equal(
      (note.attribution as { ai_ratio: number }).ai_ratio,
      0,
      "content-marked generated files should be excluded from AI ratio",
    );
  });

  it("preserves turn ownership for FIFO blob pairing without tool_use_id", async () => {
    const draftBlob = hashBlob(repoDir, "export const parser = 'draft';\n");
    const finalBlob = hashBlob(repoDir, "export const parser = 'final';\n");

    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","prompt":"draft parser","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
        '{"event":"prompt","prompt":"ship final parser","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n',
    );
    writeFileSync(
      join(sessionDir, PRE_BLOBS_FILE),
      `{"event":"pre_edit","file":"parser.ts","turn":1,"blob":"${EMPTY_BLOB}"}\n` +
        `{"event":"pre_edit","file":"parser.ts","turn":2,"blob":"${draftBlob}"}\n`,
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"write_file","file":"parser.ts","turn":1,"blob":"${draftBlob}"}\n` +
        `{"event":"file_change","tool":"replace","file":"parser.ts","turn":2,"blob":"${finalBlob}"}\n`,
    );
    writeFileSync(join(sessionDir, TURN_FILE), "2\n");

    writeFileSync(join(repoDir, "parser.ts"), "export const parser = 'final';\n");
    execSync("git add parser.ts", { cwd: repoDir });
    execSync('git commit -m "feat: fifo fallback turns"', { cwd: repoDir });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID });

    const note = await readNote(commitSha);
    assert.ok(note !== null);
    const prompts = (note.interactions as Array<{ prompt: string }>).map(
      (interaction) => interaction.prompt,
    );
    assert.deepEqual(
      prompts,
      ["ship final parser"],
      "FIFO blob pairing should still attribute surviving lines to the latest turn",
    );
  });

  it("skips writing note when a commit has no AI-edited files, even if session has prompts", async () => {
    // A purely human commit sharing a session with prior AI work should not
    // inherit that AI conversation.
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

  it("does not leak prompts from prior commits in the same session", async () => {
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
    // commit only includes human-only.ts. The empty-prompt shortcut must stop
    // the prompt window from pulling the other file's
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

  it("mid-session Codex commit keeps a prompt-only note when transcript attribution misses commit files", async () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    writeFileSync(join(sessionDir, "agent"), "codex\n");

    try {
      const transcriptDir = join(codexHome, "sessions");
      mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = join(transcriptDir, "missing-files.jsonl");
      writeFileSync(
        transcriptPath,
        [
          `{"timestamp":"2026-04-15T09:30:00Z","type":"session_meta","payload":{"id":"${SESSION_ID}","timestamp":"2026-04-15T09:30:00Z"}}`,
          '{"timestamp":"2026-04-15T09:30:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"edit first.ts"}]}}',
          '{"timestamp":"2026-04-15T09:30:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"editing first"}]}}',
          '{"timestamp":"2026-04-15T09:30:03Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","call_id":"c1","arguments":"{\\"input\\":\\"*** Begin Patch\\\\n*** Add File: first.ts\\\\n+export const first = 1;\\\\n*** End Patch\\"}"}}',
          '{"timestamp":"2026-04-15T09:30:04Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"plan dashboard workflow cleanup"}]}}',
          '{"timestamp":"2026-04-15T09:30:05Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I\\u0027ll move the shared entrypoints and clean up the workflow next."}]}}',
          '{"timestamp":"2026-04-15T09:30:06Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"yes, proceed with the cleanup"}]}}',
          '{"timestamp":"2026-04-15T09:30:07Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Proceeding with the workflow cleanup."}]}}',
          '{"timestamp":"2026-04-15T09:30:08Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","call_id":"c2","arguments":"{\\"input\\":\\"*** Begin Patch\\\\n*** Add File: unrelated.ts\\\\n+export const unrelated = true;\\\\n*** End Patch\\"}"}}',
        ].join("\n"),
      );

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"edit first.ts","prompt_id":"id-first","turn":1,"timestamp":"2026-04-15T09:30:01Z"}\n' +
          '{"event":"prompt","prompt":"plan dashboard workflow cleanup","prompt_id":"id-plan","turn":2,"timestamp":"2026-04-15T09:30:04Z"}\n' +
          '{"event":"prompt","prompt":"yes, proceed with the cleanup","prompt_id":"id-go","turn":3,"timestamp":"2026-04-15T09:30:06Z"}\n',
      );
      writeFileSync(join(sessionDir, TURN_FILE), "3\n");

      writeFileSync(join(repoDir, "first.ts"), "export const first = 1;\n");
      execSync("git add first.ts", { cwd: repoDir });
      execSync('git commit -m "feat: first codex commit"', { cwd: repoDir });
      await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID, transcriptPath });

      const workflowPath = join(repoDir, ".github/workflows/test.yml");
      mkdirSync(dirname(workflowPath), { recursive: true });
      writeFileSync(
        workflowPath,
        "name: Test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n",
      );
      writeFileSync(join(repoDir, "docs.md"), "# dashboard cleanup\n");
      execSync("git add .github/workflows/test.yml docs.md", { cwd: repoDir });
      execSync('git commit -m "fix: workflow cleanup"', { cwd: repoDir });

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
      assert.ok(note !== null, "mid-session false negative should still leave a prompt-only note");
      const interactions = note.interactions as Array<{
        prompt: string;
        response: string | null;
        files_touched?: string[];
      }>;
      assert.deepEqual(
        interactions.map((interaction) => interaction.prompt),
        ["plan dashboard workflow cleanup", "yes, proceed with the cleanup"],
      );
      assert.equal(
        interactions[0].response,
        "I'll move the shared entrypoints and clean up the workflow next.",
      );
      assert.equal(interactions[1].response, "Proceeding with the workflow cleanup.");
      assert.equal(interactions[0].files_touched, undefined);
      assert.equal(interactions[1].files_touched, undefined);
      assert.equal((note.attribution as { ai_ratio: number }).ai_ratio, 0);
    } finally {
      if (prevCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prevCodexHome;
      }
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it("mid-session Codex prompt-only fallback trims stale discussion before the commit window anchor", async () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    writeFileSync(join(sessionDir, "agent"), "codex\n");

    try {
      const transcriptDir = join(codexHome, "sessions");
      mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = join(transcriptDir, "prompt-only-anchor.jsonl");
      writeFileSync(
        transcriptPath,
        [
          `{"timestamp":"2026-04-15T09:30:00Z","type":"session_meta","payload":{"id":"${SESSION_ID}","timestamp":"2026-04-15T09:30:00Z"}}`,
          '{"timestamp":"2026-04-15T09:30:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"edit first.ts"}]}}',
          '{"timestamp":"2026-04-15T09:30:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"editing first"}]}}',
          '{"timestamp":"2026-04-15T09:30:03Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","call_id":"c1","arguments":"{\\"input\\":\\"*** Begin Patch\\\\n*** Add File: first.ts\\\\n+export const first = 1;\\\\n*** End Patch\\"}"}}',
          '{"timestamp":"2026-04-15T09:30:04Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"older prompt-selection v2 and generated artifact discussion that should not be the main note anchor"}]}}',
          '{"timestamp":"2026-04-15T09:30:05Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"older context"}]}}',
          '{"timestamp":"2026-04-15T09:30:06Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"keep a prompt-only note for Codex when transcript attribution misses commit files\\n- keep human-only commits skipped\\n- keep only the current commit window"}]}}',
          '{"timestamp":"2026-04-15T09:30:07Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I\\u0027ll keep the fallback scoped to the current commit window."}]}}',
          '{"timestamp":"2026-04-15T09:30:08Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"yes, implement that"}]}}',
          '{"timestamp":"2026-04-15T09:30:09Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Implementing the narrow fallback now."}]}}',
          '{"timestamp":"2026-04-15T09:30:10Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","call_id":"c2","arguments":"{\\"input\\":\\"*** Begin Patch\\\\n*** Add File: unrelated.ts\\\\n+export const unrelated = true;\\\\n*** End Patch\\"}"}}',
        ].join("\n"),
      );

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"edit first.ts","prompt_id":"id-first","turn":1,"timestamp":"2026-04-15T09:30:01Z"}\n' +
          '{"event":"prompt","prompt":"older prompt-selection v2 and generated artifact discussion that should not be the main note anchor","prompt_id":"id-old","turn":2,"timestamp":"2026-04-15T09:30:04Z"}\n' +
          '{"event":"prompt","prompt":"keep a prompt-only note for Codex when transcript attribution misses commit files\\n- keep human-only commits skipped\\n- keep only the current commit window","prompt_id":"id-plan","turn":3,"timestamp":"2026-04-15T09:30:06Z"}\n' +
          '{"event":"prompt","prompt":"yes, implement that","prompt_id":"id-go","turn":4,"timestamp":"2026-04-15T09:30:08Z"}\n',
      );
      writeFileSync(join(sessionDir, TURN_FILE), "4\n");

      writeFileSync(join(repoDir, "first.ts"), "export const first = 1;\n");
      execSync("git add first.ts", { cwd: repoDir });
      execSync('git commit -m "feat: first codex commit"', { cwd: repoDir });
      await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID, transcriptPath });

      const workflowPath = join(repoDir, ".github/workflows/test.yml");
      mkdirSync(dirname(workflowPath), { recursive: true });
      writeFileSync(
        workflowPath,
        "name: Test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n",
      );
      writeFileSync(join(repoDir, "docs.md"), "# dashboard cleanup\n");
      execSync("git add .github/workflows/test.yml docs.md", { cwd: repoDir });
      execSync('git commit -m "fix: workflow cleanup"', { cwd: repoDir });

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
      const interactions = note.interactions as Array<{ prompt: string }>;
      assert.deepEqual(
        interactions.map((interaction) => interaction.prompt),
        [
          "keep a prompt-only note for Codex when transcript attribution misses commit files\n- keep human-only commits skipped\n- keep only the current commit window",
          "yes, implement that",
        ],
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
    // pre-blob turns as consumed, the next commit's causal window can still
    // leak those prompts.

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

  it("correlatePromptIds strict count: duplicates + dropped transcript → skip the whole group, no mis-pair", async () => {
    // When session has 3 "continue" prompts but transcript has only 2
    // (middle one dropped), pairing is ambiguous. The strict count check
    // skips the entire text group rather than silently attaching the wrong
    // response. All 3 session prompts get response=null, which is safer
    // than pairing turn 2 with turn 3's response.
    const claudeHome = mkdtempSync(join(tmpdir(), "claude-home-"));
    const prevClaudeHome = process.env.AGENTNOTE_CLAUDE_HOME;
    process.env.AGENTNOTE_CLAUDE_HOME = claudeHome;

    try {
      const transcriptPath = join(claudeHome, `${SESSION_ID}.jsonl`);
      // Transcript has only 2 of 3 "continue" interactions (middle one dropped).
      writeFileSync(
        transcriptPath,
        [
          '{"type":"user","message":{"content":[{"type":"text","text":"continue"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"response first"}]}}',
          // middle "continue" + "response middle" dropped from transcript
          '{"type":"user","message":{"content":[{"type":"text","text":"continue"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"response third"}]}}',
        ].join("\n"),
      );

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"continue","prompt_id":"id-1","turn":1,"timestamp":"2026-04-13T10:00:00Z"}\n' +
          '{"event":"prompt","prompt":"continue","prompt_id":"id-2","turn":2,"timestamp":"2026-04-13T10:00:01Z"}\n' +
          '{"event":"prompt","prompt":"continue","prompt_id":"id-3","turn":3,"timestamp":"2026-04-13T10:00:02Z"}\n',
      );
      writeFileSync(
        join(sessionDir, CHANGES_FILE),
        '{"event":"file_change","tool":"Write","file":"a.ts","turn":1,"prompt_id":"id-1"}\n' +
          '{"event":"file_change","tool":"Write","file":"b.ts","turn":2,"prompt_id":"id-2"}\n' +
          '{"event":"file_change","tool":"Write","file":"c.ts","turn":3,"prompt_id":"id-3"}\n',
      );
      writeFileSync(join(sessionDir, TURN_FILE), "3\n");

      writeFileSync(join(repoDir, "a.ts"), "export const a = 1;\n");
      writeFileSync(join(repoDir, "b.ts"), "export const b = 2;\n");
      writeFileSync(join(repoDir, "c.ts"), "export const c = 3;\n");
      execSync("git add a.ts b.ts c.ts", { cwd: repoDir });
      execSync('git commit -m "three continues"', { cwd: repoDir });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID, transcriptPath });

      const note = await readNote(commitSha);
      assert.ok(note !== null);
      const interactions = note.interactions as Array<{ prompt: string; response: string | null }>;
      // Strict count: session count 3, transcript count 2 for "continue" →
      // skip the whole group. All three prompts keep response=null.
      assert.equal(interactions[0].response, null, "turn 1 not paired — count mismatch");
      assert.equal(interactions[1].response, null, "turn 2 not paired — count mismatch");
      assert.equal(interactions[2].response, null, "turn 3 not paired — count mismatch");
    } finally {
      if (prevClaudeHome === undefined) {
        delete process.env.AGENTNOTE_CLAUDE_HOME;
      } else {
        process.env.AGENTNOTE_CLAUDE_HOME = prevClaudeHome;
      }
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("transcript-driven (Codex) commit keeps nearby prompt-only context", async () => {
    // Codex has no file_change events, so transcript interactions define the
    // primary edit turns. Prompt-only context immediately before that edit
    // block should still appear in `interactions`.
    const codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    writeFileSync(join(sessionDir, "agent"), "codex\n");

    try {
      const transcriptDir = join(codexHome, "sessions");
      mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = join(transcriptDir, "context.jsonl");
      writeFileSync(
        transcriptPath,
        [
          `{"timestamp":"2026-04-15T09:31:23Z","type":"session_meta","payload":{"id":"${SESSION_ID}","timestamp":"2026-04-15T09:31:23Z"}}`,
          '{"timestamp":"2026-04-15T09:31:24Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"plan first"}]}}',
          '{"timestamp":"2026-04-15T09:31:25Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"planning..."}]}}',
          '{"timestamp":"2026-04-15T09:31:26Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"edit target.ts"}]}}',
          '{"timestamp":"2026-04-15T09:31:27Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"editing..."}]}}',
          '{"timestamp":"2026-04-15T09:31:28Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","call_id":"c1","arguments":"{\\"input\\":\\"*** Begin Patch\\\\n*** Add File: target.ts\\\\n+export const t = 1;\\\\n*** End Patch\\"}"}}',
        ].join("\n"),
      );

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"plan first","prompt_id":"id-plan","turn":1,"timestamp":"2026-04-15T09:31:24Z"}\n' +
          '{"event":"prompt","prompt":"edit target.ts","prompt_id":"id-edit","turn":2,"timestamp":"2026-04-15T09:31:26Z"}\n',
      );
      writeFileSync(join(sessionDir, TURN_FILE), "2\n");

      writeFileSync(join(repoDir, "target.ts"), "export const t = 1;\n");
      execSync("git add target.ts", { cwd: repoDir });
      execSync('git commit -m "codex commit"', { cwd: repoDir });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID, transcriptPath });

      const note = await readNote(commitSha);
      assert.ok(note !== null);
      const interactions = note.interactions as Array<{
        prompt: string;
        response: string | null;
      }>;
      assert.equal(interactions.length, 2, "both prompts in the window appear");
      assert.equal(interactions[0].prompt, "plan first");
      assert.equal(
        interactions[0].response,
        "planning...",
        "context prompt (no file edit) still pairs with its response",
      );
      assert.equal(interactions[1].prompt, "edit target.ts");
      assert.equal(interactions[1].response, "editing...");
    } finally {
      if (prevCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prevCodexHome;
      }
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it("transcript-driven Codex: consecutive commits do not leak prior prompts", async () => {
    // Codex has no file_change events → recordConsumedPairs previously
    // skipped these sessions entirely, so maxConsumedTurn stayed at 0 and
    // every commit re-included the whole session's prompts. The consumed-
    // prompt path now advances maxConsumedTurn for the transcript-driven
    // branch too.
    const codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    writeFileSync(join(sessionDir, "agent"), "codex\n");

    try {
      const transcriptDir = join(codexHome, "sessions");
      mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = join(transcriptDir, "leak.jsonl");
      writeFileSync(
        transcriptPath,
        [
          `{"timestamp":"2026-04-15T10:00:00Z","type":"session_meta","payload":{"id":"${SESSION_ID}","timestamp":"2026-04-15T10:00:00Z"}}`,
          // Turn 1: edit first.ts
          '{"timestamp":"2026-04-15T10:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"edit first"}]}}',
          '{"timestamp":"2026-04-15T10:00:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"editing first"}]}}',
          '{"timestamp":"2026-04-15T10:00:03Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","call_id":"c1","arguments":"{\\"input\\":\\"*** Begin Patch\\\\n*** Add File: first.ts\\\\n+export const f = 1;\\\\n*** End Patch\\"}"}}',
          // Turn 2: edit second.ts
          '{"timestamp":"2026-04-15T10:00:04Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"edit second"}]}}',
          '{"timestamp":"2026-04-15T10:00:05Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"editing second"}]}}',
          '{"timestamp":"2026-04-15T10:00:06Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","call_id":"c2","arguments":"{\\"input\\":\\"*** Begin Patch\\\\n*** Add File: second.ts\\\\n+export const s = 2;\\\\n*** End Patch\\"}"}}',
        ].join("\n"),
      );

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"edit first","prompt_id":"id-first","turn":1,"timestamp":"2026-04-15T10:00:01Z"}\n' +
          '{"event":"prompt","prompt":"edit second","prompt_id":"id-second","turn":2,"timestamp":"2026-04-15T10:00:04Z"}\n',
      );
      writeFileSync(join(sessionDir, TURN_FILE), "2\n");

      // --- Commit 1: first.ts only ---
      writeFileSync(join(repoDir, "first.ts"), "export const f = 1;\n");
      execSync("git add first.ts", { cwd: repoDir });
      execSync('git commit -m "first"', { cwd: repoDir });
      const firstSha = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8" }).trim();
      await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID, transcriptPath });

      const firstNote = await readNote(firstSha);
      assert.ok(firstNote !== null);
      const firstInteractions = firstNote.interactions as Array<{ prompt: string }>;
      assert.deepEqual(
        firstInteractions.map((interaction) => interaction.prompt),
        ["edit first"],
        "first commit keeps only its causal prompt block",
      );

      // --- Commit 2: second.ts only ---
      writeFileSync(join(repoDir, "second.ts"), "export const s = 2;\n");
      execSync("git add second.ts", { cwd: repoDir });
      execSync('git commit -m "second"', { cwd: repoDir });
      const secondSha = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8" }).trim();
      await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID, transcriptPath });

      const secondNote = await readNote(secondSha);
      assert.ok(secondNote !== null, "second commit must still write a note");
      const secondInteractions = secondNote.interactions as Array<{ prompt: string }>;
      const prompts = secondInteractions.map((i) => i.prompt);
      // After fix, maxConsumedTurn advances to 2 after commit 1 so commit 2's
      // window is no longer the whole session. But split-commit semantics
      // still apply: the prompt whose transcript work edited THIS commit's
      // files (id-second → second.ts) is re-included. The unrelated prompt
      // (id-first) must stay out.
      assert.ok(
        !prompts.includes("edit first"),
        "commit 2 must not re-include the prompt already billed to commit 1",
      );
      assert.deepEqual(prompts, ["edit second"], "commit 2 shows only its edit-linked prompt");
    } finally {
      if (prevCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prevCodexHome;
      }
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it("transcript-driven Codex ignores generated files when selecting primary turns", async () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    writeFileSync(join(sessionDir, "agent"), "codex\n");

    try {
      writeFileSync(join(repoDir, "target.ts"), "export const note = 'baseline';\n");
      execSync("git add target.ts", { cwd: repoDir });
      execSync('git commit -m "baseline"', { cwd: repoDir });

      const transcriptDir = join(codexHome, "sessions");
      mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = join(transcriptDir, "generated.jsonl");
      writeFileSync(
        transcriptPath,
        [
          `{"timestamp":"2026-04-15T10:30:00Z","type":"session_meta","payload":{"id":"${SESSION_ID}","timestamp":"2026-04-15T10:30:00Z"}}`,
          '{"timestamp":"2026-04-15T10:30:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"draft target"}]}}',
          '{"timestamp":"2026-04-15T10:30:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"drafting"}]}}',
          '{"timestamp":"2026-04-15T10:30:03Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","call_id":"c1","arguments":"{\\"patch\\":\\"*** Begin Patch\\\\n*** Update File: target.ts\\\\n@@\\\\n-export const note = \'baseline\';\\\\n+export const note = \'draft\';\\\\n*** End Patch\\\\n\\"}"}}',
          '{"timestamp":"2026-04-15T10:30:04Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"ship final target"}]}}',
          '{"timestamp":"2026-04-15T10:30:05Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"finalizing"}]}}',
          '{"timestamp":"2026-04-15T10:30:06Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","call_id":"c2","arguments":"{\\"patch\\":\\"*** Begin Patch\\\\n*** Update File: target.ts\\\\n@@\\\\n-export const note = \'draft\';\\\\n+export const note = \'final\';\\\\n*** End Patch\\\\n\\"}"}}',
        ].join("\n"),
      );

      writeFileSync(
        join(sessionDir, PROMPTS_FILE),
        '{"event":"prompt","prompt":"draft target","prompt_id":"id-draft","turn":1,"timestamp":"2026-04-15T10:30:01Z"}\n' +
          '{"event":"prompt","prompt":"ship final target","prompt_id":"id-final","turn":2,"timestamp":"2026-04-15T10:30:04Z"}\n',
      );
      writeFileSync(join(sessionDir, TURN_FILE), "2\n");

      mkdirSync(join(repoDir, "proto"), { recursive: true });
      writeFileSync(join(repoDir, "target.ts"), "export const note = 'final';\n");
      writeFileSync(
        join(repoDir, "proto", "service.pb.go"),
        "// Code generated by protoc-gen-go. DO NOT EDIT.\npackage proto\n",
      );
      execSync("git add target.ts proto/service.pb.go", { cwd: repoDir });
      execSync('git commit -m "codex generated"', { cwd: repoDir });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      await recordCommitEntry({ agentnoteDirPath, sessionId: SESSION_ID, transcriptPath });

      const note = await readNote(commitSha);
      assert.ok(note !== null);
      const prompts = (note.interactions as Array<{ prompt: string }>).map(
        (interaction) => interaction.prompt,
      );
      assert.deepEqual(
        prompts,
        ["ship final target"],
        "generated files should not force transcript-driven selection to widen back to all turns",
      );
      const typedNote = note as {
        attribution: { ai_ratio: number };
        files: Array<{ path: string; generated?: boolean }>;
      };
      const files = typedNote.files;
      assert.equal(files.find((file) => file.path === "proto/service.pb.go")?.generated, true);
      assert.equal(typedNote.attribution.ai_ratio, 100);
    } finally {
      if (prevCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prevCodexHome;
      }
      rmSync(codexHome, { recursive: true, force: true });
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
