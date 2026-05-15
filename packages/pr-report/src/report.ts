import { existsSync } from "node:fs";
import { join } from "node:path";
import { TRUNCATE_PROMPT_PR, TRUNCATE_RESPONSE_PR } from "../../cli/src/core/constants.js";
import type {
  Attribution,
  InteractionContext,
  InteractionSelection,
  PromptDetail,
} from "../../cli/src/core/entry.js";
import {
  DEFAULT_PROMPT_DETAIL,
  countAiRatioEligibleFiles,
  filterInteractionsByPromptDetail,
  normalizeInteractionContexts,
} from "../../cli/src/core/entry.js";
import { readNote } from "../../cli/src/core/storage.js";
import { git, gitSafe } from "../../cli/src/git.js";
import { normalizeEntry } from "../../cli/src/commands/normalize.js";
import { inferDashboardUrl } from "./github.js";

const AI_RATIO_HEADER_BAR_WIDTH = 8;
const AI_RATIO_TABLE_BAR_WIDTH = 5;
const PERCENT_DENOMINATOR = 100;
const DEFAULT_PROGRESS_BAR_WIDTH = AI_RATIO_HEADER_BAR_WIDTH;
const DEFAULT_BASE_BRANCH_CANDIDATES = ["main", "master", "develop"] as const;
const OVERALL_METHODS = {
  line: "line",
  file: "file",
  mixed: "mixed",
  none: "none",
} as const;
type OverallMethod = (typeof OVERALL_METHODS)[keyof typeof OVERALL_METHODS];
const CONTEXT_KIND_ORDER = {
  reference: 0,
  scope: 1,
} as const satisfies Record<InteractionContext["kind"], number>;
const MIN_PROMPT_BODY_LINE_CHARS = 10;
const REVIEWER_CONTEXT_MAX_CHANGED_AREAS = 4;
const REVIEWER_CONTEXT_MAX_AREA_FILES = 3;
const REVIEWER_CONTEXT_MAX_COMMIT_INTENT_SIGNALS = 2;
const REVIEWER_CONTEXT_MAX_INTENT_SIGNALS = 4;
const REVIEWER_CONTEXT_MAX_REVIEW_FOCUS = 4;
const REVIEWER_CONTEXT_SNIPPET_MAX_LENGTH = 150;
const REVIEWER_CONTEXT_COMMENT_BEGIN = "<!-- agentnote-reviewer-context";
const REVIEWER_CONTEXT_COMMENT_END = "-->";

type ReviewerAreaId =
  | "docs"
  | "tests"
  | "workflow"
  | "dependencies"
  | "config"
  | "generated"
  | "scripts"
  | "frontend"
  | "backend"
  | "source";

type ReviewerAreaRule = {
  id: ReviewerAreaId;
  label: string;
  matches: (path: string) => boolean;
};

type ReviewerChangedArea = {
  id: ReviewerAreaId;
  label: string;
  files: string[];
  moreCount: number;
};

const REVIEWER_AREA_RULES: ReviewerAreaRule[] = [
  {
    id: "tests",
    label: "Tests",
    matches: (path) =>
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
      path.includes("/__tests__/") ||
      path.includes("/test/") ||
      path.includes("/tests/") ||
      path.startsWith("test/") ||
      path.startsWith("tests/"),
  },
  {
    id: "workflow",
    label: "Workflows",
    matches: (path) =>
      path === "action.yml" ||
      path === "action.yaml" ||
      path.startsWith(".github/workflows/") ||
      path.startsWith(".github/actions/") ||
      path === ".github/dependabot.yml",
  },
  {
    id: "docs",
    label: "Documentation",
    matches: (path) =>
      path === "README.md" ||
      /^README\.[a-z-]+\.md$/i.test(path) ||
      path.startsWith("docs/") ||
      path.startsWith("website/src/content/docs/") ||
      /\.(md|mdx|rst|adoc)$/i.test(path),
  },
  {
    id: "dependencies",
    label: "Dependencies",
    matches: (path) =>
      path === "package.json" ||
      path === "package-lock.json" ||
      path === "pnpm-lock.yaml" ||
      path === "yarn.lock" ||
      path === "bun.lock" ||
      path === "Cargo.toml" ||
      path === "Cargo.lock" ||
      path === "go.mod" ||
      path === "go.sum" ||
      path === "Gemfile" ||
      path === "Gemfile.lock" ||
      path === "pyproject.toml" ||
      path === "poetry.lock" ||
      path.endsWith("/package.json") ||
      path.endsWith("/package-lock.json"),
  },
  {
    id: "config",
    label: "Configuration",
    matches: (path) =>
      /(^|\/)(tsconfig|jsconfig|eslint|prettier|biome|vite|webpack|rollup|astro|next|nuxt|tailwind|postcss|babel|jest|vitest|playwright|cypress|docker-compose)(\.|$)/i.test(
        path,
      ) ||
      path === "Dockerfile" ||
      path.endsWith(".config.js") ||
      path.endsWith(".config.ts") ||
      path.endsWith(".config.mjs") ||
      path.endsWith(".config.cjs"),
  },
  {
    id: "generated",
    label: "Generated outputs",
    matches: (path) =>
      path.includes("/dist/") ||
      path.startsWith("dist/") ||
      path.includes("/build/") ||
      path.startsWith("build/") ||
      path.endsWith(".generated.ts") ||
      path.endsWith(".generated.js") ||
      path.includes("/generated/"),
  },
  {
    id: "scripts",
    label: "Scripts",
    matches: (path) =>
      path.startsWith("scripts/") ||
      path.startsWith("tools/") ||
      path.startsWith("bin/") ||
      path.includes("/scripts/"),
  },
  {
    id: "frontend",
    label: "Frontend",
    matches: (path) =>
      path.startsWith("src/components/") ||
      path.startsWith("src/pages/") ||
      path.startsWith("src/app/") ||
      path.startsWith("src/styles/") ||
      path.startsWith("public/") ||
      path.includes("/components/") ||
      path.includes("/pages/") ||
      path.includes("/app/") ||
      path.includes("/styles/") ||
      /\.(css|scss|sass|less|astro|svelte|vue)$/i.test(path),
  },
  {
    id: "backend",
    label: "Backend",
    matches: (path) =>
      path.startsWith("api/") ||
      path.startsWith("server/") ||
      path.startsWith("routes/") ||
      path.startsWith("controllers/") ||
      path.startsWith("models/") ||
      path.includes("/api/") ||
      path.includes("/server/") ||
      path.includes("/routes/") ||
      path.includes("/controllers/") ||
      path.includes("/models/"),
  },
  {
    id: "source",
    label: "Source",
    matches: () => true,
  },
];

const REVIEW_FOCUS_BY_AREA: Record<ReviewerAreaId, string> = {
  docs: "Check that docs and examples match the implemented behavior without exposing internal development terminology.",
  tests: "Check that tests cover behavior, edge cases, and regression risks rather than only snapshots.",
  workflow:
    "Check that automation is safe for forks, retries, permissions, and existing deployment workflows.",
  dependencies:
    "Check that dependency or package metadata changes are intentional and compatible with release expectations.",
  config:
    "Check that configuration changes are scoped, documented, and consistent with the affected tooling.",
  generated:
    "Check that generated outputs are consistent with source changes and were not hand-edited accidentally.",
  scripts:
    "Check that scripts remain safe, idempotent, and clear about the files or services they touch.",
  frontend:
    "Check user-facing behavior, accessibility, layout, and build output for the changed UI paths.",
  backend:
    "Check API or server behavior, data handling, error paths, and compatibility with existing clients.",
  source: "Compare the stated intent with the changed source files and the prompt evidence below.",
};

/** Prompt/response pair rendered in the PR Report prompt details. */
export interface Interaction {
  prompt: string;
  response: string | null;
  context?: string;
  contexts?: InteractionContext[];
  files_touched?: string[];
  tools?: string[] | null;
  selection?: InteractionSelection;
}

/** Per-commit summary row collected from git notes and git history. */
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

/** Full PR Report model used by Markdown rendering and GitHub Action outputs. */
export interface PrReport {
  base: string;
  head: string;
  repo_url: string | null;
  dashboard_url: string | null;
  dashboard_preview_help_url?: string | null;
  total_commits: number;
  tracked_commits: number;
  total_prompts: number;
  total_files: number;
  total_files_ai: number;
  overall_ai_ratio: number;
  overall_method: OverallMethod;
  model: string | null;
  commits: CommitEntry[];
}

/** Markdown rendering options for PR body/comment output. */
export interface RenderMarkdownOptions {
  promptDetail?: PromptDetail;
}

/** Collection options supplied by the GitHub Action wrapper. */
export interface CollectReportOptions {
  dashboardPrNumber?: number | string | null;
}

/** Collect commits, git notes, AI ratio, and dashboard links for one PR range. */
export async function collectReport(
  base: string,
  headRef = "HEAD",
  opts: CollectReportOptions = {},
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
      commit.attribution?.method === OVERALL_METHODS.line &&
      commit.attribution.lines &&
      commit.attribution.lines.total_added > 0,
  );
  const fileOnly = tracked.filter((commit) => commit.attribution?.method === OVERALL_METHODS.file);
  const excluded = tracked.filter((commit) => commit.attribution?.method === OVERALL_METHODS.none);
  const eligible = [...lineEligible, ...fileOnly];

  let overallMethod: OverallMethod;
  if (tracked.length > 0 && excluded.length === tracked.length) {
    overallMethod = OVERALL_METHODS.none;
  } else if (eligible.length === 0) {
    overallMethod = OVERALL_METHODS.none;
  } else if (fileOnly.length === 0 && lineEligible.length > 0) {
    overallMethod = OVERALL_METHODS.line;
  } else if (lineEligible.length === 0) {
    overallMethod = OVERALL_METHODS.file;
  } else {
    overallMethod = OVERALL_METHODS.mixed;
  }

  let overallAiRatio: number;
  if (overallMethod === OVERALL_METHODS.line) {
    const aiAdded = lineEligible.reduce(
      (sum, commit) => sum + (commit.attribution?.lines?.ai_added ?? 0),
      0,
    );
    const totalAdded = lineEligible.reduce(
      (sum, commit) => sum + (commit.attribution?.lines?.total_added ?? 0),
      0,
    );
    overallAiRatio =
      totalAdded > 0 ? Math.round((aiAdded / totalAdded) * PERCENT_DENOMINATOR) : 0;
  } else if (overallMethod === OVERALL_METHODS.file) {
    const eligibleFiles = eligible.reduce((sum, commit) => sum + commit.files_total, 0);
    const eligibleFilesAi = eligible.reduce((sum, commit) => sum + commit.files_ai, 0);
    overallAiRatio =
      eligibleFiles > 0
        ? Math.round((eligibleFilesAi / eligibleFiles) * PERCENT_DENOMINATOR)
        : 0;
  } else if (overallMethod === OVERALL_METHODS.mixed) {
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
  const dashboardUrl = hasDashboardWorkflow
    ? inferDashboardUrl(repoUrl, opts.dashboardPrNumber)
    : null;

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

/** Render a fixed-width text progress bar for compact Markdown tables. */
export function renderProgressBar(ratio: number, width = DEFAULT_PROGRESS_BAR_WIDTH): string {
  const normalizedRatio = Math.min(PERCENT_DENOMINATOR, Math.max(0, ratio));
  const filled = Math.round((normalizedRatio / PERCENT_DENOMINATOR) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Render AI ratio as `bar percentage` for stable table alignment. */
export function renderRatioWithBar(ratio: number, width: number): string {
  return `${renderProgressBar(ratio, width)} ${ratio}%`;
}

/** Render the top summary lines before the per-commit table. */
export function renderHeader(report: PrReport): string[] {
  if (report.total_commits > 0 && report.tracked_commits === 0) {
    return ["**Total AI Ratio:** —", "**Agent Note data:** No tracked commits"];
  }

  const line1 = `**Total AI Ratio:** ${renderRatioWithBar(
    report.overall_ai_ratio,
    AI_RATIO_HEADER_BAR_WIDTH,
  )}`;
  const lines = [line1];
  if (report.model) {
    lines.push(`**Model:** \`${report.model}\``);
  }
  return lines;
}

/** Render a complete PR Report Markdown block suitable for PR body insertion. */
export function renderMarkdown(report: PrReport, opts: RenderMarkdownOptions = {}): string {
  const promptDetail = opts.promptDetail ?? DEFAULT_PROMPT_DETAIL;
  const lines: string[] = [];
  const visibleInteractionsBySha = new Map<string, Interaction[]>();
  let visiblePromptCount = 0;

  for (const commit of report.commits) {
    const interactions = filterInteractionsByPromptDetail(
      mergePromptOnlyDisplayInteractions(commit.interactions),
      promptDetail,
    );
    visibleInteractionsBySha.set(commit.sha, interactions);
    visiblePromptCount += interactions.length;
  }

  lines.push("## 🧑💬🤖 Agent Note");
  lines.push("");
  lines.push(...renderHeader(report));
  lines.push("");
  const reviewerContext = renderReviewerContext(report, visibleInteractionsBySha);
  if (reviewerContext.length > 0) {
    lines.push(...reviewerContext);
  }

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
    const aiRatioCell = renderRatioWithBar(commit.ai_ratio, AI_RATIO_TABLE_BAR_WIDTH);

    lines.push(
      `| ${commitCell} | ${aiRatioCell} | ${commit.prompts_count} | ${fileList} |`,
    );
  }

  lines.push("");
  if (report.dashboard_url) {
    lines.push(
      `<div align="right"><a href="${report.dashboard_url}" target="_blank" rel="noopener noreferrer">Open Dashboard ↗</a></div>`,
    );
    if (report.dashboard_preview_help_url) {
      lines.push(
        `<div align="right"><sub><a href="${report.dashboard_preview_help_url}">About PR previews</a></sub></div>`,
      );
    }
    lines.push("");
  }

  const withPrompts = report.commits.filter(
    (commit) => (visibleInteractionsBySha.get(commit.sha)?.length ?? 0) > 0,
  );
  if (report.total_prompts > 0) {
    lines.push("<details>");
    lines.push(
      `<summary>💬 Prompts & Responses (${renderPromptSummary(visiblePromptCount, report.total_prompts, promptDetail)})</summary>`,
    );
    lines.push("");

    if (withPrompts.length === 0) {
      lines.push(
        `_No prompts are shown at the current \`prompt_detail\` setting. Use \`full\` to show every stored prompt._`,
      );
      lines.push("");
    } else {
      for (const commit of withPrompts) {
        lines.push(`### ${commitLink(commit, report.repo_url)} ${commit.message}`);
        lines.push("");

        for (const interaction of visibleInteractionsBySha.get(commit.sha) ?? []) {
          const context = renderInteractionContext(interaction);
          if (context) {
            pushBlockquoteSection(lines, "📝 Context", cleanContext(context));
            lines.push(">");
          }

          const cleaned = cleanPrompt(interaction.prompt, TRUNCATE_PROMPT_PR);
          pushBlockquoteSection(lines, "🧑 Prompt", cleaned);
          if (interaction.response) {
            const truncated =
              interaction.response.length > TRUNCATE_RESPONSE_PR
                ? `${interaction.response.slice(0, TRUNCATE_RESPONSE_PR)}…`
                : interaction.response;
            lines.push(">");
            pushBlockquoteSection(lines, "🤖 Response", truncated);
          }
          lines.push("");
        }
      }
    }

    lines.push("</details>");
  }

  return lines.join("\n");
}

/**
 * Build deterministic reviewer context as a hidden PR body comment.
 *
 * The context is evidence-oriented rather than a natural-language summary.
 * Keeping it inside an HTML comment avoids adding visual noise for human
 * reviewers while still making the raw PR body useful to review tools that read
 * Markdown source.
 */
function renderReviewerContext(
  report: PrReport,
  visibleInteractionsBySha: Map<string, Interaction[]>,
): string[] {
  if (report.tracked_commits === 0) return [];

  const changedAreas = collectReviewerChangedAreas(report);
  const reviewFocus = collectReviewerFocus(changedAreas);
  const intentSignals = collectReviewerIntentSignals(report, visibleInteractionsBySha);

  if (changedAreas.length === 0 && reviewFocus.length === 0 && intentSignals.length === 0) {
    return [];
  }

  const body = [
    "Generated from Agent Note data. Use this as intent and review focus, not as proof that the implementation is correct.",
    "",
  ];

  if (changedAreas.length > 0) {
    body.push("Changed areas:", "");
    for (const area of changedAreas) {
      body.push(`- ${area.label}: ${formatReviewerAreaFiles(area)}`);
    }
    body.push("");
  }

  if (reviewFocus.length > 0) {
    body.push("Review focus:", "");
    for (const focus of reviewFocus) {
      body.push(`- ${focus}`);
    }
    body.push("");
  }

  if (intentSignals.length > 0) {
    body.push("Author intent signals:", "");
    for (const signal of intentSignals) {
      body.push(`- ${signal}`);
    }
    body.push("");
  }

  return [
    REVIEWER_CONTEXT_COMMENT_BEGIN,
    ...body.map(sanitizeReviewerCommentLine),
    REVIEWER_CONTEXT_COMMENT_END,
    "",
  ];
}

function collectReviewerChangedAreas(report: PrReport): ReviewerChangedArea[] {
  const areaFiles = new Map<ReviewerAreaId, Set<string>>();

  for (const commit of report.commits) {
    if (commit.session_id === null) continue;

    for (const file of commit.files) {
      const rule = REVIEWER_AREA_RULES.find((candidate) => candidate.matches(file.path));
      const id = rule?.id ?? "source";
      const files = areaFiles.get(id) ?? new Set<string>();
      files.add(file.path);
      areaFiles.set(id, files);
    }
  }

  return [...areaFiles]
    .map(([id, files]) => {
      const rule = REVIEWER_AREA_RULES.find((candidate) => candidate.id === id);
      return {
        id,
        label: rule?.label ?? "Source",
        files: [...files].sort().slice(0, REVIEWER_CONTEXT_MAX_AREA_FILES),
        totalFiles: files.size,
      };
    })
    .sort((left, right) => right.totalFiles - left.totalFiles || left.label.localeCompare(right.label))
    .slice(0, REVIEWER_CONTEXT_MAX_CHANGED_AREAS)
    .map(({ id, label, files, totalFiles }) => ({
      id,
      label,
      files,
      moreCount: Math.max(0, totalFiles - files.length),
    }));
}

function collectReviewerFocus(areas: ReviewerChangedArea[]): string[] {
  const focus: string[] = [];
  const seen = new Set<string>();

  for (const area of areas) {
    const text = REVIEW_FOCUS_BY_AREA[area.id];
    if (!seen.has(text)) {
      focus.push(text);
      seen.add(text);
    }
    if (focus.length >= REVIEWER_CONTEXT_MAX_REVIEW_FOCUS) break;
  }

  return focus;
}

function collectReviewerIntentSignals(
  report: PrReport,
  visibleInteractionsBySha: Map<string, Interaction[]>,
): string[] {
  const signals: string[] = [];
  const seen = new Set<string>();
  const primarySignals: string[] = [];
  const fallbackSignals: string[] = [];
  let commitSignalCount = 0;
  const trackedCommitsNewestFirst = report.commits
    .filter((commit) => commit.session_id !== null)
    .toReversed();

  for (const commit of trackedCommitsNewestFirst) {
    if (commitSignalCount < REVIEWER_CONTEXT_MAX_COMMIT_INTENT_SIGNALS) {
      pushReviewerSignal(signals, seen, `Commit: ${commit.message}`);
      commitSignalCount += 1;
    }

    // Review tools benefit most from the final task intent. Older commits are
    // still visible in the report, but the hidden context budget is intentionally
    // spent newest-first to avoid reviving stale task prompts.
    for (const interaction of visibleInteractionsBySha.get(commit.sha) ?? []) {
      const target = isPrimaryReviewerInteraction(interaction) ? primarySignals : fallbackSignals;
      const context = renderInteractionContext(interaction);
      if (context) {
        target.push(`Context: ${context}`);
      }
      target.push(`Prompt: ${interaction.prompt}`);
    }
  }

  for (const signal of [...primarySignals, ...fallbackSignals]) {
    pushReviewerSignal(signals, seen, signal);
    if (signals.length >= REVIEWER_CONTEXT_MAX_INTENT_SIGNALS) return signals;
  }

  return signals;
}

function isPrimaryReviewerInteraction(interaction: Interaction): boolean {
  const signals = interaction.selection?.signals ?? [];
  return (
    interaction.selection?.source === "primary" ||
    signals.includes("primary_edit_turn") ||
    signals.includes("exact_commit_path") ||
    signals.includes("diff_identifier")
  );
}

function pushReviewerSignal(signals: string[], seen: Set<string>, rawSignal: string): void {
  const signal = formatReviewerSnippet(rawSignal);
  if (!signal || seen.has(signal)) return;
  signals.push(signal);
  seen.add(signal);
}

function formatReviewerSnippet(value: string): string {
  const compact = value
    .replaceAll("\n", " ")
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .trim();
  if (!compact) return "";

  const clipped =
    compact.length > REVIEWER_CONTEXT_SNIPPET_MAX_LENGTH
      ? `${compact.slice(0, REVIEWER_CONTEXT_SNIPPET_MAX_LENGTH)}…`
      : compact;
  return escapeInlineText(clipped);
}

function escapeInlineText(value: string): string {
  return value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function sanitizeReviewerCommentLine(value: string): string {
  return escapeInlineText(value).replaceAll("--", "- -");
}

function formatInlineCode(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

function formatReviewerAreaFiles(area: ReviewerChangedArea): string {
  const files = area.files.map(formatInlineCode);
  if (area.moreCount > 0) {
    files.push(`${area.moreCount} more`);
  }
  return files.join(", ");
}

/**
 * Summarize prompt filtering without exposing internal score levels.
 *
 * Users choose between compact and full output, so the text describes how many
 * prompts are visible rather than why the hidden prompts were filtered.
 */
function renderPromptSummary(visible: number, total: number, detail: PromptDetail): string {
  if (detail === "full" || visible === total) return `${total} total`;
  return `${visible} shown / ${total} total`;
}

/** Detect the best remote base branch when the Action input omits one. */
export async function detectBaseBranch(): Promise<string | null> {
  for (const name of DEFAULT_BASE_BRANCH_CANDIDATES) {
    const { exitCode } = await gitSafe(["rev-parse", "--verify", `origin/${name}`]);
    if (exitCode === 0) return `origin/${name}`;
  }
  return null;
}

/** Render a commit SHA as a link when the report can infer the GitHub remote. */
function commitLink(commit: CommitEntry, repoUrl: string | null): string {
  if (repoUrl) {
    return `[\`${commit.short}\`](${repoUrl}/commit/${commit.sha})`;
  }
  return `\`${commit.short}\``;
}

/** Escape markdown table delimiters while keeping cells single-line. */
function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/**
 * Preserve old notes that stored prompt-only rows before the response row.
 *
 * New notes carry `selection` metadata and are filtered independently, so this
 * merge is intentionally limited to legacy rows without prompt selection data.
 */
function mergePromptOnlyDisplayInteractions(interactions: Interaction[]): Interaction[] {
  const result: Interaction[] = [];
  let pendingPrompts: string[] = [];

  for (const interaction of interactions) {
    if (isPromptOnlyDisplayPrefix(interaction)) {
      pendingPrompts.push(interaction.prompt);
      continue;
    }

    if (pendingPrompts.length > 0) {
      result.push({
        ...interaction,
        prompt: [...pendingPrompts, interaction.prompt].join("\n\n"),
      });
      pendingPrompts = [];
      continue;
    }

    result.push(interaction);
  }

  for (const prompt of pendingPrompts) {
    result.push({ prompt, response: null });
  }

  return result;
}

/** Detect a legacy prompt-only row that should be merged into the next row. */
function isPromptOnlyDisplayPrefix(interaction: Interaction): boolean {
  return (
    interaction.response === null &&
    !interaction.context &&
    (!interaction.contexts || interaction.contexts.length === 0) &&
    (!interaction.files_touched || interaction.files_touched.length === 0) &&
    !interaction.selection &&
    interaction.tools === undefined
  );
}

/** Keep Context text intact; unlike prompts and responses, it is pre-sized. */
function cleanContext(context: string): string {
  return context.trim();
}

/** Trim generated prompt text for compact PR descriptions. */
function cleanPrompt(prompt: string, maxLen: number): string {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return "";

  const lines = trimmed.split("\n");
  const firstLine = lines[0] ?? "";

  let body = trimmed;
  if (firstLine.startsWith("## ") || firstLine.startsWith("# ")) {
    const userStart = lines.findIndex(
      (line, index) =>
        index > 0 &&
        !line.startsWith("#") &&
        !line.startsWith("```") &&
        line.trim().length > MIN_PROMPT_BODY_LINE_CHARS,
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

/** Append a visible section label followed by a blockquoted body. */
function pushBlockquoteSection(lines: string[], label: string, body: string): void {
  lines.push(`**${label}**`);
  lines.push(`> ${body.split("\n").join("\n> ")}`);
}

/** Render all structured interaction contexts in their stable display order. */
function renderInteractionContext(interaction: Interaction): string {
  return normalizeInteractionContexts(interaction)
    .sort((left, right) => contextKindOrder(left.kind) - contextKindOrder(right.kind))
    .map((context) => context.text)
    .join("\n\n")
    .trim();
}

/** Show reference context before scope context when both are present. */
function contextKindOrder(kind: InteractionContext["kind"]): number {
  return CONTEXT_KIND_ORDER[kind];
}

/** Return the last path segment for the PR report file summary. */
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
