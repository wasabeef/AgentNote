import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const notesDir = process.env.NOTES_DIR || ".agentnote-dashboard-notes";
const eventName = process.env.EVENT_NAME || "";
const prNumber = Number(process.env.PR_NUMBER || "");

function copyDirectoryContents(sourceDir, targetDir) {
  for (const entry of readdirSync(sourceDir)) {
    cpSync(join(sourceDir, entry), join(targetDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

function readNote(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function notePrNumber(path) {
  const number = readNote(path)?.pull_request?.number;
  return typeof number === "number" ? number : null;
}

function listNoteFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => join(dir, entry));
}

function removeNotesForPr(dir, number) {
  if (!Number.isInteger(number)) return;
  for (const path of listNoteFiles(dir)) {
    if (notePrNumber(path) === number) {
      rmSync(path, { force: true });
    }
  }
}

function prNumbersInSnapshot(snapshotDir) {
  const numbers = new Set();
  for (const path of listNoteFiles(snapshotDir)) {
    const number = notePrNumber(path);
    if (number != null) numbers.add(number);
  }
  return numbers;
}

export function mergeDashboardNotes(snapshotDir, dashboardNotesDir, options = {}) {
  mkdirSync(dashboardNotesDir, { recursive: true });

  if (options.eventName === "pull_request" && Number.isInteger(options.prNumber)) {
    removeNotesForPr(dashboardNotesDir, options.prNumber);
  }
  for (const number of prNumbersInSnapshot(snapshotDir)) {
    removeNotesForPr(dashboardNotesDir, number);
  }

  if (existsSync(snapshotDir)) {
    copyDirectoryContents(snapshotDir, dashboardNotesDir);
  }
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    stdio: options.stdio || "pipe",
    encoding: "utf-8",
  });
}

export function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-persist-"));
  const snapshotDir = join(tempDir, "notes");
  const worktreeDir = join(tempDir, "gh-pages");

  if (existsSync(notesDir)) {
    mkdirSync(snapshotDir, { recursive: true });
    copyDirectoryContents(notesDir, snapshotDir);
  }

  let hasChanges = false;

  try {
    let hasGhPages = true;
    try {
      git(["fetch", "origin", "gh-pages", "--depth=1"]);
    } catch {
      hasGhPages = false;
    }

    if (hasGhPages) {
      git(["worktree", "add", "--detach", worktreeDir, "FETCH_HEAD"]);
      git(["checkout", "-B", "gh-pages"], { cwd: worktreeDir });
    } else {
      git(["worktree", "add", "--detach", worktreeDir, "HEAD"]);
      git(["checkout", "--orphan", "gh-pages"], { cwd: worktreeDir });
      try {
        git(["rm", "-rf", "."], { cwd: worktreeDir });
      } catch {
        // noop
      }
    }

    const dashboardNotesDir = join(worktreeDir, "dashboard", "notes");
    mergeDashboardNotes(snapshotDir, dashboardNotesDir, { eventName, prNumber });

    git(["add", "-A", "dashboard/notes"], { cwd: worktreeDir });
    try {
      git(["diff", "--cached", "--quiet", "--", "dashboard/notes"], { cwd: worktreeDir });
    } catch {
      hasChanges = true;
    }

    if (hasChanges) {
      git(["config", "user.name", "github-actions[bot]"], { cwd: worktreeDir });
      git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], {
        cwd: worktreeDir,
      });
      git(["commit", "-m", "chore: update Dashboard notes"], { cwd: worktreeDir });
      git(["push", "origin", "gh-pages"], { cwd: worktreeDir, stdio: "inherit" });
    } else {
      console.log("No Dashboard note changes to persist.");
    }
  } finally {
    try {
      git(["worktree", "remove", "--force", worktreeDir]);
    } catch {
      // noop
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
