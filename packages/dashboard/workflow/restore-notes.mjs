import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const notesDir = process.env.NOTES_DIR || ".agentnote-dashboard-notes";

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
    encoding: "utf-8",
  });
}

export function main() {
  rmSync(notesDir, { recursive: true, force: true });
  mkdirSync(notesDir, { recursive: true });

  try {
    git(["fetch", "origin", "gh-pages", "--depth=1"]);
  } catch {
    console.log("No gh-pages branch found for Dashboard note restore.");
    return;
  }

  const worktreeDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-restore-"));
  try {
    git(["worktree", "add", "--detach", worktreeDir, "FETCH_HEAD"]);
    const restored = restoreDashboardNotes(join(worktreeDir, "dashboard", "notes"), notesDir);
    console.log(`Restored ${restored} Dashboard note file(s).`);
  } finally {
    try {
      git(["worktree", "remove", "--force", worktreeDir]);
    } catch {
      // noop
    }
    rmSync(worktreeDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
