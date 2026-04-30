import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUBLISH_MODE_INTEGRATED } from "./resolve-pages-target.mjs";

const notesDir = process.env.NOTES_DIR || ".agentnote-dashboard-notes";
const pagesDir = process.env.PAGES_DIR || ".pages";
const pagesMode = process.env.DASHBOARD_PAGES_MODE || "standalone";
const repository = process.env.PUBLIC_REPO || process.env.GITHUB_REPOSITORY || "";
const [repositoryOwner = "", repositoryName = ""] = repository.split("/");

const dashboardDir = process.cwd();
const publicNotesDir = join(dashboardDir, "public", "notes");
const tempDir = mkdtempSync(join(tmpdir(), "agentnote-dashboard-build-"));
const originalNotesDir = join(tempDir, "original-notes");

function copyDirectoryContents(sourceDir, targetDir) {
  for (const entry of readdirSync(sourceDir)) {
    cpSync(join(sourceDir, entry), join(targetDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

if (existsSync(publicNotesDir)) {
  mkdirSync(originalNotesDir, { recursive: true });
  copyDirectoryContents(publicNotesDir, originalNotesDir);
}

const site = `https://${repositoryOwner}.github.io`;
const base =
  repositoryName === `${repositoryOwner}.github.io`
    ? "/dashboard"
    : `/${repositoryName}/dashboard`;

try {
  rmSync(publicNotesDir, { recursive: true, force: true });
  mkdirSync(publicNotesDir, { recursive: true });
  if (existsSync(notesDir)) {
    copyDirectoryContents(notesDir, publicNotesDir);
  }

  execFileSync("npm", ["ci"], {
    cwd: dashboardDir,
    stdio: "inherit",
    env: process.env,
  });
  execFileSync("npm", ["run", "build"], {
    cwd: dashboardDir,
    stdio: "inherit",
    env: {
      ...process.env,
      SITE: site,
      BASE: base,
      PUBLIC_REPO: repository,
    },
  });

  if (pagesMode === PUBLISH_MODE_INTEGRATED) {
    mkdirSync(pagesDir, { recursive: true });
    rmSync(join(pagesDir, "dashboard"), { recursive: true, force: true });
  } else {
    rmSync(pagesDir, { recursive: true, force: true });
  }
  mkdirSync(join(pagesDir, "dashboard"), { recursive: true });
  cpSync(join(dashboardDir, "dist"), join(pagesDir, "dashboard"), { recursive: true });
} finally {
  rmSync(publicNotesDir, { recursive: true, force: true });
  mkdirSync(publicNotesDir, { recursive: true });
  if (existsSync(originalNotesDir)) {
    copyDirectoryContents(originalNotesDir, publicNotesDir);
  }
  rmSync(tempDir, { recursive: true, force: true });
}
