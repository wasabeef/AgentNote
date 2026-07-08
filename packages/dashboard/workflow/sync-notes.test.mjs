import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mergeDashboardNotes, pruneDashboardNotes } from "./persist-notes.mjs";
import { restoreDashboardNotes } from "./restore-notes.mjs";
import {
  MAX_DIFF_TOTAL_LINES,
  parseDiffFiles,
} from "./sync-notes.mjs";

test("parseDiffFiles keeps binary-only files as visible placeholders", () => {
  const files = parseDiffFiles(`diff --git a/assets/logo.png b/assets/logo.png
index 1234567..89abcde 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
diff --git a/assets/icon.png b/assets/icon.png
index 1234567..89abcde 100644
GIT binary patch
literal 0
`);

  assert.equal(files.length, 2);
  assert.equal(files[0].path, "assets/logo.png");
  assert.equal(files[0].binary, true);
  assert.equal(files[0].truncated, true);
  assert.deepEqual(files[0].lines, []);
  assert.equal(files[1].path, "assets/icon.png");
  assert.equal(files[1].binary, true);
  assert.equal(files[1].truncated, true);
  assert.deepEqual(files[1].lines, []);
});

test("parseDiffFiles keeps files that appear after the total diff limit", () => {
  const makeFile = (path, count) => `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -0,0 +1,${count} @@
${Array.from({ length: count }, (_, index) => `+${path} line ${index}`).join("\n")}
`;
  const rawDiff =
    makeFile("src/large-a.ts", 800) +
    makeFile("src/large-b.ts", 800) +
    makeFile("src/large-c.ts", 800) +
    makeFile("src/large-d.ts", 800) +
    `diff --git a/src/after-limit.ts b/src/after-limit.ts
--- a/src/after-limit.ts
+++ b/src/after-limit.ts
@@ -0,0 +1 @@
+after
`;
  assert.ok(
    rawDiff.split("\n").length > MAX_DIFF_TOTAL_LINES,
    "fixture should exceed the total diff limit",
  );

  const files = parseDiffFiles(rawDiff);

  const afterLimit = files.find((file) => file.path === "src/after-limit.ts");
  assert.ok(afterLimit, "file after total diff limit should not be dropped");
  assert.equal(afterLimit.truncated, true);
  assert.deepEqual(afterLimit.lines, []);
});

test("mergeDashboardNotes preserves unrelated PR notes while replacing the current PR", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-persist-test-"));
  const dashboardNotesDir = join(tempDir, "dashboard-notes");
  const snapshotDir = join(tempDir, "snapshot");

  try {
    mkdirSync(dashboardNotesDir, { recursive: true });
    mkdirSync(snapshotDir, { recursive: true });
    writeNote(join(dashboardNotesDir, "old-pr46.json"), 46, "old-pr46");
    writeNote(join(dashboardNotesDir, "old-pr47.json"), 47, "old-pr47");
    writeNote(join(snapshotDir, "new-pr47.json"), 47, "new-pr47");

    mergeDashboardNotes(snapshotDir, dashboardNotesDir, {
      eventName: "pull_request",
      prNumber: 47,
    });

    assert.deepEqual(readdirSync(dashboardNotesDir).sort(), ["new-pr47.json", "old-pr46.json"]);
    assert.equal(readNoteShortSha(join(dashboardNotesDir, "old-pr46.json")), "old-pr46");
    assert.equal(readNoteShortSha(join(dashboardNotesDir, "new-pr47.json")), "new-pr47");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mergeDashboardNotes removes stale notes for the current PR when no replacement exists", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-persist-test-"));
  const dashboardNotesDir = join(tempDir, "dashboard-notes");
  const snapshotDir = join(tempDir, "snapshot");

  try {
    mkdirSync(dashboardNotesDir, { recursive: true });
    mkdirSync(snapshotDir, { recursive: true });
    writeNote(join(dashboardNotesDir, "old-pr46.json"), 46, "old-pr46");
    writeNote(join(dashboardNotesDir, "old-pr47.json"), 47, "old-pr47");

    mergeDashboardNotes(snapshotDir, dashboardNotesDir, {
      eventName: "pull_request",
      prNumber: 47,
    });

    assert.deepEqual(readdirSync(dashboardNotesDir).sort(), ["old-pr46.json"]);
    assert.equal(readNoteShortSha(join(dashboardNotesDir, "old-pr46.json")), "old-pr46");
    assert.equal(existsSync(join(dashboardNotesDir, "old-pr47.json")), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mergeDashboardNotes preserves malformed unrelated notes without crashing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-malformed-test-"));
  const dashboardNotesDir = join(tempDir, "dashboard-notes");
  const snapshotDir = join(tempDir, "snapshot");

  try {
    mkdirSync(dashboardNotesDir, { recursive: true });
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(join(dashboardNotesDir, "malformed.json"), "{not-json");
    writeNote(join(dashboardNotesDir, "old-pr47.json"), 47, "old-pr47");
    writeNote(join(snapshotDir, "new-pr47.json"), 47, "new-pr47");

    mergeDashboardNotes(snapshotDir, dashboardNotesDir, {
      eventName: "pull_request",
      prNumber: 47,
    });

    assert.deepEqual(readdirSync(dashboardNotesDir).sort(), ["malformed.json", "new-pr47.json"]);
    assert.equal(readFileSync(join(dashboardNotesDir, "malformed.json"), "utf-8"), "{not-json");
    assert.equal(readNoteShortSha(join(dashboardNotesDir, "new-pr47.json")), "new-pr47");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pruneDashboardNotes keeps the newest persisted note files", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-prune-test-"));
  const notesDir = join(tempDir, "notes");

  try {
    mkdirSync(notesDir, { recursive: true });
    writeNote(join(notesDir, "old.json"), 41, "old", "2026-01-01T00:00:00Z");
    writeNote(join(notesDir, "middle.json"), 42, "middle", "2026-02-01T00:00:00Z");
    writeNote(join(notesDir, "new.json"), 43, "new", "2026-03-01T00:00:00Z");

    const pruned = pruneDashboardNotes(notesDir, 2);

    assert.equal(pruned, 1);
    assert.deepEqual(readdirSync(notesDir).sort(), ["middle.json", "new.json"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("restoreDashboardNotes replaces local notes with the persisted gh-pages notes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-restore-test-"));
  const persistedNotesDir = join(tempDir, "persisted-notes");
  const localNotesDir = join(tempDir, "local-notes");

  try {
    mkdirSync(persistedNotesDir, { recursive: true });
    mkdirSync(localNotesDir, { recursive: true });
    writeNote(join(persistedNotesDir, "pr47.json"), 47, "pr47");
    writeNote(join(persistedNotesDir, "pr48.json"), 48, "pr48");
    writeNote(join(localNotesDir, "stale-pr46.json"), 46, "stale-pr46");

    const restored = restoreDashboardNotes(persistedNotesDir, localNotesDir);

    assert.equal(restored, 2);
    assert.deepEqual(readdirSync(localNotesDir).sort(), ["pr47.json", "pr48.json"]);
    assert.equal(readNoteShortSha(join(localNotesDir, "pr47.json")), "pr47");
    assert.equal(readNoteShortSha(join(localNotesDir, "pr48.json")), "pr48");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Dashboard note workflows run git in GITHUB_WORKSPACE from an external action path", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-external-action-test-"));
  const workspaceDir = join(tempDir, "workspace");
  const actionDir = join(tempDir, "action-package");
  const binDir = join(tempDir, "bin");
  const remoteDir = join(tempDir, "remote.git");
  const notesDir = join(workspaceDir, ".agentnote-dashboard-notes");
  const fakeGhPath = join(binDir, "gh");
  const persistScript = fileURLToPath(new URL("./persist-notes.mjs", import.meta.url));
  const restoreScript = fileURLToPath(new URL("./restore-notes.mjs", import.meta.url));
  const syncScript = fileURLToPath(new URL("./sync-notes.mjs", import.meta.url));

  try {
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(actionDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(notesDir, { recursive: true });
    writeFileSync(fakeGhPath, "#!/bin/sh\nprintf '[]\\n'\n");
    chmodSync(fakeGhPath, 0o755);
    execFileSync("git", ["init", "--bare", remoteDir]);
    execFileSync("git", ["init"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: workspaceDir });
    execFileSync("git", ["remote", "add", "origin", remoteDir], { cwd: workspaceDir });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: workspaceDir });

    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceDir,
      encoding: "utf-8",
    }).trim();
    const shortSha = sha.slice(0, 7);
    const dashboardNotePath = join(notesDir, `${shortSha}.json`);
    const persistedNotePath = `gh-pages:dashboard/notes/${shortSha}.json`;
    const baseEnv = {
      ...process.env,
      GITHUB_WORKSPACE: workspaceDir,
      NOTES_DIR: notesDir,
      PATH: `${binDir}${delimiter}${process.env.PATH || ""}`,
    };
    const runWorkflow = (script, env = {}) => {
      execFileSync(process.execPath, [script], {
        cwd: actionDir,
        env: { ...baseEnv, ...env },
        stdio: "pipe",
      });
    };
    const writeAgentNote = (model) => {
      const note = JSON.stringify({
        v: 1,
        commit: { sha, short_sha: shortSha },
        attribution: { ai_ratio: 100, method: "file" },
        files: [],
        interactions: [],
        model,
      });
      execFileSync("git", ["notes", "--ref=agentnote", "add", "-f", "-m", note, "HEAD"], {
        cwd: workspaceDir,
        stdio: "pipe",
      });
      execFileSync("git", ["push", "--force", "--no-verify", "origin", "refs/notes/agentnote"], {
        cwd: workspaceDir,
        stdio: "pipe",
      });
    };
    const runSync = () => {
      runWorkflow(syncScript, {
        BEFORE_SHA: "0".repeat(40),
        DEFAULT_BRANCH: "main",
        EVENT_NAME: "push",
        GITHUB_REPOSITORY: "example/repository",
        HEAD_SHA: sha,
        REF_NAME: "main",
      });
    };
    const readPersistedModel = () => {
      const note = execFileSync("git", ["--git-dir", remoteDir, "show", persistedNotePath], {
        encoding: "utf-8",
      });
      return JSON.parse(note).model;
    };

    writeAgentNote("first");
    runSync();
    assert.equal(JSON.parse(readFileSync(dashboardNotePath, "utf-8")).model, "first");
    runWorkflow(persistScript, { EVENT_NAME: "push" });
    assert.equal(readPersistedModel(), "first");

    rmSync(notesDir, { recursive: true, force: true });
    runWorkflow(restoreScript);
    assert.equal(JSON.parse(readFileSync(dashboardNotePath, "utf-8")).model, "first");

    writeAgentNote("updated");
    runSync();
    runWorkflow(persistScript, { EVENT_NAME: "push" });
    assert.equal(readPersistedModel(), "updated");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function writeNote(path, prNumber, shortSha, date = "2026-04-01T00:00:00Z") {
  writeFileSync(
    path,
    JSON.stringify({
      pull_request: { number: prNumber },
      commit: { short_sha: shortSha, date },
    }),
  );
}

function readNoteShortSha(path) {
  return JSON.parse(readFileSync(path, "utf-8")).commit.short_sha;
}
