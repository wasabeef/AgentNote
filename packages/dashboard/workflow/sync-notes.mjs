import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const notesDir = process.env.NOTES_DIR || ".agentnote-dashboard-notes";
const eventName = process.env.EVENT_NAME || "";
const before = process.env.BEFORE_SHA || "";
const defaultBranch = process.env.DEFAULT_BRANCH || "";
const head = process.env.HEAD_SHA || "";
const repo = process.env.GITHUB_REPOSITORY || "";
const prNumber = Number(process.env.PR_NUMBER || "");
const prTitle = process.env.PR_TITLE || "";
const prHeadRepo = process.env.PR_HEAD_REPO || "";
const refName = process.env.REF_NAME || "";
const githubOutput = process.env.GITHUB_OUTPUT || "";
const zeroSha = /^0+$/;
const MAX_DIFF_LINES_PER_FILE = 1000;
const MAX_DIFF_TOTAL_LINES = 3000;

mkdirSync(notesDir, { recursive: true });

try {
  execFileSync("git", ["fetch", "origin", "refs/notes/agentnote:refs/notes/agentnote"], {
    stdio: "pipe",
    encoding: "utf-8",
  });
} catch {
  // allow empty note refs
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  }).trim();
}

function readGitNote(sha) {
  let raw = "";
  try {
    raw = run("git", ["notes", "--ref=agentnote", "show", sha]);
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
    path: path || "(unknown)",
    lines: [],
    truncated: false,
  };
}

function normalizeDiffPath(rawPath) {
  if (!rawPath || rawPath === "/dev/null") return "";
  return rawPath.replace(/^[ab]\//, "");
}

function parseDiffFiles(rawDiff) {
  const files = [];
  let current = null;
  let totalLines = 0;

  for (const line of rawDiff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = createDiffFile(match ? match[2] : "");
      files.push(current);
      continue;
    }

    if (!current) continue;
    if (line.startsWith("GIT binary patch") || line.startsWith("Binary files ")) {
      current.truncated = true;
      current.lines = [];
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

  return files.filter((file) => file.lines.length > 0);
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
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(notesDir, name));
}

function readDashboardNote(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
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
  if (before && !zeroSha.test(before)) {
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

backfillDashboardNotes();

if (eventName === "pull_request") {
  if (!Number.isInteger(prNumber) || !prTitle) {
    console.log("Pull request metadata is missing.");
    setFlags({ build: "false", persist: "false", deploy: "false" });
    process.exit(0);
  }

  const isForkPullRequest = prHeadRepo && repo && prHeadRepo !== repo;
  if (isForkPullRequest) {
    console.log(`Skip Dashboard note persistence for fork pull request #${prNumber}.`);
  }

  setFlags({
    build: "true",
    persist: isForkPullRequest ? "false" : "true",
    deploy: isForkPullRequest ? "false" : "true",
  });
  removeNotesForPr(prNumber);

  const pullRequest = {
    number: prNumber,
    title: prTitle,
    state: "open",
  };

  for (const sha of fetchPullRequestCommits(prNumber)) {
    writeDashboardNote(sha, pullRequest);
  }
  process.exit(0);
}

if (defaultBranch && refName && refName !== defaultBranch) {
  console.log(`Skip Dashboard publish on non-default branch ${refName}.`);
  setFlags({ build: "false", persist: "false", deploy: "false" });
  process.exit(0);
}

setFlags({ build: "true", persist: "true", deploy: "true" });
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
          state: pull.merged_at ? "merged" : "open",
        }
      : null;

  if (writeDashboardNote(sha, pullRequest) && pullRequest) {
    mergedPullRequests.set(pullRequest.number, pullRequest);
  }
}

for (const pullRequest of mergedPullRequests.values()) {
  updateNotesForPr(pullRequest.number, { state: pullRequest.state });
}
