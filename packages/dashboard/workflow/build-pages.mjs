import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUBLISH_MODE_INTEGRATED } from "./resolve-pages-target.mjs";

const DASHBOARD_SUBDIRECTORY = "dashboard";
const DEFAULT_DASHBOARD_NOTES_DIR = ".agentnote-dashboard-notes";
const DEFAULT_PAGES_DIR = ".pages";
const DEFAULT_PAGES_MODE = "standalone";
const DIST_DIR_NAME = "dist";
const ENV_DASHBOARD_PAGES_MODE = "DASHBOARD_PAGES_MODE";
const ENV_GITHUB_REPOSITORY = "GITHUB_REPOSITORY";
const ENV_NOTES_DIR = "NOTES_DIR";
const ENV_PAGES_DIR = "PAGES_DIR";
const ENV_PUBLIC_REPO = "PUBLIC_REPO";
const GITHUB_PAGES_HOST_SUFFIX = ".github.io";
const NOTES_DIR_NAME = "notes";
const ORIGINAL_NOTES_DIR_NAME = "original-notes";
const PUBLIC_DIR_NAME = "public";
const TEMP_DIR_PREFIX = "agentnote-dashboard-build-";
const notesDir = process.env[ENV_NOTES_DIR] || DEFAULT_DASHBOARD_NOTES_DIR;
const pagesDir = process.env[ENV_PAGES_DIR] || DEFAULT_PAGES_DIR;
const pagesMode = process.env[ENV_DASHBOARD_PAGES_MODE] || DEFAULT_PAGES_MODE;
const repository = process.env[ENV_PUBLIC_REPO] || process.env[ENV_GITHUB_REPOSITORY] || "";
const [repositoryOwner = "", repositoryName = ""] = repository.split("/");

const dashboardDir = process.cwd();
const publicNotesDir = join(dashboardDir, PUBLIC_DIR_NAME, NOTES_DIR_NAME);
const tempDir = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
const originalNotesDir = join(tempDir, ORIGINAL_NOTES_DIR_NAME);

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
  repositoryName === `${repositoryOwner}${GITHUB_PAGES_HOST_SUFFIX}`
    ? `/${DASHBOARD_SUBDIRECTORY}`
    : `/${repositoryName}/${DASHBOARD_SUBDIRECTORY}`;

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
    rmSync(join(pagesDir, DASHBOARD_SUBDIRECTORY), { recursive: true, force: true });
  } else {
    rmSync(pagesDir, { recursive: true, force: true });
  }
  mkdirSync(join(pagesDir, DASHBOARD_SUBDIRECTORY), { recursive: true });
  cpSync(join(dashboardDir, DIST_DIR_NAME), join(pagesDir, DASHBOARD_SUBDIRECTORY), {
    recursive: true,
  });
} finally {
  rmSync(publicNotesDir, { recursive: true, force: true });
  mkdirSync(publicNotesDir, { recursive: true });
  if (existsSync(originalNotesDir)) {
    copyDirectoryContents(originalNotesDir, publicNotesDir);
  }
  rmSync(tempDir, { recursive: true, force: true });
}
