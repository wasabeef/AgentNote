import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_DASHBOARD_NOTES_DIR = ".agentnote-dashboard-notes";
const DASHBOARD_DIR_NAME = "dashboard";
const ENV_EVENT_NAME = "EVENT_NAME";
const ENV_NOTES_DIR = "NOTES_DIR";
const ENV_PR_NUMBER = "PR_NUMBER";
const EVENT_PULL_REQUEST = "pull_request";
const FETCH_HEAD_REF = "FETCH_HEAD";
const GITHUB_ACTIONS_BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const GITHUB_ACTIONS_BOT_NAME = "github-actions[bot]";
const GITHUB_PAGES_BRANCH = "gh-pages";
const JSON_EXTENSION = ".json";
const NOTES_DIR_NAME = "notes";
const PERSIST_COMMIT_MESSAGE = "chore: update Dashboard notes";
const PERSIST_TEMP_DIR_PREFIX = "agentnote-dashboard-persist-";
const TEXT_ENCODING = "utf-8";
const notesDir = process.env[ENV_NOTES_DIR] || DEFAULT_DASHBOARD_NOTES_DIR;
const eventName = process.env[ENV_EVENT_NAME] || "";
const prNumber = Number(process.env[ENV_PR_NUMBER] || "");

export const MAX_PERSISTED_DASHBOARD_NOTES = 1000;

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
    return JSON.parse(readFileSync(path, TEXT_ENCODING));
  } catch {
    return null;
  }
}

function notePrNumber(path) {
  const number = readNote(path)?.pull_request?.number;
  return typeof number === "number" ? number : null;
}

function noteSortTime(path) {
  const note = readNote(path);
  const commit = note?.commit && typeof note.commit === "object" ? note.commit : {};
  const rawDate =
    typeof commit.date === "string" && commit.date
      ? commit.date
      : typeof note?.timestamp === "string"
        ? note.timestamp
        : "";
  const parsed = rawDate ? Date.parse(rawDate) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function listNoteFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(JSON_EXTENSION))
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

export function pruneDashboardNotes(
  dashboardNotesDir,
  maxNotes = MAX_PERSISTED_DASHBOARD_NOTES,
) {
  if (!Number.isInteger(maxNotes) || maxNotes <= 0) return 0;
  const noteFiles = listNoteFiles(dashboardNotesDir);
  if (noteFiles.length <= maxNotes) return 0;

  const staleFiles = noteFiles
    .map((path) => ({ path, time: noteSortTime(path) }))
    .sort((left, right) => {
      const dateCompare = right.time - left.time;
      if (dateCompare !== 0) return dateCompare;
      return left.path.localeCompare(right.path);
    })
    .slice(maxNotes);
  for (const { path } of staleFiles) {
    rmSync(path, { force: true });
  }
  return staleFiles.length;
}

export function mergeDashboardNotes(snapshotDir, dashboardNotesDir, options = {}) {
  mkdirSync(dashboardNotesDir, { recursive: true });

  if (options.eventName === EVENT_PULL_REQUEST && Number.isInteger(options.prNumber)) {
    removeNotesForPr(dashboardNotesDir, options.prNumber);
  }
  for (const number of prNumbersInSnapshot(snapshotDir)) {
    removeNotesForPr(dashboardNotesDir, number);
  }

  if (existsSync(snapshotDir)) {
    copyDirectoryContents(snapshotDir, dashboardNotesDir);
  }
  const pruned = pruneDashboardNotes(dashboardNotesDir);
  if (pruned > 0) {
    console.log(`Pruned ${pruned} stale Dashboard note file(s).`);
  }
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    stdio: options.stdio || "pipe",
    encoding: TEXT_ENCODING,
  });
}

export function main() {
  const tempDir = mkdtempSync(join(tmpdir(), PERSIST_TEMP_DIR_PREFIX));
  const snapshotDir = join(tempDir, NOTES_DIR_NAME);
  const worktreeDir = join(tempDir, GITHUB_PAGES_BRANCH);

  if (existsSync(notesDir)) {
    mkdirSync(snapshotDir, { recursive: true });
    copyDirectoryContents(notesDir, snapshotDir);
  }

  let hasChanges = false;

  try {
    let hasGhPages = true;
    try {
      git(["fetch", "origin", GITHUB_PAGES_BRANCH, "--depth=1"]);
    } catch {
      hasGhPages = false;
    }

    if (hasGhPages) {
      git(["worktree", "add", "--detach", worktreeDir, FETCH_HEAD_REF]);
      git(["checkout", "-B", GITHUB_PAGES_BRANCH], { cwd: worktreeDir });
    } else {
      git(["worktree", "add", "--detach", worktreeDir, "HEAD"]);
      git(["checkout", "--orphan", GITHUB_PAGES_BRANCH], { cwd: worktreeDir });
      try {
        git(["rm", "-rf", "."], { cwd: worktreeDir });
      } catch {
        // A new orphan branch can be empty, so there may be nothing to remove.
      }
    }

    const dashboardNotesDir = join(worktreeDir, DASHBOARD_DIR_NAME, NOTES_DIR_NAME);
    mergeDashboardNotes(snapshotDir, dashboardNotesDir, { eventName, prNumber });

    const dashboardNotesPathspec = `${DASHBOARD_DIR_NAME}/${NOTES_DIR_NAME}`;
    git(["add", "-A", dashboardNotesPathspec], { cwd: worktreeDir });
    try {
      git(["diff", "--cached", "--quiet", "--", dashboardNotesPathspec], {
        cwd: worktreeDir,
      });
    } catch {
      hasChanges = true;
    }

    if (hasChanges) {
      git(["config", "user.name", GITHUB_ACTIONS_BOT_NAME], { cwd: worktreeDir });
      git(["config", "user.email", GITHUB_ACTIONS_BOT_EMAIL], {
        cwd: worktreeDir,
      });
      git(["commit", "-m", PERSIST_COMMIT_MESSAGE], { cwd: worktreeDir });
      git(["push", "origin", GITHUB_PAGES_BRANCH], { cwd: worktreeDir, stdio: "inherit" });
    } else {
      console.log("No Dashboard note changes to persist.");
    }
  } finally {
    try {
      git(["worktree", "remove", "--force", worktreeDir]);
    } catch {
      // Cleanup is best-effort because the CI job should report the original failure.
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
