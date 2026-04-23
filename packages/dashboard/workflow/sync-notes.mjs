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

function writeDashboardNote(sha, pullRequest) {
  const note = readGitNote(sha);
  if (!note) return false;

  const commit = note.commit && typeof note.commit === "object" ? note.commit : {};
  const shortSha =
    typeof commit.short_sha === "string" && commit.short_sha
      ? commit.short_sha
      : sha.slice(0, 7);

  note.commit = {
    ...commit,
    sha: typeof commit.sha === "string" && commit.sha ? commit.sha : sha,
    short_sha: shortSha,
  };

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
    deploy: "false",
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
