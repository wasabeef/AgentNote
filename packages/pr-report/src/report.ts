import { existsSync } from "node:fs";
import { join } from "node:path";
import { TRUNCATE_PROMPT_PR, TRUNCATE_RESPONSE_PR } from "../../cli/src/core/constants.js";
import type { Attribution } from "../../cli/src/core/entry.js";
import { countAiRatioEligibleFiles } from "../../cli/src/core/entry.js";
import { readNote } from "../../cli/src/core/storage.js";
import { git, gitSafe } from "../../cli/src/git.js";
import { normalizeEntry } from "../../cli/src/commands/normalize.js";
import { inferDashboardUrl } from "./github.js";

export interface Interaction {
  prompt: string;
  response: string | null;
}

export interface CommitEntry {
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

export interface PrReport {
  base: string;
  head: string;
  repo_url: string | null;
  dashboard_url: string | null;
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

export async function collectReport(
  base: string,
  headRef = "HEAD",
): Promise<PrReport | null> {
  const head = await git(["rev-parse", "--short", headRef]);
  const raw = await git(["log", "--reverse", "--format=%H\t%h\t%s", `${base}..${headRef}`]);

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
    const eligibleCounts = countAiRatioEligibleFiles(entry.files);

    commits.push({
      sha,
      short,
      message,
      session_id: entry.session_id ?? null,
      model: entry.model ?? null,
      ai_ratio: entry.attribution.ai_ratio,
      attribution_method: entry.attribution.method,
      prompts_count: entry.interactions.length,
      files_total: eligibleCounts.total,
      files_ai: eligibleCounts.ai,
      files: entry.files,
      interactions: entry.interactions,
      attribution: entry.attribution,
    });
  }

  const tracked = commits.filter((commit) => commit.session_id !== null);
  const totalFiles = tracked.reduce((sum, commit) => sum + commit.files_total, 0);
  const totalFilesAi = tracked.reduce((sum, commit) => sum + commit.files_ai, 0);

  const lineEligible = tracked.filter(
    (commit) =>
      commit.attribution?.method === "line" &&
      commit.attribution.lines &&
      commit.attribution.lines.total_added > 0,
  );
  const fileOnly = tracked.filter((commit) => commit.attribution?.method === "file");
  const excluded = tracked.filter((commit) => commit.attribution?.method === "none");
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
    const aiAdded = lineEligible.reduce(
      (sum, commit) => sum + (commit.attribution?.lines?.ai_added ?? 0),
      0,
    );
    const totalAdded = lineEligible.reduce(
      (sum, commit) => sum + (commit.attribution?.lines?.total_added ?? 0),
      0,
    );
    overallAiRatio = totalAdded > 0 ? Math.round((aiAdded / totalAdded) * 100) : 0;
  } else if (overallMethod === "file") {
    const eligibleFiles = eligible.reduce((sum, commit) => sum + commit.files_total, 0);
    const eligibleFilesAi = eligible.reduce((sum, commit) => sum + commit.files_ai, 0);
    overallAiRatio =
      eligibleFiles > 0 ? Math.round((eligibleFilesAi / eligibleFiles) * 100) : 0;
  } else if (overallMethod === "mixed") {
    const weightedSum = eligible.reduce(
      (sum, commit) => sum + (commit.ai_ratio ?? 0) * commit.files_total,
      0,
    );
    const weightTotal = eligible.reduce((sum, commit) => sum + commit.files_total, 0);
    overallAiRatio = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  } else {
    overallAiRatio = 0;
  }

  let repoUrl: string | null = null;
  try {
    const remoteUrl = await git(["remote", "get-url", "origin"]);
    repoUrl = remoteUrl
      .replace(/\.git$/, "")
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
  } catch {
    repoUrl = null;
  }

  const repoRoot = await git(["rev-parse", "--show-toplevel"]);
  const hasDashboardWorkflow = existsSync(
    join(repoRoot, ".github", "workflows", "agentnote-dashboard.yml"),
  );
  const dashboardUrl = hasDashboardWorkflow ? inferDashboardUrl(repoUrl) : null;

  return {
    base,
    head,
    repo_url: repoUrl,
    dashboard_url: dashboardUrl,
    total_commits: commits.length,
    tracked_commits: tracked.length,
    total_prompts: tracked.reduce((sum, commit) => sum + commit.prompts_count, 0),
    total_files: totalFiles,
    total_files_ai: totalFilesAi,
    overall_ai_ratio: overallAiRatio,
    overall_method: overallMethod,
    model: tracked.find((commit) => commit.model)?.model ?? null,
    commits,
  };
}

export function renderProgressBar(ratio: number, width = 8): string {
  const filled = Math.round((ratio / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function renderRatioWithBar(ratio: number, width: number): string {
  return `${renderProgressBar(ratio, width)} ${ratio}%`;
}

export function renderHeader(report: PrReport): string[] {
  const line1 = `**Total AI Ratio:** ${renderRatioWithBar(report.overall_ai_ratio, 8)}`;
  const lines = [line1];
  if (report.model) {
    lines.push(`**Model:** \`${report.model}\``);
  }
  return lines;
}

export function renderMarkdown(report: PrReport): string {
  const lines: string[] = [];

  lines.push("## 🧑💬🤖 Agent Note");
  lines.push("");
  lines.push(...renderHeader(report));
  lines.push("");

  lines.push("| Commit | AI Ratio | Prompts | Files |");
  lines.push("|---|---|---|---|");

  for (const commit of report.commits) {
    const link = commitLink(commit, report.repo_url);
    const commitCell = escapeTableCell(`${link} ${commit.message}`);
    if (commit.ai_ratio === null) {
      lines.push(`| ${commitCell} | — | — | — |`);
      continue;
    }

    const fileList = escapeTableCell(
      commit.files.map((file) => `${basename(file.path)} ${file.by_ai ? "🤖" : "👤"}`).join(", "),
    );
    const aiRatioCell = renderRatioWithBar(commit.ai_ratio, 5);

    lines.push(
      `| ${commitCell} | ${aiRatioCell} | ${commit.prompts_count} | ${fileList} |`,
    );
  }

  lines.push("");
  if (report.dashboard_url) {
    lines.push(
      `<div align="right"><a href="${report.dashboard_url}">Open Dashboard ↗</a></div>`,
    );
    lines.push("");
  }

  const withPrompts = report.commits.filter((commit) => commit.interactions.length > 0);
  if (withPrompts.length > 0) {
    lines.push("<details>");
    lines.push(`<summary>💬 Prompts & Responses (${report.total_prompts} total)</summary>`);
    lines.push("");

    for (const commit of withPrompts) {
      lines.push(`### ${commitLink(commit, report.repo_url)} ${commit.message}`);
      lines.push("");

      for (const { prompt, response } of commit.interactions) {
        const cleaned = cleanPrompt(prompt, TRUNCATE_PROMPT_PR);
        lines.push(`> **🧑 Prompt:** ${cleaned.split("\n").join("\n> ")}`);
        if (response) {
          const truncated =
            response.length > TRUNCATE_RESPONSE_PR
              ? `${response.slice(0, TRUNCATE_RESPONSE_PR)}…`
              : response;
          lines.push(">");
          lines.push(`> **🤖 Response:** ${truncated.split("\n").join("\n> ")}`);
        }
        lines.push("");
      }
    }

    lines.push("</details>");
  }

  return lines.join("\n");
}

export async function detectBaseBranch(): Promise<string | null> {
  for (const name of ["main", "master", "develop"]) {
    const { exitCode } = await gitSafe(["rev-parse", "--verify", `origin/${name}`]);
    if (exitCode === 0) return `origin/${name}`;
  }
  return null;
}

function commitLink(commit: CommitEntry, repoUrl: string | null): string {
  if (repoUrl) {
    return `[\`${commit.short}\`](${repoUrl}/commit/${commit.sha})`;
  }
  return `\`${commit.short}\``;
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function cleanPrompt(prompt: string, maxLen: number): string {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return "";

  const lines = trimmed.split("\n");
  const firstLine = lines[0] ?? "";

  let body = trimmed;
  if (firstLine.startsWith("## ") || firstLine.startsWith("# ")) {
    const userStart = lines.findIndex(
      (line, index) =>
        index > 0 && !line.startsWith("#") && !line.startsWith("```") && line.trim().length > 10,
    );
    if (userStart !== -1) {
      body = lines.slice(userStart).join("\n").trim();
    } else {
      body = firstLine.replace(/^#+\s*/, "");
    }
  }

  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen)}…`;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
