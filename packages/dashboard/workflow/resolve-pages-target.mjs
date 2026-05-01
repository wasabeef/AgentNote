import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PUBLISH_MODE_BLOCKED = "blocked";
export const PUBLISH_MODE_INTEGRATED = "integrated";
export const PUBLISH_MODE_STANDALONE = "standalone";

const ACTIONS_FALSE = "false";
const ACTIONS_TRUE = "true";
const DEFAULT_DASHBOARD_NOTES_DIR = ".agentnote-dashboard-notes";
const DEFAULT_PAGES_ARTIFACT_PATH = "_site";
const DEFAULT_STANDALONE_PAGES_DIR = ".agentnote-pages";
const ENV_GITHUB_JOB = "GITHUB_JOB";
const ENV_GITHUB_OUTPUT = "GITHUB_OUTPUT";
const ENV_GITHUB_REPOSITORY = "GITHUB_REPOSITORY";
const ENV_GITHUB_WORKFLOW_REF = "GITHUB_WORKFLOW_REF";
const ENV_GITHUB_WORKSPACE = "GITHUB_WORKSPACE";
const GITHUB_WORKFLOWS_DIR = ".github/workflows/";
const REASON_DYNAMIC_PATH = "dynamic-path";
const REASON_OTHER_JOB = "other-job";
const REASON_OTHER_WORKFLOW = "other-workflow";
const REASON_OUTSIDE_WORKSPACE = "outside-workspace";
const TEXT_ENCODING = "utf-8";

const workspace = process.env[ENV_GITHUB_WORKSPACE] || process.cwd();
const repository = process.env[ENV_GITHUB_REPOSITORY] || "";
const workflowRef = process.env[ENV_GITHUB_WORKFLOW_REF] || "";
const githubOutput = process.env[ENV_GITHUB_OUTPUT] || "";
const githubJob = process.env[ENV_GITHUB_JOB] || "";

function setOutput(name, value) {
  if (!githubOutput) return;
  writeFileSync(githubOutput, `${name}=${value}\n`, { flag: "a" });
}

function cleanScalar(value) {
  return value
    .trim()
    .replace(/^['"]/, "")
    .replace(/['"]$/, "");
}

function leadingSpaces(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

export function resolveWorkflowPath({
  repositoryName = repository,
  workflowReference = workflowRef,
  workspaceDir = workspace,
} = {}) {
  if (!repositoryName || !workflowReference) return null;

  const marker = `${repositoryName}/`;
  const refIndex = workflowReference.lastIndexOf("@");
  if (!workflowReference.startsWith(marker) || refIndex === -1 || refIndex <= marker.length) {
    return null;
  }

  const relativePath = workflowReference.slice(marker.length, refIndex);
  if (!relativePath.startsWith(GITHUB_WORKFLOWS_DIR)) return null;
  return join(workspaceDir, relativePath);
}

export function parseUploadPagesArtifactPath(workflowText) {
  const lines = workflowText.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!/\buses:\s*['"]?actions\/upload-pages-artifact@/i.test(line)) continue;

    const stepIndent = leadingSpaces(line);
    let inWith = false;
    let withIndent = Number.POSITIVE_INFINITY;

    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const nextLine = lines[cursor];
      const trimmed = nextLine.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const indent = leadingSpaces(nextLine);
      if (indent <= stepIndent && trimmed.startsWith("- ")) break;

      if (/^with:\s*$/.test(trimmed)) {
        inWith = true;
        withIndent = indent;
        continue;
      }

      if (!inWith) continue;
      if (indent <= withIndent) break;

      const match = trimmed.match(/^path:\s*(.+)$/);
      if (match) return cleanScalar(match[1]);
    }

    return DEFAULT_PAGES_ARTIFACT_PATH;
  }

  return null;
}

export function hasPagesPublishStep(workflowText) {
  return /\buses:\s*['"]?actions\/(?:upload-pages-artifact|deploy-pages)@/i.test(workflowText);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractJobBlock(workflowText, jobId) {
  if (!jobId) return null;

  const lines = workflowText.split(/\r?\n/);
  let jobsIndent = -1;

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = leadingSpaces(lines[index]);
    if (jobsIndent === -1) {
      if (/^jobs:\s*$/.test(trimmed)) jobsIndent = indent;
      continue;
    }

    if (indent <= jobsIndent) break;
    if (indent !== jobsIndent + 2) continue;

    const jobPattern = new RegExp(
      `^['"]?${escapeRegExp(jobId)}['"]?:\\s*(?:#.*)?$`,
    );
    if (!jobPattern.test(trimmed)) continue;

    const start = index;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const nextTrimmed = lines[cursor].trim();
      if (!nextTrimmed || nextTrimmed.startsWith("#")) continue;
      const nextIndent = leadingSpaces(lines[cursor]);
      if (nextIndent <= indent) {
        end = cursor;
        break;
      }
    }

    return lines.slice(start, end).join("\n");
  }

  return null;
}

function isStaticPath(value) {
  return Boolean(value) && !/[`${}*?[\]\n\r]/.test(value);
}

function realpathIfExists(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isInsideWorkspace(path, workspaceDir) {
  const realPath = realpathIfExists(resolve(path));
  const realWorkspaceDir = realpathIfExists(resolve(workspaceDir));
  const relativePath = relative(realWorkspaceDir, realPath);
  return relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function resolvePagesTarget({
  workflowText,
  otherWorkflowTexts = [],
  workspaceDir = workspace,
  jobId = githubJob,
} = {}) {
  const jobBlock = workflowText ? extractJobBlock(workflowText, jobId) : null;
  const artifactPath = jobBlock
    ? parseUploadPagesArtifactPath(jobBlock)
    : workflowText
      ? parseUploadPagesArtifactPath(workflowText)
      : null;
  const hasOtherPagesArtifact =
    Boolean(workflowText) &&
    Boolean(jobBlock) &&
    !artifactPath &&
    Boolean(parseUploadPagesArtifactPath(workflowText));
  const hasOtherPagesWorkflow = otherWorkflowTexts.some(hasPagesPublishStep);
  const notesDir = join(workspaceDir, DEFAULT_DASHBOARD_NOTES_DIR);
  const standalonePagesDir = join(workspaceDir, DEFAULT_STANDALONE_PAGES_DIR);

  if (hasOtherPagesArtifact || (!artifactPath && hasOtherPagesWorkflow)) {
    return {
      notesDir,
      pagesDir: standalonePagesDir,
      publishMode: PUBLISH_MODE_BLOCKED,
      internalUpload: ACTIONS_FALSE,
      canBuild: ACTIONS_FALSE,
      reason: hasOtherPagesArtifact ? REASON_OTHER_JOB : REASON_OTHER_WORKFLOW,
    };
  }

  if (!artifactPath) {
    return {
      notesDir,
      pagesDir: standalonePagesDir,
      publishMode: PUBLISH_MODE_STANDALONE,
      internalUpload: ACTIONS_TRUE,
      canBuild: ACTIONS_TRUE,
      reason: "",
    };
  }

  if (!isStaticPath(artifactPath)) {
    return {
      notesDir,
      pagesDir: standalonePagesDir,
      publishMode: PUBLISH_MODE_BLOCKED,
      internalUpload: ACTIONS_FALSE,
      canBuild: ACTIONS_FALSE,
      reason: REASON_DYNAMIC_PATH,
    };
  }

  const resolvedPagesDir = isAbsolute(artifactPath)
    ? artifactPath
    : resolve(workspaceDir, artifactPath);
  const resolvedWorkspaceDir = resolve(workspaceDir);
  if (!isInsideWorkspace(resolvedPagesDir, resolvedWorkspaceDir)) {
    return {
      notesDir,
      pagesDir: standalonePagesDir,
      publishMode: PUBLISH_MODE_BLOCKED,
      internalUpload: ACTIONS_FALSE,
      canBuild: ACTIONS_FALSE,
      reason: REASON_OUTSIDE_WORKSPACE,
    };
  }

  return {
    notesDir,
    pagesDir: resolvedPagesDir,
    publishMode: PUBLISH_MODE_INTEGRATED,
    internalUpload: ACTIONS_FALSE,
    canBuild: ACTIONS_TRUE,
    reason: "",
  };
}

function readOtherWorkflowTexts(currentWorkflowPath) {
  const workflowsDir = join(workspace, ".github", "workflows");
  if (!existsSync(workflowsDir)) return [];

  return readdirSync(workflowsDir)
    .filter((name) => /\.(ya?ml)$/i.test(name))
    .map((name) => join(workflowsDir, name))
    .filter((path) => path !== currentWorkflowPath)
    .map((path) => {
      try {
        return readFileSync(path, TEXT_ENCODING);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

function main() {
  const workflowPath = resolveWorkflowPath();
  const workflowText = workflowPath && existsSync(workflowPath)
    ? readFileSync(workflowPath, TEXT_ENCODING)
    : "";
  const target = resolvePagesTarget({
    workflowText,
    otherWorkflowTexts: readOtherWorkflowTexts(workflowPath),
    workspaceDir: workspace,
  });

  if (target.publishMode === PUBLISH_MODE_INTEGRATED) {
    console.log(`Detected existing Pages artifact path: ${target.pagesDir}`);
    console.log("Dashboard will be added under the existing artifact's dashboard/ directory.");
  } else if (target.publishMode === PUBLISH_MODE_BLOCKED) {
    console.log(
      "Detected an existing Pages publish path that Agent Note cannot safely merge into from this step. " +
        `Skipping Agent Note's standalone Pages artifact to avoid overwriting an existing site. Reason: ${target.reason || "unknown"}.`,
    );
  } else {
    console.log("No external Pages artifact step detected. Agent Note will publish Dashboard standalone.");
  }

  setOutput("notes_dir", target.notesDir);
  setOutput("pages_dir", target.pagesDir);
  setOutput("publish_mode", target.publishMode);
  setOutput("internal_upload", target.internalUpload);
  setOutput("can_build", target.canBuild);
  setOutput("skip_reason", target.reason);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
