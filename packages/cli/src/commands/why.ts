import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, posix, relative, resolve as resolvePath } from "node:path";
import { TRUNCATE_PROMPT, TRUNCATE_RESPONSE_SHOW } from "../core/constants.js";
import {
  type AgentnoteEntry,
  filterInteractionsByPromptDetail,
  type Interaction,
  normalizeInteractionContexts,
} from "../core/entry.js";
import { readNote } from "../core/storage.js";
import { git, gitSafe, repoRoot } from "../git.js";
import { normalizeEntry } from "./normalize.js";

// Match git blame's all-zero pseudo SHA for uncommitted lines.
const ALL_ZERO_COMMIT_RE = /^0{40}$/;
// Parse the header line of each `git blame --porcelain` record.
const BLAME_HEADER_RE = /^([0-9a-f]{40})\s+\d+\s+\d+(?:\s+\d+)?$/i;
// Parse CLI targets in `<path>:<line>:<column>` form.
const COLON_COLUMN_TARGET_RE = /^(.+):(\d+):\d+$/;
// Parse CLI targets in `<path>:<line-end>` form.
const COLON_RANGE_TARGET_RE = /^(.+):(\d+)-(\d+)$/;
// Parse CLI targets in `<path>:<line>` form.
const COLON_LINE_TARGET_RE = /^(.+):(\d+)$/;
// Parse GitHub-style line fragments such as `#L42`, `#L42-L55`, or `#L42C3`.
const LINE_FRAGMENT_RE = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/i;
// Match the segment that separates repository metadata from a GitHub file path.
const GITHUB_BLOB_SEGMENT = "blob";
// Strip a leading `./` before comparing repository-relative paths.
const PATH_PREFIX_RE = /^\.\//;
// Strip the leading marker commonly used when AI agents mention a path.
const AI_PATH_MENTION_PREFIX = "@";
const PERCENT_DENOMINATOR = 100;
const DEFAULT_CONTEXT_LINES = 2;
const DEFAULT_RELATED_INTERACTION_LIMIT = 3;
const RATIO_BAR_WIDTH = 8;
const COMMIT_FORMAT = "%H%x00%h%x00%s%x00%ad%x00%an";

type WhyTarget = {
  path: string;
  startLine: number;
  endLine: number;
};

type BlamedCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  date: string;
  author: string;
};

type RelatedInteraction = {
  interaction: Interaction;
  evidence: "file" | "commit";
};

/** Explain the Agent Note context behind the commit that last changed a line. */
export async function why(args: string[]): Promise<void> {
  const target = await parseWhyTarget(args[0]);
  const blamedShas = await blameTarget(target);

  printTarget(target);

  if (blamedShas.length === 0) {
    console.log("evidence: none");
    console.log("reason:   git blame did not return a committed line");
    return;
  }

  for (let index = 0; index < blamedShas.length; index += 1) {
    if (index > 0) console.log();
    await printBlamedCommit(target, blamedShas[index]);
  }
}

async function parseWhyTarget(value: string | undefined): Promise<WhyTarget> {
  if (!value) {
    printUsageAndExit();
  }

  const parsed = await parseTargetSpecifier(value);
  if (!parsed) {
    printUsageAndExit();
  }

  const { path, startLine, endLine } = parsed;
  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine <= 0 ||
    endLine < startLine
  ) {
    printUsageAndExit();
  }

  return {
    path: await normalizeTargetPath(path),
    startLine,
    endLine,
  };
}

async function parseTargetSpecifier(value: string): Promise<WhyTarget | null> {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const urlTarget = await parseUrlTarget(stripPathMentionPrefix(trimmed));
  if (urlTarget) return urlTarget;

  const fragmentTarget = parseFragmentTarget(trimmed);
  if (fragmentTarget) return fragmentTarget;

  return parseColonTarget(trimmed);
}

async function parseUrlTarget(value: string): Promise<WhyTarget | null> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol === "vscode:" && url.hostname === "file") {
    return parseColonTarget(decodeURIComponent(url.pathname));
  }

  const lineRange = parseLineFragment(url.hash);
  if (!lineRange) return null;

  const decodedPath = decodeURIComponent(url.pathname);
  const githubPath = await parseGitHubBlobPath(decodedPath);
  return githubPath ? { path: githubPath, ...lineRange } : { path: decodedPath, ...lineRange };
}

async function parseGitHubBlobPath(pathname: string): Promise<string | null> {
  const segments = pathname.split("/").filter(Boolean);
  const blobIndex = segments.indexOf(GITHUB_BLOB_SEGMENT);
  if (blobIndex < 0 || blobIndex + 2 >= segments.length) return null;

  const refAndPathSegments = segments.slice(blobIndex + 1);
  const candidates = refAndPathSegments
    .slice(1)
    .map((_, index) => refAndPathSegments.slice(index + 1).join("/"))
    .filter(Boolean);
  const existing = await findExistingRepositoryPath(candidates);
  return existing ?? candidates[0] ?? null;
}

function parseFragmentTarget(value: string): WhyTarget | null {
  const hashIndex = value.lastIndexOf("#");
  if (hashIndex <= 0) return null;

  const lineRange = parseLineFragment(value.slice(hashIndex));
  if (!lineRange) return null;

  return {
    path: value.slice(0, hashIndex),
    ...lineRange,
  };
}

function parseColonTarget(value: string): WhyTarget | null {
  const match =
    COLON_COLUMN_TARGET_RE.exec(value) ??
    COLON_RANGE_TARGET_RE.exec(value) ??
    COLON_LINE_TARGET_RE.exec(value);
  if (!match) {
    return null;
  }

  const startLine = Number(match[2]);
  return {
    path: match[1],
    startLine,
    endLine: match[3] ? Number(match[3]) : startLine,
  };
}

function parseLineFragment(value: string): Pick<WhyTarget, "startLine" | "endLine"> | null {
  const fragment = value.replace(/^#/, "");
  const match = LINE_FRAGMENT_RE.exec(fragment);
  if (!match) return null;

  const startLine = Number(match[1]);
  return {
    startLine,
    endLine: match[2] ? Number(match[2]) : startLine,
  };
}

async function normalizeTargetPath(path: string): Promise<string> {
  const withSlashes = path.replaceAll("\\", "/");
  const normalized = (await stripOptionalPathMentionPrefix(withSlashes)).replace(
    PATH_PREFIX_RE,
    "",
  );
  if (!isAbsolute(normalized)) return normalized;
  const root = await repoRoot();
  return relative(realpathIfExists(root), realpathIfExists(normalized)).replaceAll("\\", "/");
}

async function findExistingRepositoryPath(candidates: string[]): Promise<string | null> {
  const root = await repoRoot();
  return candidates.find((candidate) => existsSync(resolvePath(root, candidate))) ?? null;
}

function stripPathMentionPrefix(value: string): string {
  return value.startsWith(AI_PATH_MENTION_PREFIX)
    ? value.slice(AI_PATH_MENTION_PREFIX.length)
    : value;
}

function realpathIfExists(path: string): string {
  if (!existsSync(path)) return path;
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

async function stripOptionalPathMentionPrefix(value: string): Promise<string> {
  if (!value.startsWith(AI_PATH_MENTION_PREFIX)) return value;
  const withoutPrefix = stripPathMentionPrefix(value);
  if (!withoutPrefix) return value;

  const root = await repoRoot();
  if (existsSync(resolvePath(root, value.replace(PATH_PREFIX_RE, "")))) return value;
  return withoutPrefix;
}

function normalizeComparablePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/").replace(PATH_PREFIX_RE, ""));
  return normalized === "." ? "" : normalized.replace(PATH_PREFIX_RE, "");
}

async function blameTarget(target: WhyTarget): Promise<string[]> {
  const range = `${target.startLine},${target.endLine}`;
  const result = await gitSafe(["blame", "--porcelain", "-L", range, "--", target.path]);
  if (result.exitCode !== 0) return [];
  const shas: string[] = [];
  const seen = new Set<string>();

  for (const line of result.stdout.split("\n")) {
    const match = BLAME_HEADER_RE.exec(line);
    if (!match) continue;
    const sha = match[1];
    if (ALL_ZERO_COMMIT_RE.test(sha) || seen.has(sha)) continue;
    seen.add(sha);
    shas.push(sha);
  }

  return shas;
}

async function printBlamedCommit(target: WhyTarget, sha: string): Promise<void> {
  const commit = await readBlamedCommit(sha);
  console.log("blame:");
  console.log(`  commit: ${commit.shortSha} ${commit.subject}`);
  console.log(`  author: ${commit.author}`);
  console.log(`  date:   ${commit.date}`);

  const raw = await readNote(commit.sha);
  if (!raw) {
    console.log();
    console.log("agent note:");
    console.log("  evidence: none");
    console.log("  reason:   no Agent Note data exists for this commit");
    return;
  }

  let entry: AgentnoteEntry;
  try {
    entry = normalizeEntry(raw);
  } catch {
    console.log();
    console.log("agent note:");
    console.log("  evidence: none");
    console.log("  reason:   Agent Note payload for this commit is invalid");
    return;
  }

  printEntrySummary(entry);
  printRelatedInteractions(target.path, entry);
}

async function readBlamedCommit(sha: string): Promise<BlamedCommit> {
  const output = await git(["show", "-s", `--format=${COMMIT_FORMAT}`, "--date=short", sha]);
  const [fullSha, shortSha, subject, date, author] = output
    .split("\0")
    .map((value) => value.trim());
  return {
    sha: fullSha || sha,
    shortSha: shortSha || sha.slice(0, 7),
    subject: subject || "(no subject)",
    date: date || "-",
    author: author || "-",
  };
}

function printTarget(target: WhyTarget): void {
  const lineSuffix =
    target.startLine === target.endLine
      ? String(target.startLine)
      : `${target.startLine}-${target.endLine}`;
  console.log(`target: ${target.path}:${lineSuffix}`);
  console.log();
}

function printEntrySummary(entry: AgentnoteEntry): void {
  console.log();
  console.log("agent note:");
  console.log(`  agent:       ${entry.agent ?? "-"}`);
  console.log(`  model:       ${entry.model ?? "-"}`);
  console.log(
    `  ai ratio:    ${entry.attribution.ai_ratio}% ${renderRatioBar(entry.attribution.ai_ratio)}`,
  );
  console.log(`  attribution: ${entry.attribution.method}`);
}

function printRelatedInteractions(targetPath: string, entry: AgentnoteEntry): void {
  const related = selectRelatedInteractions(targetPath, entry);
  if (related.length === 0) {
    console.log("  prompts:     none");
    printWhySummary("none");
    return;
  }

  console.log();
  console.log("related prompts:");
  for (let index = 0; index < related.length; index += 1) {
    const item = related[index];
    printInteraction(index + 1, item);
  }

  printWhySummary(`${related[0].evidence}-level Agent Note data`);
}

function printWhySummary(evidence: string): void {
  console.log();
  console.log("why:");
  console.log(`  evidence: ${evidence}`);
  console.log("  note:     exact line-to-prompt attribution is not stored yet");
}

/** Prefer normalized file-level matches, then capped compact commit context as weaker evidence. */
function selectRelatedInteractions(
  targetPath: string,
  entry: AgentnoteEntry,
): RelatedInteraction[] {
  const normalizedTargetPath = normalizeComparablePath(targetPath);
  const fileMatches = entry.interactions
    .filter((interaction) =>
      (interaction.files_touched ?? []).some(
        (filePath) => normalizeComparablePath(filePath) === normalizedTargetPath,
      ),
    )
    .map((interaction) => ({ interaction, evidence: "file" as const }));

  if (fileMatches.length > 0) {
    return fileMatches.slice(0, DEFAULT_RELATED_INTERACTION_LIMIT);
  }

  return filterInteractionsByPromptDetail(entry.interactions, "compact")
    .slice(0, DEFAULT_RELATED_INTERACTION_LIMIT)
    .map((interaction) => ({ interaction, evidence: "commit" as const }));
}

function printInteraction(index: number, item: RelatedInteraction): void {
  const interaction = item.interaction;
  console.log(`  ${index}. evidence: ${item.evidence}`);

  const contexts = normalizeInteractionContexts(interaction).slice(0, DEFAULT_CONTEXT_LINES);
  for (const context of contexts) {
    console.log(`     context: ${truncateLines(context.text, TRUNCATE_RESPONSE_SHOW)}`);
  }

  console.log(`     prompt:  ${truncateLines(interaction.prompt, TRUNCATE_PROMPT)}`);
  if (interaction.response) {
    console.log(`     response: ${truncateLines(interaction.response, TRUNCATE_RESPONSE_SHOW)}`);
  }
  for (const file of interaction.files_touched ?? []) {
    console.log(`     file:    ${file}`);
  }
}

function renderRatioBar(ratio: number): string {
  const clamped = Math.min(PERCENT_DENOMINATOR, Math.max(0, ratio));
  const filled = Math.round((clamped / PERCENT_DENOMINATOR) * RATIO_BAR_WIDTH);
  return `[${"█".repeat(filled)}${"░".repeat(RATIO_BAR_WIDTH - filled)}]`;
}

function truncateLines(text: string, maxLen: number): string {
  const compact = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen)}…`;
}

function printUsageAndExit(): never {
  console.error("usage: agent-note why <target>");
  console.error("example: agent-note why src/app.ts:42");
  console.error("example: agent-note why src/app.ts#L42");
  process.exit(1);
}
