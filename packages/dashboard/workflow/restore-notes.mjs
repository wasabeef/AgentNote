import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DASHBOARD_DIR_NAME = "dashboard";
const DEFAULT_DASHBOARD_NOTES_DIR = ".agentnote-dashboard-notes";
const ENV_NOTES_DIR = "NOTES_DIR";
const FETCH_HEAD_REF = "FETCH_HEAD";
const GITHUB_PAGES_BRANCH = "gh-pages";
const NOTES_DIR_NAME = "notes";
const RESTORE_TEMP_DIR_PREFIX = "agentnote-dashboard-restore-";
const TEXT_ENCODING = "utf-8";
const notesDir = process.env[ENV_NOTES_DIR] || DEFAULT_DASHBOARD_NOTES_DIR;

function copyDirectoryContents(sourceDir, targetDir) {
  let count = 0;
  for (const entry of readdirSync(sourceDir)) {
    cpSync(join(sourceDir, entry), join(targetDir, entry), {
      recursive: true,
      force: true,
    });
    count += 1;
  }
  return count;
}

export function restoreDashboardNotes(sourceNotesDir, targetNotesDir) {
  rmSync(targetNotesDir, { recursive: true, force: true });
  mkdirSync(targetNotesDir, { recursive: true });
  if (!existsSync(sourceNotesDir)) return 0;
  return copyDirectoryContents(sourceNotesDir, targetNotesDir);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    stdio: options.stdio || "pipe",
    encoding: TEXT_ENCODING,
  });
}

export function main() {
  rmSync(notesDir, { recursive: true, force: true });
  mkdirSync(notesDir, { recursive: true });

  try {
    git(["fetch", "origin", GITHUB_PAGES_BRANCH, "--depth=1"]);
  } catch {
    console.log("No gh-pages branch found for Dashboard note restore.");
    return;
  }

  const worktreeDir = mkdtempSync(join(tmpdir(), RESTORE_TEMP_DIR_PREFIX));
  try {
    git(["worktree", "add", "--detach", worktreeDir, FETCH_HEAD_REF]);
    const restored = restoreDashboardNotes(
      join(worktreeDir, DASHBOARD_DIR_NAME, NOTES_DIR_NAME),
      notesDir,
    );
    console.log(`Restored ${restored} Dashboard note file(s).`);
  } finally {
    try {
      git(["worktree", "remove", "--force", worktreeDir]);
    } catch {
      // Cleanup is best-effort because restore failures should keep their original error.
    }
    rmSync(worktreeDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
