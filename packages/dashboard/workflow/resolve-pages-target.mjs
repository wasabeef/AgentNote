import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const repository = process.env.GITHUB_REPOSITORY || "";
const workflowRef = process.env.GITHUB_WORKFLOW_REF || "";
const githubOutput = process.env.GITHUB_OUTPUT || "";
const githubJob = process.env.GITHUB_JOB || "";

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

function resolveWorkflowPath() {
  if (!repository || !workflowRef) return null;

  const marker = `${repository}/`;
  const markerIndex = workflowRef.indexOf(marker);
  const refIndex = workflowRef.lastIndexOf("@");
  if (markerIndex === -1 || refIndex === -1 || refIndex <= markerIndex + marker.length) {
    return null;
  }

  const relativePath = workflowRef.slice(markerIndex + marker.length, refIndex);
  if (!relativePath.startsWith(".github/workflows/")) return null;
  return join(workspace, relativePath);
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

    return "_site";
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
  const notesDir = join(workspaceDir, ".agentnote-dashboard-notes");
  const standalonePagesDir = join(workspaceDir, ".agentnote-pages");

  if (hasOtherPagesArtifact || (!artifactPath && hasOtherPagesWorkflow)) {
    return {
      notesDir,
      pagesDir: standalonePagesDir,
      publishMode: "blocked",
      internalUpload: "false",
      canBuild: "false",
      reason: hasOtherPagesArtifact ? "other-job" : "other-workflow",
    };
  }

  if (!artifactPath) {
    return {
      notesDir,
      pagesDir: standalonePagesDir,
      publishMode: "standalone",
      internalUpload: "true",
      canBuild: "true",
      reason: "",
    };
  }

  if (!isStaticPath(artifactPath)) {
    return {
      notesDir,
      pagesDir: standalonePagesDir,
      publishMode: "blocked",
      internalUpload: "false",
      canBuild: "false",
      reason: "dynamic-path",
    };
  }

  return {
    notesDir,
    pagesDir: isAbsolute(artifactPath)
      ? artifactPath
      : resolve(workspaceDir, artifactPath),
    publishMode: "integrated",
    internalUpload: "false",
    canBuild: "true",
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
        return readFileSync(path, "utf-8");
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

function main() {
  const workflowPath = resolveWorkflowPath();
  const workflowText = workflowPath && existsSync(workflowPath)
    ? readFileSync(workflowPath, "utf-8")
    : "";
  const target = resolvePagesTarget({
    workflowText,
    otherWorkflowTexts: readOtherWorkflowTexts(workflowPath),
    workspaceDir: workspace,
  });

  if (target.publishMode === "integrated") {
    console.log(`Detected existing Pages artifact path: ${target.pagesDir}`);
    console.log("Dashboard will be added under the existing artifact's dashboard/ directory.");
  } else if (target.publishMode === "blocked") {
    console.log(
      "Detected an existing Pages publish path that Agent Note cannot safely merge into from this step. " +
        "Skipping Agent Note's standalone Pages artifact to avoid overwriting an existing site.",
    );
  } else {
    console.log("No external Pages artifact step detected. Agent Note will publish Dashboard standalone.");
  }

  setOutput("notes_dir", target.notesDir);
  setOutput("pages_dir", target.pagesDir);
  setOutput("publish_mode", target.publishMode);
  setOutput("internal_upload", target.internalUpload);
  setOutput("can_build", target.canBuild);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
