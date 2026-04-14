import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENTNOTE_DIR,
  CHANGES_FILE,
  HEARTBEAT_FILE,
  PROMPTS_FILE,
  SESSION_FILE,
  SESSIONS_DIR,
  TRAILER_KEY,
  TRANSCRIPT_PATH_FILE,
} from "../core/constants.js";

/** Write a fresh heartbeat so agentnote commit treats the session as active. */
function ensureHeartbeat(sessionDir: string): void {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));
}

describe("agentnote commit", () => {
  let testDir: string;
  let testHome: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-commit-"));
    testHome = join(testDir, ".home");
    mkdirSync(testHome, { recursive: true });
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir });
    execSync(`node ${cliPath} init --agent claude --hooks --no-git-hooks`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
    });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("adds Agentnote-Session trailer to commit", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    writeFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    ensureHeartbeat(sessionDir);

    writeFileSync(join(testDir, "hello.txt"), "hello");
    execSync("git add hello.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "test commit"`, { cwd: testDir });

    // verify trailer
    const msg = execSync("git log -1 --format=%B", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(
      msg.includes(`${TRAILER_KEY}: ${sessionId}`),
      "commit should have Agentnote-Session trailer",
    );
  });

  it("records entry as git note with prompts and AI ratio", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    ensureHeartbeat(sessionDir);

    // simulate prompts
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-02T10:00:00Z","prompt":"add feature"}\n' +
        '{"event":"prompt","timestamp":"2026-04-02T10:05:00Z","prompt":"fix bug"}\n',
    );

    // simulate AI file changes
    const absPath = join(testDir, "ai-file.ts");
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      `{"event":"file_change","tool":"Write","file":"${absPath}"}\n`,
    );

    writeFileSync(absPath, "export const x = 1;");
    writeFileSync(join(testDir, "human-file.ts"), "export const y = 2;");
    execSync("git add .", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "mixed commit"`, { cwd: testDir });

    // verify git note exists
    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: testDir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.v, 1, "should have schema version 1");
    assert.equal(entry.interactions.length, 2, "should have 2 interactions");
    assert.ok(entry.attribution.ai_ratio >= 0 && entry.attribution.ai_ratio <= 100, "ratio 0-100");
    assert.equal(entry.session_id, sessionId);
    assert.ok(entry.files.length > 0);
  });

  it("works without active session (plain git commit)", () => {
    // remove session file
    const sessionFile = join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE);
    if (existsSync(sessionFile)) rmSync(sessionFile);

    writeFileSync(join(testDir, "plain.txt"), "no session");
    execSync("git add plain.txt", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "plain commit"`, { cwd: testDir });

    const msg = execSync("git log -1 --format=%B", {
      cwd: testDir,
      encoding: "utf-8",
    });
    assert.ok(!msg.includes(TRAILER_KEY), "should not have trailer without session");
  });

  it("preserves logs after commit for split-commit support", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);

    // prompts.jsonl should NOT be rotated after commit (rotation happens at next prompt).
    // This allows split commits to each read the same session data.
    const promptsFile = join(sessionDir, PROMPTS_FILE);
    assert.ok(existsSync(promptsFile), "prompts.jsonl should be preserved after commit");
  });

  it("extracts responses from transcript when available", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    writeFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    ensureHeartbeat(sessionDir);

    // Create a transcript file under ~/.claude/ (valid path)
    const transcriptDir = join(testHome, ".claude", "projects", "commit-test", "sessions");
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`);
    writeFileSync(
      transcriptPath,
      '{"type":"user","message":{"content":[{"type":"text","text":"implement auth"}]}}\n' +
        '{"type":"assistant","message":{"content":[{"type":"text","text":"I will create the auth module."}]}}\n',
    );

    // Point session to transcript
    writeFileSync(join(sessionDir, TRANSCRIPT_PATH_FILE), transcriptPath);

    // Add prompt
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-06T00:00:00Z","prompt":"implement auth"}\n',
    );

    writeFileSync(join(testDir, "auth.ts"), "export {}");
    execSync("git add auth.ts", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: auth with transcript"`, {
      cwd: testDir,
      env: { ...process.env, HOME: testHome },
    });

    // Verify response is in the note
    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: testDir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);
    assert.equal(entry.interactions[0].prompt, "implement auth");
    assert.equal(entry.interactions[0].response, "I will create the auth module.");

    // Clean up transcript
    rmSync(transcriptPath);
    rmSync(join(transcriptDir), { recursive: true, force: true });
  });

  it("records prompts and changes from rotated (archived) files when commit is in a later turn", () => {
    // Simulate the cross-turn scenario:
    //   turn N  — file edits recorded, then rotated (archived) before the commit
    //   turn N+1 — user sends a message (e.g. "y"), rotation fires → changes.jsonl cleared
    //              commit happens here → recordCommitEntry must read the archived files
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    writeFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    ensureHeartbeat(sessionDir);

    // Simulate already-rotated data (previous turn — archived with an arbitrary prefix).
    // File path must be repo-relative, matching what the hook normalizes to.
    const rotatedChanges = join(sessionDir, "changes-m3h8k2n1.jsonl");
    writeFileSync(
      rotatedChanges,
      '{"event":"file_change","tool":"Write","file":"cross-turn.ts","turn":1}\n',
    );

    const rotatedPrompts = join(sessionDir, "prompts-m3h8k2n1.jsonl");
    writeFileSync(
      rotatedPrompts,
      '{"event":"prompt","timestamp":"2026-04-07T00:00:00Z","prompt":"cross-turn prompt","turn":1}\n',
    );

    // Current turn (e.g. turn 2, "y") — no new changes, prompts.jsonl has only the confirm message.
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-07T00:01:00Z","prompt":"y","turn":2}\n',
    );
    // changes.jsonl does not exist (no edits this turn).

    writeFileSync(join(testDir, "cross-turn.ts"), "export const crossTurn = true;");
    execSync("git add cross-turn.ts", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: cross-turn commit"`, { cwd: testDir });

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: testDir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);

    assert.ok(
      entry.attribution.ai_ratio > 0,
      "ai_ratio should be > 0 — cross-turn.ts was AI-written",
    );
    assert.ok(
      entry.interactions.some((i: { prompt: string }) => i.prompt === "cross-turn prompt"),
      "should include prompt from rotated file",
    );

    // Rotated files are kept after commit so that subsequent split commits in the
    // same turn can also read them. They are purged at the next rotateLogs call
    // (i.e. on the next UserPromptSubmit).
    assert.ok(
      existsSync(rotatedChanges),
      "rotated changes file should still exist for split-commit support",
    );
    assert.ok(
      existsSync(rotatedPrompts),
      "rotated prompts file should still exist for split-commit support",
    );
  });

  it("survives multiple UserPromptSubmit gaps between edit and commit (multi-turn N>1)", () => {
    // The primary bug: AI edits in turn 1, many intermediate UserPromptSubmit events
    // fire without commits, and the commit finally happens at turn 5.
    // With the old purge, the archive from turn 2 would be deleted at turn 3.
    // With the fix, archives persist and are readable at commit time.
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    writeFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    ensureHeartbeat(sessionDir);

    // Turn 1: AI edits multi-gap.ts. Rotated at turn 2.
    const archiveId = Date.now().toString(36);
    writeFileSync(
      join(sessionDir, `changes-${archiveId}.jsonl`),
      `{"event":"file_change","tool":"Write","file":"multi-gap.ts","turn":1}\n`,
    );
    writeFileSync(
      join(sessionDir, `prompts-${archiveId}.jsonl`),
      `{"event":"prompt","timestamp":"2026-04-08T00:00:00Z","prompt":"implement feature","turn":1}\n`,
    );

    // Turns 2-4: UserPromptSubmit fires (rotation happens), no edits, no commits.
    // Under old code, purge would delete the archive at each turn.
    // Under new code, nothing to rotate (no changes.jsonl), archive persists.

    // Turn 5: prompt "y" (confirm), then commit.
    writeFileSync(join(sessionDir, "turn"), "5");
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-08T00:05:00Z","prompt":"y","turn":5}\n',
    );

    writeFileSync(join(testDir, "multi-gap.ts"), "export const multiGap = true;");
    execSync("git add multi-gap.ts", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: multi-turn gap commit"`, { cwd: testDir });

    const note = execSync("git notes --ref=agentnote show HEAD", {
      cwd: testDir,
      encoding: "utf-8",
    });
    const entry = JSON.parse(note);

    assert.ok(entry.attribution.ai_ratio > 0, "ai_ratio should be > 0 for multi-turn gap commit");
    assert.ok(
      entry.interactions.some((i: { prompt: string }) => i.prompt === "implement feature"),
      "should include the original prompt from turn 1",
    );
    assert.ok(
      existsSync(join(sessionDir, `changes-${archiveId}.jsonl`)),
      "archive should persist (not purged by intermediate UserPromptSubmit events)",
    );
  });

  it("does not re-attribute consumed (turn, file) pairs in subsequent commits", () => {
    const sessionId = "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd";
    const sessionDir = join(testDir, ".git", AGENTNOTE_DIR, SESSIONS_DIR, sessionId);
    writeFileSync(join(testDir, ".git", AGENTNOTE_DIR, SESSION_FILE), sessionId);
    ensureHeartbeat(sessionDir);

    // Turn 1: AI edits split-a.ts
    writeFileSync(
      join(sessionDir, PROMPTS_FILE),
      '{"event":"prompt","timestamp":"2026-04-09T00:00:00Z","prompt":"write split-a","turn":1}\n',
    );
    writeFileSync(
      join(sessionDir, CHANGES_FILE),
      '{"event":"file_change","tool":"Write","file":"split-a.ts","turn":1}\n',
    );

    // First commit: only split-a.ts
    writeFileSync(join(testDir, "split-a.ts"), "export const a = 1;");
    execSync("git add split-a.ts", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: split-a"`, { cwd: testDir });

    const note1 = execSync("git notes --ref=agentnote show HEAD", {
      cwd: testDir,
      encoding: "utf-8",
    });
    const entry1 = JSON.parse(note1);
    assert.ok(entry1.attribution.ai_ratio > 0, "first commit should have ai_ratio > 0");

    // Second commit: human file only, but the old turn-1 archive still exists.
    // Without consumed pairs, the old (turn:1, split-a.ts) would leak into relevantTurns.
    writeFileSync(join(testDir, "human-only.ts"), "export const h = 2;");
    execSync("git add human-only.ts", { cwd: testDir });
    execSync(`node ${cliPath} commit -m "feat: human-only"`, { cwd: testDir });

    const note2 = execSync("git notes --ref=agentnote show HEAD", {
      cwd: testDir,
      encoding: "utf-8",
    });
    const entry2 = JSON.parse(note2);
    assert.equal(
      entry2.attribution.ai_ratio,
      0,
      "second commit should have ai_ratio 0 — no AI files (consumed pairs filtered out)",
    );
    assert.equal(
      entry2.files.filter((f: { by_ai: boolean }) => f.by_ai).length,
      0,
      "no files should be attributed to AI in the second commit",
    );
  });

  it("tracks plain git commit with Claude git hooks after hook events", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentnote-claude-git-hooks-"));
    const home = join(dir, ".home");
    mkdirSync(home, { recursive: true });

    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email test@test.com", { cwd: dir });
      execSync("git config user.name Test", { cwd: dir });
      execSync("git commit --allow-empty -m 'init'", { cwd: dir });
      execSync(`node ${cliPath} init --agent claude --no-action`, {
        cwd: dir,
        env: { ...process.env, HOME: home },
        encoding: "utf-8",
      });

      const sessionId = "a1b2c3d4-1111-2222-3333-444444444444";
      execSync(
        `echo '${JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: sessionId,
          model: "claude-opus-4-6",
        })}' | node ${cliPath} hook --agent claude`,
        {
          cwd: dir,
          env: { ...process.env, HOME: home },
          encoding: "utf-8",
        },
      );

      execSync(
        `echo '${JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: sessionId,
          prompt: "Create claude-git-hook.txt",
        })}' | node ${cliPath} hook --agent claude`,
        {
          cwd: dir,
          env: { ...process.env, HOME: home },
          encoding: "utf-8",
        },
      );

      writeFileSync(join(dir, "claude-git-hook.txt"), "Claude git hook\n");
      execSync(
        `echo '${JSON.stringify({
          hook_event_name: "PostToolUse",
          session_id: sessionId,
          tool_name: "Write",
          tool_input: { file_path: join(dir, "claude-git-hook.txt") },
        })}' | node ${cliPath} hook --agent claude`,
        {
          cwd: dir,
          env: { ...process.env, HOME: home },
          encoding: "utf-8",
        },
      );

      execSync("git add claude-git-hook.txt", { cwd: dir });
      execSync(`git commit -m "feat: claude git hook commit"`, {
        cwd: dir,
        env: { ...process.env, HOME: home },
        encoding: "utf-8",
      });

      const note = JSON.parse(
        execSync("git notes --ref=agentnote show HEAD", {
          cwd: dir,
          encoding: "utf-8",
        }),
      );
      assert.equal(note.session_id, sessionId);
      assert.equal(note.agent, "claude");
      assert.equal(note.interactions[0].prompt, "Create claude-git-hook.txt");

      const commitMessage = execSync("git log -1 --format=%B", {
        cwd: dir,
        encoding: "utf-8",
      });
      assert.ok(commitMessage.includes(`${TRAILER_KEY}: ${sessionId}`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
