import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { git, gitSafe } from "../git.js";
import { readNote } from "../core/storage.js";

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
  ai_ratio: number | null;
  prompts_count: number;
  files_total: number;
  files_ai: number;
  files: Array<{ path: string; by_ai: boolean }>;
  interactions: Interaction[];
}

interface PrReport {
  base: string;
  head: string;
  total_commits: number;
  tracked_commits: number;
  total_prompts: number;
  total_files: number;
  total_files_ai: number;
  overall_ai_ratio: number;
  commits: CommitEntry[];
}

// ─── Data collection ────────────────────────────────

async function collectReport(base: string): Promise<PrReport | null> {
  const head = await git(["rev-parse", "--short", "HEAD"]);
  const raw = await git([
    "log",
    "--reverse",
    "--format=%H\t%h\t%s",
    `${base}..HEAD`,
  ]);

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
        ai_ratio: null,
        prompts_count: 0,
        files_total: 0,
        files_ai: 0,
        files: [],
        interactions: [],
      });
      continue;
    }

    const entry = note as any;
    const interactions: Interaction[] =
      entry.interactions ??
      (entry.prompts ?? []).map((p: string) => ({ prompt: p, response: null }));

    const filesInCommit: string[] = entry.files_in_commit ?? [];
    const filesByAi: string[] = entry.files_by_ai ?? [];

    commits.push({
      sha,
      short,
      message,
      session_id: entry.session_id ?? null,
      ai_ratio: entry.ai_ratio ?? 0,
      prompts_count: interactions.length,
      files_total: filesInCommit.length,
      files_ai: filesByAi.length,
      files: filesInCommit.map((f: string) => ({
        path: f,
        by_ai: filesByAi.includes(f),
      })),
      interactions,
    });
  }

  const tracked = commits.filter((c) => c.session_id !== null);
  const totalFiles = tracked.reduce((s, c) => s + c.files_total, 0);
  const totalFilesAi = tracked.reduce((s, c) => s + c.files_ai, 0);

  return {
    base,
    head,
    total_commits: commits.length,
    tracked_commits: tracked.length,
    total_prompts: tracked.reduce((s, c) => s + c.prompts_count, 0),
    total_files: totalFiles,
    total_files_ai: totalFilesAi,
    overall_ai_ratio: totalFiles > 0 ? Math.round((totalFilesAi / totalFiles) * 100) : 0,
    commits,
  };
}

// ─── Markdown rendering ─────────────────────────────

function renderMarkdown(report: PrReport): string {
  const lines: string[] = [];

  lines.push("## 🤖 Agentnote — AI Session Report");
  lines.push("");
  lines.push(
    `**Overall AI ratio: ${report.overall_ai_ratio}%** ` +
      `(${report.tracked_commits}/${report.total_commits} commits tracked, ${report.total_prompts} prompts)`,
  );
  lines.push("");

  lines.push("| Commit | AI | Prompts | Files |");
  lines.push("|---|---|---|---|");

  for (const c of report.commits) {
    if (c.ai_ratio === null) {
      lines.push(`| \`${c.short}\` ${c.message} | — | — | — |`);
      continue;
    }

    const bar = renderBar(c.ai_ratio);
    const fileList = c.files
      .map((f) => `${basename(f.path)} ${f.by_ai ? "🤖" : "👤"}`)
      .join(", ");

    lines.push(
      `| \`${c.short}\` ${c.message} | ${c.ai_ratio}% ${bar} | ${c.prompts_count} | ${fileList} |`,
    );
  }

  lines.push("");

  const withPrompts = report.commits.filter((c) => c.interactions.length > 0);
  if (withPrompts.length > 0) {
    lines.push("<details>");
    lines.push(`<summary>Prompts & Responses (${report.total_prompts} total)</summary>`);
    lines.push("");

    for (const c of withPrompts) {
      lines.push(`**\`${c.short}\`** ${c.message}`);
      lines.push("");

      for (const { prompt, response } of c.interactions) {
        lines.push(`> **Prompt:** ${prompt}`);
        if (response) {
          const truncated =
            response.length > 500 ? response.slice(0, 500) + "…" : response;
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

// ─── Chat-style rendering ───────────────────────────

function renderChat(report: PrReport): string {
  const lines: string[] = [];

  lines.push("## 🤖 Agentnote — Session Transcript");
  lines.push("");
  lines.push(
    `**Overall AI ratio: ${report.overall_ai_ratio}%** ` +
      `(${report.tracked_commits}/${report.total_commits} commits tracked, ${report.total_prompts} prompts)`,
  );

  for (const c of report.commits) {
    lines.push("");

    const ratioLabel =
      c.ai_ratio === null
        ? ""
        : c.ai_ratio === 0
          ? "👤 Human 100% ░░░░░"
          : `AI ${c.ai_ratio}% ${renderBar(c.ai_ratio)}`;

    const aiCount = c.files.filter((f) => f.by_ai).length;
    const humanCount = c.files.length - aiCount;
    const fileSummary = c.files.length > 0
      ? ` · ${c.files.length} files (${aiCount} 🤖 ${humanCount} 👤)`
      : "";

    const summaryExtra = ratioLabel ? ` — ${ratioLabel}` : "";
    const summaryFiles = fileSummary;

    if (c.interactions.length === 0 && c.ai_ratio === null) {
      lines.push(`<details>`);
      lines.push(`<summary><code>${c.short}</code> ${c.message}</summary>`);
      lines.push("");
      lines.push("*No agentnote data for this commit.*");
      lines.push("");
      lines.push(`</details>`);
      continue;
    }

    lines.push(`<details>`);
    lines.push(`<summary><code>${c.short}</code> ${c.message}${summaryExtra}${summaryFiles}</summary>`);
    lines.push("");

    for (const { prompt, response } of c.interactions) {
      lines.push(`> **🧑 Prompt**`);
      lines.push(`> ${prompt.split("\n").join("\n> ")}`);
      lines.push("");

      if (response) {
        lines.push(`**🤖 Response**`);
        lines.push("");

        const truncated =
          response.length > 800 ? response.slice(0, 800) + "…" : response;
        lines.push(truncated);
        lines.push("");
      }
    }

    if (c.interactions.length > 0 && c.ai_ratio === 0) {
      lines.push("*AI provided guidance, but the code was written by a human.*");
      lines.push("");
    }

    // File list at the end of each commit's details
    if (c.files.length > 0) {
      lines.push("**Files:**");
      for (const f of c.files) {
        lines.push(`- \`${f.path}\` ${f.by_ai ? "🤖" : "👤"}`);
      }
      lines.push("");
    }

    lines.push(`</details>`);
  }

  // Collapsible summary table
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("<details>");
  lines.push(`<summary>📊 Summary</summary>`);
  lines.push("");
  lines.push(
    `**Overall AI ratio: ${report.overall_ai_ratio}%** ` +
      `(${report.tracked_commits}/${report.total_commits} commits, ${report.total_prompts} prompts)`,
  );
  lines.push("");
  lines.push("| Commit | AI | Prompts | Files |");
  lines.push("|---|---|---|---|");

  for (const c of report.commits) {
    if (c.ai_ratio === null) {
      lines.push(`| \`${c.short}\` ${c.message} | — | — | — |`);
      continue;
    }
    const fileList = c.files
      .map((f) => `${basename(f.path)} ${f.by_ai ? "🤖" : "👤"}`)
      .join(", ");
    lines.push(
      `| \`${c.short}\` ${c.message} | ${c.ai_ratio}% ${renderBar(c.ai_ratio)} | ${c.prompts_count} | ${fileList} |`,
    );
  }

  lines.push("");
  lines.push("</details>");

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
    return before.trimEnd() + "\n\n" + marked + after;
  }

  // Append to the end.
  return existingBody.trimEnd() + "\n\n" + marked;
}

/** Update PR description using gh CLI. */
async function updatePrDescription(prNumber: string, section: string): Promise<void> {
  // Read current description.
  const { stdout: bodyJson } = await execFileAsync("gh", [
    "pr", "view", prNumber, "--json", "body",
  ], { encoding: "utf-8" });
  const currentBody = JSON.parse(bodyJson).body ?? "";

  const newBody = upsertInDescription(currentBody, section);

  // Write updated description.
  await execFileAsync("gh", [
    "pr", "edit", prNumber, "--body", newBody,
  ], { encoding: "utf-8" });
}

export async function pr(args: string[]): Promise<void> {
  const isJson = args.includes("--json");
  const formatIdx = args.indexOf("--format");
  const format = formatIdx !== -1 ? args[formatIdx + 1] : "table";
  const updateIdx = args.indexOf("--update");
  const prNumber = updateIdx !== -1 ? args[updateIdx + 1] : null;
  const positional = args.filter(
    (a, i) =>
      !a.startsWith("--") &&
      (formatIdx === -1 || i !== formatIdx + 1) &&
      (updateIdx === -1 || i !== updateIdx + 1),
  );
  const base = positional[0] ?? (await detectBaseBranch());

  if (!base) {
    console.error(
      "error: could not detect base branch. pass it as argument: agentnote pr <base>",
    );
    process.exit(1);
  }

  const report = await collectReport(base);

  if (!report) {
    if (isJson) {
      console.log(JSON.stringify({ error: "no commits found" }));
    } else {
      console.log("no commits found between HEAD and " + base);
    }
    return;
  }

  let output: string;
  if (isJson) {
    output = JSON.stringify(report, null, 2);
  } else if (format === "chat") {
    output = renderChat(report);
  } else {
    output = renderMarkdown(report);
  }

  if (prNumber) {
    await updatePrDescription(prNumber, output);
    console.log(`agentnote: PR #${prNumber} description updated`);
  } else {
    console.log(output);
  }
}

// ─── Helpers ────────────────────────────────────────

function renderBar(ratio: number): string {
  const width = 5;
  const filled = Math.round((ratio / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

async function detectBaseBranch(): Promise<string | null> {
  for (const name of ["main", "master", "develop"]) {
    const { exitCode } = await gitSafe([
      "rev-parse",
      "--verify",
      `origin/${name}`,
    ]);
    if (exitCode === 0) return `origin/${name}`;
  }
  return null;
}
