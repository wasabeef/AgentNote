import { git, gitSafe } from "../git.js";
import { readNote } from "../core/storage.js";

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
        by_ai: filesByAi.some((af: string) => af.endsWith(f)),
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

  lines.push("## 🤖 Lore — AI Session Report");
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

// ─── CLI entry point ────────────────────────────────

export async function pr(args: string[]): Promise<void> {
  const isJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const base = positional[0] ?? (await detectBaseBranch());

  if (!base) {
    console.error(
      "error: could not detect base branch. pass it as argument: lore pr <base>",
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

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderMarkdown(report));
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
