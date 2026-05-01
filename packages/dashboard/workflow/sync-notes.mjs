import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const AGENTNOTE_GIT_NOTES_REF = "agentnote";
const AGENTNOTE_NOTES_REF = "refs/notes/agentnote";
const ACTIONS_FALSE = "false";
const ACTIONS_TRUE = "true";
const BINARY_FILES_MARKER = "Binary files ";
const DEFAULT_DASHBOARD_NOTES_DIR = ".agentnote-dashboard-notes";
const DIFF_GIT_PREFIX = "diff --git ";
const ENV_BEFORE_SHA = "BEFORE_SHA";
const ENV_DEFAULT_BRANCH = "DEFAULT_BRANCH";
const ENV_EVENT_NAME = "EVENT_NAME";
const ENV_GITHUB_OUTPUT = "GITHUB_OUTPUT";
const ENV_GITHUB_REPOSITORY = "GITHUB_REPOSITORY";
const ENV_HEAD_SHA = "HEAD_SHA";
const ENV_NOTES_DIR = "NOTES_DIR";
const ENV_PR_HEAD_REPO = "PR_HEAD_REPO";
const ENV_PR_NUMBER = "PR_NUMBER";
const ENV_PR_TITLE = "PR_TITLE";
const ENV_REF_NAME = "REF_NAME";
const EVENT_PULL_REQUEST = "pull_request";
const GIT_BINARY_PATCH_MARKER = "GIT binary patch";
const JSON_EXTENSION = ".json";
const PR_STATE_MERGED = "merged";
const PR_STATE_OPEN = "open";
const TEXT_ENCODING = "utf-8";
const UNKNOWN_DIFF_PATH = "(unknown)";
const ZERO_SHA_PATTERN = /^0+$/;
const notesDir = process.env[ENV_NOTES_DIR] || DEFAULT_DASHBOARD_NOTES_DIR;
const eventName = process.env[ENV_EVENT_NAME] || "";
const before = process.env[ENV_BEFORE_SHA] || "";
const defaultBranch = process.env[ENV_DEFAULT_BRANCH] || "";
const head = process.env[ENV_HEAD_SHA] || "";
const repo = process.env[ENV_GITHUB_REPOSITORY] || "";
const prNumber = Number(process.env[ENV_PR_NUMBER] || "");
const prTitle = process.env[ENV_PR_TITLE] || "";
const prHeadRepo = process.env[ENV_PR_HEAD_REPO] || "";
const refName = process.env[ENV_REF_NAME] || "";
const githubOutput = process.env[ENV_GITHUB_OUTPUT] || "";

export const MAX_DIFF_LINES_PER_FILE = 1000;
export const MAX_DIFF_TOTAL_LINES = 3000;

function run(command, args) {
  return execFileSync(command, args, {
    encoding: TEXT_ENCODING,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  }).trim();
}

function readGitNote(sha) {
  let raw = "";
  try {
    raw = run("git", ["notes", `--ref=${AGENTNOTE_GIT_NOTES_REF}`, "show", sha]);
  } catch {
    return null;
  }
  if (!raw) return null;
  return JSON.parse(raw);
}

function readCommitMetadata(sha) {
  if (!sha) return null;

  try {
    const raw = run("git", [
      "show",
      "-s",
      "--format=%H%x00%h%x00%s%x00%aI%x00%an",
      sha,
    ]);
    const [fullSha = "", shortSha = "", message = "", date = "", author = ""] = raw.split("\u0000");
    return {
      sha: fullSha || sha,
      short_sha: shortSha || sha.slice(0, 7),
      message,
      date,
      author,
    };
  } catch {
    return null;
  }
}

function buildDashboardCommit(sha, commit) {
  const fallback = readCommitMetadata(typeof commit?.sha === "string" ? commit.sha : sha);
  const resolvedSha =
    typeof commit?.sha === "string" && commit.sha
      ? commit.sha
      : (fallback?.sha ?? sha);
  const shortSha =
    typeof commit?.short_sha === "string" && commit.short_sha
      ? commit.short_sha
      : (fallback?.short_sha ?? resolvedSha.slice(0, 7));

  return {
    ...commit,
    sha: resolvedSha,
    short_sha: shortSha,
    message:
      typeof commit?.message === "string" && commit.message
        ? commit.message
        : (fallback?.message ?? shortSha),
    date:
      typeof commit?.date === "string" && commit.date
        ? commit.date
        : (fallback?.date ?? ""),
    author:
      typeof commit?.author === "string" && commit.author
        ? commit.author
        : (fallback?.author ?? ""),
  };
}

function createDiffFile(path) {
  return {
    path: path || UNKNOWN_DIFF_PATH,
    lines: [],
    truncated: false,
    binary: false,
  };
}

function normalizeDiffPath(rawPath) {
  if (!rawPath || rawPath === "/dev/null") return "";
  return rawPath.replace(/^[ab]\//, "");
}

export function parseDiffFiles(rawDiff) {
  const files = [];
  let current = null;
  let totalLines = 0;

  for (const line of rawDiff.split("\n")) {
    if (line.startsWith(DIFF_GIT_PREFIX)) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = createDiffFile(match ? match[2] : "");
      files.push(current);
      continue;
    }

    if (!current) continue;
    if (line.startsWith(GIT_BINARY_PATCH_MARKER) || line.startsWith(BINARY_FILES_MARKER)) {
      current.binary = true;
      current.truncated = true;
      current.lines = [];
      continue;
    }
    if (current.binary) {
      continue;
    }

    if (line.startsWith("+++ ")) {
      const path = normalizeDiffPath(line.slice(4).trim());
      if (path) current.path = path;
    }

    if (current.lines.length >= MAX_DIFF_LINES_PER_FILE || totalLines >= MAX_DIFF_TOTAL_LINES) {
      current.truncated = true;
      continue;
    }
    current.lines.push(line);
    totalLines += 1;
  }

  return files.filter((file) => file.lines.length > 0 || file.truncated || file.binary);
}

function readCommitDiff(sha) {
  if (!sha) return null;
  try {
    const rawDiff = run("git", [
      "show",
      "--format=",
      "--patch",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      sha,
    ]);
    const files = parseDiffFiles(rawDiff);
    return files.length > 0 ? { files } : null;
  } catch {
    return null;
  }
}

function needsDiff(note) {
  return !Array.isArray(note?.diff?.files) || note.diff.files.length === 0;
}

function writeDashboardNote(sha, pullRequest) {
  const note = readGitNote(sha);
  if (!note) return false;

  const commit = note.commit && typeof note.commit === "object" ? note.commit : {};
  const dashboardCommit = buildDashboardCommit(sha, commit);
  const shortSha = dashboardCommit.short_sha;

  note.commit = dashboardCommit;
  if (needsDiff(note)) {
    const diff = readCommitDiff(dashboardCommit.sha);
    if (diff) note.diff = diff;
  }

  if (pullRequest) {
    note.pull_request = pullRequest;
  } else {
    delete note.pull_request;
  }

  writeFileSync(join(notesDir, `${shortSha}.json`), `${JSON.stringify(note, null, 2)}\n`);
  return true;
}

function listNoteFiles() {
  return readdirSync(notesDir)
    .filter((name) => name.endsWith(JSON_EXTENSION))
    .map((name) => join(notesDir, name));
}

function readDashboardNote(path) {
  try {
    return JSON.parse(readFileSync(path, TEXT_ENCODING));
  } catch {
    return null;
  }
}

function backfillDashboardNotes() {
  for (const path of listNoteFiles()) {
    const note = readDashboardNote(path);
    if (!note || typeof note !== "object") continue;

    const commit = note.commit && typeof note.commit === "object" ? note.commit : null;
    const sha = typeof commit?.sha === "string" ? commit.sha : "";
    if (!sha) continue;

    const nextCommit = buildDashboardCommit(sha, commit);
    const nextDiff = needsDiff(note) ? readCommitDiff(nextCommit.sha) : null;
    const changed =
      nextCommit.sha !== commit.sha ||
      nextCommit.short_sha !== commit.short_sha ||
      nextCommit.message !== commit.message ||
      nextCommit.date !== commit.date ||
      nextCommit.author !== commit.author ||
      nextDiff !== null;
    if (!changed) continue;

    note.commit = nextCommit;
    if (nextDiff) note.diff = nextDiff;
    writeFileSync(path, `${JSON.stringify(note, null, 2)}\n`);
  }
}

function removeNotesForPr(currentPrNumber) {
  for (const path of listNoteFiles()) {
    const note = readDashboardNote(path);
    if (note?.pull_request?.number === currentPrNumber) {
      rmSync(path, { force: true });
    }
  }
}

function updateNotesForPr(currentPrNumber, patch) {
  for (const path of listNoteFiles()) {
    const note = readDashboardNote(path);
    if (note?.pull_request?.number !== currentPrNumber) continue;
    note.pull_request = {
      ...note.pull_request,
      ...patch,
    };
    writeFileSync(path, `${JSON.stringify(note, null, 2)}\n`);
  }
}

function fetchPullRequestCommits(currentPrNumber) {
  try {
    const raw = run("gh", [
      "api",
      `repos/${repo}/pulls/${currentPrNumber}/commits`,
      "--paginate",
      "--slurp",
    ]);
    const pages = JSON.parse(raw);
    const commits = Array.isArray(pages) ? pages.flat() : [];
    return commits
      .map((commit) => (typeof commit?.sha === "string" ? commit.sha : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function fetchCommitPulls(sha) {
  try {
    const raw = run("gh", [
      "api",
      `repos/${repo}/commits/${sha}/pulls`,
      "--header",
      "Accept: application/vnd.github+json",
    ]);
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function buildCommitRange() {
  if (before && !ZERO_SHA_PATTERN.test(before)) {
    return run("git", ["rev-list", "--reverse", `${before}..${head}`])
      .split(/\s+/)
      .filter(Boolean);
  }
  return head ? [head] : [];
}

function setOutput(name, value) {
  if (!githubOutput) return;
  writeFileSync(githubOutput, `${name}=${value}\n`, { flag: "a" });
}

function setFlags({ build, persist, deploy }) {
  setOutput("should_build", build);
  setOutput("should_persist", persist);
  setOutput("should_deploy", deploy);
}

function main() {
  mkdirSync(notesDir, { recursive: true });

  try {
    execFileSync("git", ["fetch", "origin", `${AGENTNOTE_NOTES_REF}:${AGENTNOTE_NOTES_REF}`], {
      stdio: "pipe",
      encoding: TEXT_ENCODING,
    });
  } catch {
    // A repository may not have Agent Note git notes before the first recorded commit.
  }

  backfillDashboardNotes();

  if (eventName === EVENT_PULL_REQUEST) {
    if (!Number.isInteger(prNumber) || !prTitle) {
      console.log("Pull request metadata is missing.");
      setFlags({ build: ACTIONS_FALSE, persist: ACTIONS_FALSE, deploy: ACTIONS_FALSE });
      return;
    }

    const isForkPullRequest = prHeadRepo && repo && prHeadRepo !== repo;
    if (isForkPullRequest) {
      console.log(`Skip Dashboard note persistence for fork pull request #${prNumber}.`);
    }

    setFlags({
      build: ACTIONS_TRUE,
      persist: isForkPullRequest ? ACTIONS_FALSE : ACTIONS_TRUE,
      deploy: isForkPullRequest ? ACTIONS_FALSE : ACTIONS_TRUE,
    });
    removeNotesForPr(prNumber);

    const pullRequest = {
      number: prNumber,
      title: prTitle,
      state: PR_STATE_OPEN,
    };

    for (const sha of fetchPullRequestCommits(prNumber)) {
      writeDashboardNote(sha, pullRequest);
    }
    return;
  }

  if (defaultBranch && refName && refName !== defaultBranch) {
    console.log(`Skip Dashboard publish on non-default branch ${refName}.`);
    setFlags({ build: ACTIONS_FALSE, persist: ACTIONS_FALSE, deploy: ACTIONS_FALSE });
    return;
  }

  setFlags({ build: ACTIONS_TRUE, persist: ACTIONS_TRUE, deploy: ACTIONS_TRUE });
  const mergedPullRequests = new Map();
  for (const sha of buildCommitRange()) {
    const pulls = fetchCommitPulls(sha);
    const merged = pulls
      .filter((pull) => pull && pull.merged_at)
      .sort((left, right) =>
        String(right.merged_at || "").localeCompare(String(left.merged_at || "")),
      );
    const pull = merged[0] || pulls[0] || null;
    const pullRequest =
      pull && typeof pull.number === "number" && typeof pull.title === "string"
        ? {
            number: pull.number,
            title: pull.title,
            state: pull.merged_at ? PR_STATE_MERGED : PR_STATE_OPEN,
          }
        : null;

    if (writeDashboardNote(sha, pullRequest) && pullRequest) {
      mergedPullRequests.set(pullRequest.number, pullRequest);
    }
  }

  for (const pullRequest of mergedPullRequests.values()) {
    updateNotesForPr(pullRequest.number, { state: pullRequest.state });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
