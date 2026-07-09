import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PUBLISH_MODE_BLOCKED = "blocked";
export const PUBLISH_MODE_INTEGRATED = "integrated";
export const PUBLISH_MODE_STANDALONE = "standalone";

const ACTIONS_FALSE = "false";
const ACTIONS_TRUE = "true";
const DASHBOARD_SUBDIRECTORY = "dashboard";
const DEFAULT_DASHBOARD_NOTES_DIR = ".agentnote-dashboard-notes";
const DEFAULT_GITHUB_API_URL = "https://api.github.com";
const DEFAULT_PAGES_ARTIFACT_PATH = "_site";
const DEFAULT_STANDALONE_PAGES_DIR = ".agentnote-pages";
const ENV_GH_TOKEN = "GH_TOKEN";
const ENV_GITHUB_API_URL = "GITHUB_API_URL";
const ENV_GITHUB_JOB = "GITHUB_JOB";
const ENV_GITHUB_OUTPUT = "GITHUB_OUTPUT";
const ENV_GITHUB_REPOSITORY = "GITHUB_REPOSITORY";
const ENV_GITHUB_WORKFLOW_REF = "GITHUB_WORKFLOW_REF";
const ENV_GITHUB_WORKSPACE = "GITHUB_WORKSPACE";
const ENV_PAGES_BASE_URL = "PAGES_BASE_URL";
const GITHUB_PAGES_HOST_SUFFIX = ".github.io";
const GITHUB_WORKFLOWS_DIR = ".github/workflows/";
const PAGES_API_TIMEOUT_MS = 10_000;
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

function parseUrlOrNull(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Resolve the real GitHub Pages base URL for the current repository.
 *
 * Private and Enterprise Pages sites are served from obfuscated domains at the
 * root path, so the URL cannot be derived from the repository name alone. The
 * explicit override wins, then the Pages API, and callers fall back to the
 * repository-name heuristic when neither is available.
 */
export async function resolvePagesBaseUrl({
  override = process.env[ENV_PAGES_BASE_URL] || "",
  repository = process.env[ENV_GITHUB_REPOSITORY] || "",
  token = process.env[ENV_GH_TOKEN] || "",
  apiUrl = process.env[ENV_GITHUB_API_URL] || DEFAULT_GITHUB_API_URL,
  fetcher = fetch,
} = {}) {
  // Re-serializing through URL both validates the value and strips characters
  // that would corrupt the GITHUB_OUTPUT file, such as newlines.
  const parsedOverride = override ? parseUrlOrNull(override) : null;
  if (parsedOverride) return parsedOverride.toString();
  if (override) console.log(`Ignoring invalid pages_base_url override: ${override}`);

  if (!repository || !token) return null;

  try {
    const response = await fetcher(`${apiUrl}/repos/${repository}/pages`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(PAGES_API_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const pages = await response.json();
    const htmlUrl = typeof pages?.html_url === "string" ? pages.html_url : "";
    return htmlUrl ? (parseUrlOrNull(htmlUrl)?.toString() ?? null) : null;
  } catch {
    // Pages metadata is an enhancement; resolution failures fall back to the heuristic.
    return null;
  }
}

/**
 * Derive the Astro site origin and dashboard base path.
 *
 * A resolved Pages URL takes precedence; otherwise the canonical
 * `https://<owner>.github.io/<repo>/` layout is assumed.
 */
export function derivePagesPaths({ pagesBaseUrl = "", repository = "" } = {}) {
  const parsed = pagesBaseUrl ? parseUrlOrNull(pagesBaseUrl) : null;
  if (parsed) {
    const basePath = parsed.pathname.replace(/\/+$/, "");
    return { site: parsed.origin, base: `${basePath}/${DASHBOARD_SUBDIRECTORY}` };
  }

  const [owner = "", name = ""] = repository.split("/");
  return {
    site: `https://${owner}${GITHUB_PAGES_HOST_SUFFIX}`,
    base:
      name === `${owner}${GITHUB_PAGES_HOST_SUFFIX}`
        ? `/${DASHBOARD_SUBDIRECTORY}`
        : `/${name}/${DASHBOARD_SUBDIRECTORY}`,
  };
}

/**
 * Resolve the caller workflow path from GitHub Actions metadata.
 *
 * The action only trusts workflow files that belong to the current repository
 * and live under `.github/workflows/`.
 */
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

/**
 * Parse the path configured for actions/upload-pages-artifact.
 *
 * This lightweight parser is intentionally limited to the workflow shapes the
 * action needs; it avoids pulling a YAML dependency into the dashboard package.
 */
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

/**
 * Detect whether a workflow already owns GitHub Pages publishing.
 */
export function hasPagesPublishStep(workflowText) {
  return /\buses:\s*['"]?actions\/(?:upload-pages-artifact|deploy-pages)@/i.test(workflowText);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract one job block from a GitHub Actions workflow.
 *
 * When the calling job already uploads Pages, the dashboard can merge into that
 * artifact; when another job owns Pages, the dashboard must avoid overwriting it.
 */
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

/**
 * Guard artifact merging to paths known before the workflow runs.
 */
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

/**
 * Check that a resolved artifact path stays inside the GitHub workspace.
 */
function isInsideWorkspace(path, workspaceDir) {
  const realPath = realpathIfExists(resolve(path));
  const realWorkspaceDir = realpathIfExists(resolve(workspaceDir));
  const relativePath = relative(realWorkspaceDir, realPath);
  return relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

/**
 * Decide how Dashboard should publish alongside the caller's Pages workflow.
 *
 * The result intentionally favors safe no-op states over guessing when another
 * job, another workflow, or a dynamic artifact path owns Pages.
 */
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

async function main() {
  const workflowPath = resolveWorkflowPath();
  const workflowText = workflowPath && existsSync(workflowPath)
    ? readFileSync(workflowPath, TEXT_ENCODING)
    : "";
  const target = resolvePagesTarget({
    workflowText,
    otherWorkflowTexts: readOtherWorkflowTexts(workflowPath),
    workspaceDir: workspace,
  });
  const pagesBaseUrl = await resolvePagesBaseUrl();
  if (pagesBaseUrl) {
    console.log(`Resolved GitHub Pages base URL: ${pagesBaseUrl}`);
  } else {
    console.log(
      "GitHub Pages base URL is not resolvable; falling back to the repository-name layout.",
    );
  }

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
  setOutput("pages_base_url", pagesBaseUrl ?? "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
