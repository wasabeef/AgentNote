import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const notesDir = process.env.NOTES_DIR || ".agentnote-dashboard-notes";

const tempDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-persist-"));
const snapshotDir = join(tempDir, "notes");

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

try {
  execFileSync("git", ["fetch", "origin", "gh-pages", "--depth=1"], {
    stdio: "pipe",
    encoding: "utf-8",
  });
  execFileSync("git", ["checkout", "-B", "gh-pages", "FETCH_HEAD"], {
    stdio: "pipe",
    encoding: "utf-8",
  });
} catch {
  execFileSync("git", ["checkout", "--orphan", "gh-pages"], {
    stdio: "pipe",
    encoding: "utf-8",
  });
  try {
    execFileSync("git", ["rm", "-rf", "."], {
      stdio: "pipe",
      encoding: "utf-8",
    });
  } catch {
    // noop
  }
}

mkdirSync("dashboard/notes", { recursive: true });
rmSync("dashboard/notes", { recursive: true, force: true });
mkdirSync("dashboard/notes", { recursive: true });
if (existsSync(snapshotDir)) {
  copyDirectoryContents(snapshotDir, "dashboard/notes");
}

try {
  execFileSync("git", ["diff", "--quiet", "--", "dashboard/notes"], {
    stdio: "pipe",
    encoding: "utf-8",
  });
  console.log("No Dashboard note changes to persist.");
  process.exit(0);
} catch {
  // diff exists
}

execFileSync("git", ["config", "user.name", "github-actions[bot]"], {
  stdio: "pipe",
  encoding: "utf-8",
});
execFileSync(
  "git",
  ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
  {
    stdio: "pipe",
    encoding: "utf-8",
  },
);
execFileSync("git", ["add", "dashboard/notes"], { stdio: "pipe", encoding: "utf-8" });
execFileSync("git", ["commit", "-m", "chore: update Dashboard notes"], {
  stdio: "pipe",
  encoding: "utf-8",
});
execFileSync("git", ["push", "origin", "gh-pages"], { stdio: "inherit" });
