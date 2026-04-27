import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const notesDir = process.env.NOTES_DIR || ".agentnote-dashboard-notes";

const tempDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-persist-"));
const snapshotDir = join(tempDir, "notes");
const worktreeDir = join(tempDir, "gh-pages");

function copyDirectoryContents(sourceDir, targetDir) {
  for (const entry of readdirSync(sourceDir)) {
    cpSync(join(sourceDir, entry), join(targetDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

if (existsSync(notesDir)) {
  mkdirSync(snapshotDir, { recursive: true });
  copyDirectoryContents(notesDir, snapshotDir);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    stdio: options.stdio || "pipe",
    encoding: "utf-8",
  });
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
  mkdirSync(dashboardNotesDir, { recursive: true });
  rmSync(dashboardNotesDir, { recursive: true, force: true });
  mkdirSync(dashboardNotesDir, { recursive: true });
  if (existsSync(snapshotDir)) {
    copyDirectoryContents(snapshotDir, dashboardNotesDir);
  }

  git(["add", "dashboard/notes"], { cwd: worktreeDir });
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
