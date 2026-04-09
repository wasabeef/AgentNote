import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TRUNCATE_PROMPT, TRUNCATE_RESPONSE_PR } from "../core/constants.js";
import type { Attribution } from "../core/entry.js";
import { readNote } from "../core/storage.js";
import { git, gitSafe } from "../git.js";
import { normalizeEntry } from "./normalize.js";

const execFileAsync = promisify(execFile);

const MARKER_BEGIN = "<!-- agentnote-begin -->";
const MARKER_END = "<!-- agentnote-end -->";

// ─── Data types (exported for action/external use) ──

interface Interaction {
  prompt: string;
  response: string | null;
}

interface CommitEntry {
  sha: string;
  short: string;
  message: string;
  session_id: string | null;
  model: string | null;
  ai_ratio: number | null;
  attribution_method: string | null;
  prompts_count: number;
  files_total: number;
  files_ai: number;
  files: Array<{ path: string; by_ai: boolean }>;
  interactions: Interaction[];
  attribution: Attribution | null;
}

interface PrReport {
  base: string;
  head: string;
  repo_url: string | null;
  total_commits: number;
  tracked_commits: number;
  total_prompts: number;
  total_files: number;
  total_files_ai: number;
  overall_ai_ratio: number;
  overall_method: "line" | "file" | "mixed" | "none";
  model: string | null;
  commits: CommitEntry[];
}

// ─── Data collection ────────────────────────────────

async function collectReport(base: string): Promise<PrReport | null> {
  const head = await git(["rev-parse", "--short", "HEAD"]);
  const raw = await git(["log", "--reverse", "--format=%H\t%h\t%s", `${base}..HEAD`]);

  if (!raw.trim()) return null;

  const commits: CommitEntry[] = [];

  for (const line of raw.trim().split("\n")) {
    const [sha, short, ...msgParts] = line.split("\t");
    const message = msgParts.join("\t");
    const note = await readNote(sha);

    if (!note) {
      commits.push({
        sha,
        short,
        message,
        session_id: null,
        model: null,
        ai_ratio: null,
        attribution_method: null,
        prompts_count: 0,
        files_total: 0,
        files_ai: 0,
        files: [],
        interactions: [],
        attribution: null,
      });
      continue;
    }

    const entry = normalizeEntry(note);
    const aiCount = entry.files.filter((f) => f.by_ai).length;

    commits.push({
      sha,
      short,
      message,
      session_id: entry.session_id ?? null,
      model: entry.model ?? null,
      ai_ratio: entry.attribution.ai_ratio,
      attribution_method: entry.attribution.method,
      prompts_count: entry.interactions.length,
      files_total: entry.files.length,
      files_ai: aiCount,
      files: entry.files,
      interactions: entry.interactions,
      attribution: entry.attribution,
    });
  }

  const tracked = commits.filter((c) => c.session_id !== null);
  const totalFiles = tracked.reduce((s, c) => s + c.files_total, 0);
  const totalFilesAi = tracked.reduce((s, c) => s + c.files_ai, 0);

  // Rollup: partition by attribution method.
  const lineEligible = tracked.filter(
    (c) =>
      c.attribution?.method === "line" &&
      c.attribution.lines &&
      c.attribution.lines.total_added > 0,
  );
  const fileOnly = tracked.filter((c) => c.attribution?.method === "file");
  const excluded = tracked.filter((c) => c.attribution?.method === "none");
  const eligible = [...lineEligible, ...fileOnly];

  let overallMethod: "line" | "file" | "mixed" | "none";
  if (tracked.length > 0 && excluded.length === tracked.length) {
    overallMethod = "none";
  } else if (eligible.length === 0) {
    overallMethod = "none";
  } else if (fileOnly.length === 0 && lineEligible.length > 0) {
    overallMethod = "line";
  } else if (lineEligible.length === 0) {
    overallMethod = "file";
  } else {
    overallMethod = "mixed";
  }

  let overallAiRatio: number;
  if (overallMethod === "line") {
    const aiAdded = lineEligible.reduce((s, c) => s + (c.attribution?.lines?.ai_added ?? 0), 0);
    const totalAdded = lineEligible.reduce(
      (s, c) => s + (c.attribution?.lines?.total_added ?? 0),
      0,
    );
    overallAiRatio = totalAdded > 0 ? Math.round((aiAdded / totalAdded) * 100) : 0;
  } else if (overallMethod === "file") {
    // Use eligible commits only (excludes method:"none" deletion-only commits).
    const eligibleFiles = eligible.reduce((s, c) => s + c.files_total, 0);
    const eligibleFilesAi = eligible.reduce((s, c) => s + c.files_ai, 0);
    overallAiRatio = eligibleFiles > 0 ? Math.round((eligibleFilesAi / eligibleFiles) * 100) : 0;
  } else if (overallMethod === "mixed") {
    // Weighted average by files.length from eligible commits only.
    const weightedSum = eligible.reduce((s, c) => s + (c.ai_ratio ?? 0) * c.files_total, 0);
    const weightTotal = eligible.reduce((s, c) => s + c.files_total, 0);
    overallAiRatio = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  } else {
    overallAiRatio = 0;
  }

  // Extract model from tracked commits (use first non-null).
  const model = tracked.find((c) => c.model)?.model ?? null;

  // Derive repo URL for commit links.
  let repoUrl: string | null = null;
  try {
    const remoteUrl = await git(["remote", "get-url", "origin"]);
    // Convert git@github.com:owner/repo.git or https://github.com/owner/repo.git → https://github.com/owner/repo
    repoUrl = remoteUrl
      .replace(/\.git$/, "")
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
  } catch {
    // no remote
  }

  return {
    base,
    head,
    repo_url: repoUrl,
    total_commits: commits.length,
    tracked_commits: tracked.length,
    total_prompts: tracked.reduce((s, c) => s + c.prompts_count, 0),
    total_files: totalFiles,
    total_files_ai: totalFilesAi,
    overall_ai_ratio: overallAiRatio,
    overall_method: overallMethod,
    model,
    commits,
  };
}

// ─── Shared rendering helpers ──────────────────────

/** Render progress bar for AI ratio. */
function renderProgressBar(ratio: number, width = 16): string {
  const filled = Math.round((ratio / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Build the header (2 lines: ratio + bar, then metadata). */
function renderHeader(report: PrReport): string[] {
  // Line 1: ratio + progress bar
  const line1 = `**AI ratio: ${report.overall_ai_ratio}%** ${renderProgressBar(report.overall_ai_ratio)}`;

  // Line 2: metadata
  const meta: string[] = [];

  const lineCommits = report.commits.filter(
    (c) => c.attribution?.method === "line" && c.attribution.lines,
  );
  if (lineCommits.length > 0) {
    const aiAdded = lineCommits.reduce((s, c) => s + (c.attribution?.lines?.ai_added ?? 0), 0);
    const totalAdded = lineCommits.reduce(
      (s, c) => s + (c.attribution?.lines?.total_added ?? 0),
      0,
    );
    if (totalAdded > 0) meta.push(`${aiAdded}/${totalAdded} lines`);
  }

  meta.push(`${report.tracked_commits}/${report.total_commits} commits tracked`);
  meta.push(`${report.total_prompts} prompts`);
  if (report.model) meta.push(report.model);

  return [line1, meta.join(" · ")];
}

/** Format commit hash as a link if repo URL is available. */
function commitLink(c: CommitEntry, repoUrl: string | null): string {
  if (repoUrl) {
    return `[\`${c.short}\`](${repoUrl}/commit/${c.sha})`;
  }
  return `\`${c.short}\``;
}

/** Extract the first meaningful line from a prompt, filtering skill expansions. */
function cleanPrompt(prompt: string, maxLen: number): string {
  // Skip skill-generated expansions (start with ## heading).
  const lines = prompt.split("\n").filter((l) => l.trim());
  let firstLine = lines[0] ?? "";

  // If prompt starts with a markdown heading (skill expansion), find the actual user input.
  if (firstLine.startsWith("## ") || firstLine.startsWith("# ")) {
    // Look for a non-heading, non-empty line after the first heading.
    const userLine = lines.find(
      (l, i) => i > 0 && !l.startsWith("#") && !l.startsWith("```") && l.trim().length > 10,
    );
    if (userLine) firstLine = userLine.trim();
    else firstLine = firstLine.replace(/^#+\s*/, "");
  }

  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, maxLen)}…`;
}

// ─── Table format rendering ─────────────────────────

function renderMarkdown(report: PrReport): string {
  const lines: string[] = [];

  lines.push("## 🤖 Agent Note");
  lines.push("");
  lines.push(...renderHeader(report));
  lines.push("");

  lines.push("| Commit | AI Ratio | Lines | Prompts | Files |");
  lines.push("|---|---|---|---|---|");

  for (const c of report.commits) {
    const link = commitLink(c, report.repo_url);
    if (c.ai_ratio === null) {
      lines.push(`| ${link} ${c.message} | — | — | — | — |`);
      continue;
    }

    const linesCol =
      c.attribution?.method === "line" && c.attribution.lines && c.attribution.lines.total_added > 0
        ? `${c.attribution.lines.ai_added}/${c.attribution.lines.total_added}`
        : "—";
    const fileList = c.files.map((f) => `${basename(f.path)} ${f.by_ai ? "🤖" : "👤"}`).join(", ");

    lines.push(
      `| ${link} ${c.message} | ${c.ai_ratio}% | ${linesCol} | ${c.prompts_count} | ${fileList} |`,
    );
  }

  lines.push("");

  const withPrompts = report.commits.filter((c) => c.interactions.length > 0);
  if (withPrompts.length > 0) {
    lines.push("<details>");
    lines.push(`<summary>💬 Prompts & Responses (${report.total_prompts} total)</summary>`);
    lines.push("");

    for (const c of withPrompts) {
      lines.push(`### ${commitLink(c, report.repo_url)} ${c.message}`);
      lines.push("");

      for (const { prompt, response } of c.interactions) {
        lines.push(`> **Prompt:** ${cleanPrompt(prompt, TRUNCATE_PROMPT)}`);
        if (response) {
          const truncated =
            response.length > TRUNCATE_RESPONSE_PR
              ? `${response.slice(0, TRUNCATE_RESPONSE_PR)}…`
              : response;
          lines.push(">");
          lines.push(`> **Response:** ${truncated.split("\n").join("\n> ")}`);
        }
        lines.push("");
      }
    }

    lines.push("</details>");
  }

  return lines.join("\n");
}

// ─── CLI entry point ────────────────────────────────

/** Wrap rendered content with HTML comment markers for safe insertion into PR descriptions. */
function wrapWithMarkers(content: string): string {
  return `${MARKER_BEGIN}\n${content}\n${MARKER_END}`;
}

/** Insert or replace the agentnote section in an existing PR description. */
function upsertInDescription(existingBody: string, section: string): string {
  const marked = wrapWithMarkers(section);

  if (existingBody.includes(MARKER_BEGIN)) {
    // Replace existing section.
    const before = existingBody.slice(0, existingBody.indexOf(MARKER_BEGIN));
    const after = existingBody.includes(MARKER_END)
      ? existingBody.slice(existingBody.indexOf(MARKER_END) + MARKER_END.length)
      : "";
    return `${before.trimEnd()}\n\n${marked}${after}`;
  }

  // Append to the end.
  return `${existingBody.trimEnd()}\n\n${marked}`;
}

/** Update PR description using gh CLI. */
async function updatePrDescription(prNumber: string, section: string): Promise<void> {
  // Read current description.
  const { stdout: bodyJson } = await execFileAsync(
    "gh",
    ["pr", "view", prNumber, "--json", "body"],
    { encoding: "utf-8" },
  );
  const currentBody = JSON.parse(bodyJson).body ?? "";

  const newBody = upsertInDescription(currentBody, section);

  // Write updated description.
  await execFileAsync("gh", ["pr", "edit", prNumber, "--body", newBody], { encoding: "utf-8" });
}

export async function pr(args: string[]): Promise<void> {
  const isJson = args.includes("--json");
  const outputIdx = args.indexOf("--output");
  const updateIdx = args.indexOf("--update");
  const prNumber = updateIdx !== -1 ? args[updateIdx + 1] : null;
  const positional = args.filter(
    (a, i) =>
      !a.startsWith("--") &&
      (outputIdx === -1 || i !== outputIdx + 1) &&
      (updateIdx === -1 || i !== updateIdx + 1),
  );
  const base = positional[0] ?? (await detectBaseBranch());

  if (!base) {
    console.error("error: could not detect base branch. pass it as argument: agentnote pr <base>");
    process.exit(1);
  }

  const outputMode = outputIdx !== -1 ? args[outputIdx + 1] : "description";

  const report = await collectReport(base);

  if (!report) {
    if (isJson) {
      console.log(JSON.stringify({ error: "no commits found" }));
    } else {
      console.log(`no commits found between HEAD and ${base}`);
    }
    return;
  }

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const rendered = renderMarkdown(report);

  // Output routing: --update <PR#> triggers description/comment update.
  if (prNumber) {
    if (outputMode === "description") {
      await updatePrDescription(prNumber, rendered);
      console.log(`agentnote: PR #${prNumber} description updated`);
    } else {
      // Comment mode: post via gh CLI.
      await postPrComment(prNumber, rendered);
      console.log(`agentnote: PR #${prNumber} comment posted`);
    }
  } else {
    console.log(rendered);
  }
}

/** Post or update a PR comment using gh CLI. */
async function postPrComment(prNumber: string, content: string): Promise<void> {
  const marker = "<!-- agentnote-pr-report -->";
  const body = `${marker}\n${content}`;

  // Check for existing comment.
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "view",
        prNumber,
        "--json",
        "comments",
        "--jq",
        `.comments[] | select(.body | contains("${marker}")) | .id`,
      ],
      { encoding: "utf-8" },
    );
    const commentId = stdout.trim().split("\n")[0];
    if (commentId) {
      await execFileAsync(
        "gh",
        [
          "api",
          "-X",
          "PATCH",
          `/repos/{owner}/{repo}/issues/comments/${commentId}`,
          "-f",
          `body=${body}`,
        ],
        { encoding: "utf-8" },
      );
      return;
    }
  } catch {
    // No existing comment or gh not available.
  }

  // Create new comment.
  await execFileAsync("gh", ["pr", "comment", prNumber, "--body", body], { encoding: "utf-8" });
}

// ─── Helpers ────────────────────────────────────────

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

async function detectBaseBranch(): Promise<string | null> {
  for (const name of ["main", "master", "develop"]) {
    const { exitCode } = await gitSafe(["rev-parse", "--verify", `origin/${name}`]);
    if (exitCode === 0) return `origin/${name}`;
  }
  return null;
}
