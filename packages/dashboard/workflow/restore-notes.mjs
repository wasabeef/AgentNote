import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const notesDir = process.env.NOTES_DIR || ".agentnote-dashboard-notes";

function copyDirectoryContents(sourceDir, targetDir) {
  for (const entry of readdirSync(sourceDir)) {
    cpSync(join(sourceDir, entry), join(targetDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

rmSync(notesDir, { recursive: true, force: true });
mkdirSync(notesDir, { recursive: true });

try {
  execFileSync("git", ["fetch", "origin", "gh-pages", "--depth=1"], {
    stdio: "pipe",
    encoding: "utf-8",
  });
} catch {
  process.exit(0);
}

const extractDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-restore-"));
let archiveExtracted = false;
try {
  execFileSync(
    "/bin/sh",
    [
      "-lc",
      `git archive --format=tar FETCH_HEAD dashboard/notes 2>/dev/null | tar -xf - -C "${extractDir}"`,
    ],
    {
      stdio: "pipe",
      encoding: "utf-8",
    },
  );
  archiveExtracted = true;
} catch {
  // No Dashboard notes have been published yet.
}

try {
  if (archiveExtracted) {
    const archivedNotesDir = join(extractDir, "dashboard", "notes");
    if (existsSync(archivedNotesDir)) {
      copyDirectoryContents(archivedNotesDir, notesDir);
    }
  }
} finally {
  rmSync(extractDir, { recursive: true, force: true });
}
