import { SCHEMA_VERSION } from "./constants.js";

/** File-level attribution record stored in each git note entry. */
export interface FileEntry {
  path: string;
  by_ai: boolean;
  generated?: boolean;
  /** True when `.agentnoteignore` removes the file from AI ratio only. */
  ai_ratio_excluded?: boolean;
}

/** Line-level attribution counts when blob-based attribution is available. */
export interface AttributionLines {
  ai_added: number;
  total_added: number;
  deleted: number;
}

/** Commit-level AI attribution summary persisted in git notes. */
export interface Attribution {
  ai_ratio: number;
  method: "line" | "file" | "none";
  lines?: AttributionLines;
}

/** Display-only context shown before a short prompt in PR Report and Dashboard. */
export interface InteractionContext {
  kind: "reference" | "scope";
  source: "previous_response" | "current_response";
  text: string;
}

/** Stable structural evidence used by renderers to choose prompt display density. */
export type PromptSelectionSignal =
  | "primary_edit_turn"
  | "exact_commit_path"
  | "commit_file_basename"
  | "diff_identifier"
  | "response_exact_commit_path"
  | "response_basename_or_identifier"
  | "commit_subject_overlap"
  | "list_or_checklist_shape"
  | "multi_line_instruction"
  | "inline_code_or_path_shape"
  | "substantive_prompt_shape"
  | "before_commit_boundary"
  | "between_non_excluded_prompts";

/** Persisted prompt-selection metadata; score, role, and level are derived at runtime. */
export interface InteractionSelection {
  schema: 1;
  source: "primary" | "window" | "tail" | "fallback";
  signals: PromptSelectionSignal[];
}

/** One prompt/response pair stored in an Agent Note git note. */
export interface Interaction {
  prompt: string;
  response: string | null;
  context?: string;
  contexts?: InteractionContext[];
  files_touched?: string[];
  line_stats?: Record<string, { added: number; deleted: number }>;
  tools?: string[] | null;
  selection?: InteractionSelection;
}

/** Runtime-only role used to score prompt importance without changing stored notes. */
export type PromptSelectionRole =
  | "primary"
  | "direct_anchor"
  | "scope"
  | "tail"
  | "anchored_bridge"
  | "bridge"
  | "background";

/** Runtime-only prompt display level derived from selection evidence. */
export type PromptRuntimeLevel = "low" | "medium" | "high";

/** Runtime-only prompt scoring result used by PR Report and CLI preview filters. */
export type PromptRuntimeSelection = {
  score: number;
  role: PromptSelectionRole;
  level: PromptRuntimeLevel;
};

/** Public prompt rendering preset accepted by CLI and GitHub Action inputs. */
export type PromptDetail = "compact" | "full";

/** Default prompt rendering preset for PR Report output. */
export const DEFAULT_PROMPT_DETAIL: PromptDetail = "compact";

const LEGACY_PROMPT_SCORE = 100;
const PERCENT_DENOMINATOR = 100;
const PRIMARY_SCORE_FLOOR = 80;
const HIGH_SCORE_THRESHOLD = 75;
const MEDIUM_SCORE_THRESHOLD = 45;
const BRIDGE_SCORE_MAX_WITH_SUBSTANTIVE = 55;
const BRIDGE_SCORE_MAX_WITHOUT_SUBSTANTIVE = 44;
const ANCHORED_BRIDGE_SCORE_MAX = 65;
const UNANCHORED_TAIL_SCORE_MAX = 44;
const SHORT_PROMPT_MAX_CHARS = 120;
const SHORT_PROMPT_MAX_WORDS = 12;

const PROMPT_ROLE_BASE_SCORES = {
  primary: 90,
  direct_anchor: 75,
  scope: 60,
  tail: 45,
  anchored_bridge: 45,
  bridge: 25,
  background: 15,
} as const satisfies Record<PromptSelectionRole, number>;

const PROMPT_ROLE_SCORE_CLAMPS = {
  primary: [80, 100],
  direct_anchor: [65, 95],
  scope: [50, 80],
  tail: [35, 70],
  anchored_bridge: [40, 65],
  bridge: [20, 55],
  background: [0, 30],
} as const satisfies Record<PromptSelectionRole, readonly [number, number]>;

const PROMPT_SIGNAL_SCORES = {
  primary_edit_turn: 0,
  exact_commit_path: 30,
  commit_file_basename: 10,
  diff_identifier: 20,
  response_exact_commit_path: 18,
  response_basename_or_identifier: 10,
  commit_subject_overlap: 4,
  list_or_checklist_shape: 10,
  multi_line_instruction: 6,
  inline_code_or_path_shape: 6,
  substantive_prompt_shape: 12,
  before_commit_boundary: 5,
  between_non_excluded_prompts: 8,
} as const satisfies Record<PromptSelectionSignal, number>;

/** Current git note schema written for each commit. */
export interface AgentnoteEntry {
  v: number;
  agent?: string | null;
  session_id: string;
  timestamp: string;
  model?: string | null;
  interactions: Interaction[];
  files: FileEntry[];
  attribution: Attribution;
}

/** Aggregated line attribution counts passed into entry construction. */
export interface LineCounts {
  aiAddedLines: number;
  totalAddedLines: number;
  deletedLines: number;
}

// Best-effort generated-artifact heuristics grouped by ecosystem so each rule
// stays explainable when we broaden support across languages and frameworks.
const GENERATED_DIR_SEGMENTS = new Set([
  // Web / JS / TS build outputs
  ".next",
  ".nuxt",
  "coverage",
  // Monorepo / remote-cache build outputs
  ".turbo",
  ".yarn",
  "bazel-bin",
  "bazel-out",
  "bazel-testlogs",
  // Mobile / Flutter build caches
  ".dart_tool",
  "DerivedData",
]);
const GENERATED_FILE_NAMES = new Set([
  // Flutter tool-managed dependency snapshot
  ".flutter-plugins-dependencies",
  // Flutter desktop / mobile plugin registrants
  "generated_plugin_registrant.dart",
  "GeneratedPluginRegistrant.java",
  "GeneratedPluginRegistrant.swift",
  "GeneratedPluginRegistrant.m",
  "GeneratedPluginRegistrant.h",
]);
const GENERATED_FILE_SUFFIXES = [
  // Web / TS / GraphQL / OpenAPI codegen
  ".gen.ts",
  ".gen.tsx",
  ".generated.js",
  ".generated.jsx",
  ".generated.ts",
  ".generated.tsx",
  // Dart / Flutter codegen
  ".chopper.dart",
  ".config.dart",
  ".freezed.dart",
  ".g.dart",
  ".gr.dart",
  ".mocks.dart",
  ".pb.dart",
  ".pbjson.dart",
  ".pbenum.dart",
  ".pbserver.dart",
  // Go codegen
  ".pb.go",
  ".pb.gw.go",
  ".twirp.go",
  ".gen.go",
  ".generated.go",
  "_gen.go",
  "_generated.go",
  "_string.go",
  // Rust codegen
  ".generated.rs",
  ".pb.rs",
  "_generated.rs",
  // Kotlin / Swift codegen
  ".g.kt",
  ".gen.kt",
  ".generated.kt",
  ".g.swift",
  ".generated.swift",
  // Web sourcemaps
  ".map",
];
const GENERATED_CONTENT_PATTERNS = [
  // Cross-language generator banners used by protoc, sqlc, stringer, bindgen, etc.
  /\bcode generated\b[\s\S]{0,160}\bdo not edit\b/i,
  /\bautomatically generated by\b/i,
  /\bthis file was generated by\b/i,
  // Annotation-style banners commonly used in Java / Kotlin / JS ecosystems.
  /\B@generated\b/i,
  // Named generators across Web, mobile, backend, and protobuf toolchains.
  /\bgenerated by (?:swiftgen|sourcery|protoc|buf|sqlc|openapi(?:-generator)?|openapitools|wire|freezed|build_runner|mockgen|rust-bindgen|apollo|drift|flutterfire|ksp)\b/i,
];

/** Detect generated artifacts from path patterns before counting AI ratio. */
export function isGeneratedArtifactPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => GENERATED_DIR_SEGMENTS.has(segment))) {
    return true;
  }

  const basename = segments.at(-1) ?? normalized;
  if (GENERATED_FILE_NAMES.has(basename)) return true;
  return GENERATED_FILE_SUFFIXES.some((suffix) => basename.endsWith(suffix));
}

/** Detect generated-artifact banners from a small content header sample. */
export function hasGeneratedArtifactMarkers(content: string): boolean {
  const header = content.slice(0, 2048).toLowerCase();
  return GENERATED_CONTENT_PATTERNS.some((pattern) => pattern.test(header));
}

/** Remove generated or user-excluded files from the file-level AI ratio denominator. */
export function filterAiRatioEligibleFiles(files: FileEntry[]): FileEntry[] {
  return files.filter(
    (file) => !file.generated && !file.ai_ratio_excluded && !isGeneratedArtifactPath(file.path),
  );
}

/** Count AI-authored and total files after AI ratio exclusions are applied. */
export function countAiRatioEligibleFiles(files: FileEntry[]): { total: number; ai: number } {
  const eligible = filterAiRatioEligibleFiles(files);
  return {
    total: eligible.length,
    ai: eligible.filter((file) => file.by_ai).length,
  };
}

/** Normalize legacy `context` and current `contexts[]` into a deduplicated list. */
export function normalizeInteractionContexts(interaction: {
  context?: string;
  contexts?: InteractionContext[];
}): InteractionContext[] {
  const normalized: InteractionContext[] = [];
  const seen = new Set<string>();

  const add = (context: InteractionContext | undefined) => {
    const text = context?.text.trim();
    if (!context || !text) return;
    const key = text;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({ kind: context.kind, source: context.source, text });
  };

  const legacy = interaction.context?.trim();
  if (legacy) {
    add({ kind: "reference", source: "previous_response", text: legacy });
  }

  for (const context of interaction.contexts ?? []) {
    add(context);
  }

  return normalized;
}

/** Parse public prompt_detail input, keeping `standard` as a legacy compact alias. */
export function parsePromptDetail(value: string | null | undefined): PromptDetail {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return DEFAULT_PROMPT_DETAIL;
  if (normalized === "standard") return "compact";
  if (normalized === "compact" || normalized === "full") {
    return normalized;
  }
  throw new Error("prompt_detail must be one of: compact, full");
}

/** Decide whether an interaction should be shown for the selected prompt preset. */
export function shouldRenderInteractionByPromptDetail(
  interaction: Pick<Interaction, "prompt" | "selection">,
  detail: PromptDetail,
): boolean {
  const runtime = resolvePromptRuntimeSelection(interaction.selection, interaction);
  if (detail === "full") return true;
  return runtime.level !== "low";
}

/**
 * Filter a commit's interaction list for the selected prompt preset.
 *
 * The compact preset keeps current-work review prompts, but suppresses
 * background review prompts whose only strong evidence comes from a response
 * about an external PR/issue and is later covered by an actual primary edit.
 */
export function filterInteractionsByPromptDetail(
  interactions: Interaction[],
  detail: PromptDetail,
): Interaction[] {
  if (detail === "full") return interactions;
  return interactions.filter((interaction, index) => {
    if (!shouldRenderInteractionByPromptDetail(interaction, detail)) return false;
    return !isAbsorbedExternalReviewPrompt(interaction, interactions.slice(index + 1));
  });
}

/** Recompute prompt score, role, and level from stable persisted selection evidence. */
export function resolvePromptRuntimeSelection(
  selection: InteractionSelection | undefined,
  interaction: Pick<Interaction, "prompt">,
): PromptRuntimeSelection {
  if (!selection) return { score: LEGACY_PROMPT_SCORE, role: "primary", level: "high" };
  const signals = runtimePromptSelectionSignals(selection.signals, interaction.prompt);
  const role = resolvePromptRuntimeRole(selection.source, signals, interaction.prompt);
  const score = scorePromptRuntime({ role, signals });
  return { score, role, level: resolvePromptRuntimeLevel({ score, role }) };
}

/** Resolve a runtime role from provenance, stable signals, and prompt shape. */
export function resolvePromptRuntimeRole(
  source: InteractionSelection["source"],
  signals: PromptSelectionSignal[],
  prompt: string,
): PromptSelectionRole {
  if (source === "primary" || signals.includes("primary_edit_turn")) return "primary";
  if (signals.includes("exact_commit_path") || signals.includes("diff_identifier")) {
    return "direct_anchor";
  }
  if (isShortSelectionPrompt(prompt) && hasBridgeAnchorSignal(signals)) {
    return "anchored_bridge";
  }
  if (hasScopeSignal(signals)) return "scope";
  if (source === "tail") return "tail";
  if (isShortSelectionPrompt(prompt) && signals.includes("between_non_excluded_prompts")) {
    return "bridge";
  }
  return "background";
}

/** Score prompt importance within the bounds of its runtime role. */
export function scorePromptRuntime(opts: {
  role: PromptSelectionRole;
  signals: PromptSelectionSignal[];
}): number {
  let score = roleBaseScore(opts.role);
  for (const signal of opts.signals) score += signalScore(signal);
  const [min, max] = roleScoreClamp(opts.role);
  score = Math.max(min, Math.min(score, max));
  if (opts.role === "primary") return Math.max(score, PRIMARY_SCORE_FLOOR);
  if (opts.role === "bridge") {
    const maxBridgeScore = opts.signals.includes("substantive_prompt_shape")
      ? BRIDGE_SCORE_MAX_WITH_SUBSTANTIVE
      : BRIDGE_SCORE_MAX_WITHOUT_SUBSTANTIVE;
    return Math.min(score, maxBridgeScore);
  }
  if (opts.role === "anchored_bridge") return Math.min(score, ANCHORED_BRIDGE_SCORE_MAX);
  if (opts.role === "tail" && !hasTailStructuralAnchorSignal(opts.signals)) {
    return Math.min(score, UNANCHORED_TAIL_SCORE_MAX);
  }
  return score;
}

/** Convert runtime score and role into the low/medium/high display band. */
export function resolvePromptRuntimeLevel(runtime: {
  score: number;
  role: PromptSelectionRole;
}): PromptRuntimeLevel {
  if (runtime.role === "primary") return "high";
  if (runtime.role === "bridge") return runtime.score >= MEDIUM_SCORE_THRESHOLD ? "medium" : "low";
  if (runtime.role === "anchored_bridge") {
    return runtime.score >= MEDIUM_SCORE_THRESHOLD ? "medium" : "low";
  }
  if (runtime.score >= HIGH_SCORE_THRESHOLD) return "high";
  if (runtime.score >= MEDIUM_SCORE_THRESHOLD) return "medium";
  return "low";
}

function roleBaseScore(role: PromptSelectionRole): number {
  return PROMPT_ROLE_BASE_SCORES[role];
}

function roleScoreClamp(role: PromptSelectionRole): [number, number] {
  return [...PROMPT_ROLE_SCORE_CLAMPS[role]];
}

function signalScore(signal: PromptSelectionSignal): number {
  return PROMPT_SIGNAL_SCORES[signal];
}

function hasBridgeAnchorSignal(signals: PromptSelectionSignal[]): boolean {
  return (
    signals.includes("exact_commit_path") ||
    signals.includes("diff_identifier") ||
    signals.includes("commit_file_basename")
  );
}

function hasTailStructuralAnchorSignal(signals: PromptSelectionSignal[]): boolean {
  return (
    signals.includes("exact_commit_path") ||
    signals.includes("diff_identifier") ||
    signals.includes("commit_file_basename") ||
    signals.includes("inline_code_or_path_shape") ||
    signals.includes("substantive_prompt_shape")
  );
}

function hasScopeSignal(signals: PromptSelectionSignal[]): boolean {
  return signals.includes("list_or_checklist_shape") || signals.includes("multi_line_instruction");
}

/** Detect short prompts that may need neighboring context to be meaningful. */
export function isShortSelectionPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return true;
  return (
    trimmed.length <= SHORT_PROMPT_MAX_CHARS &&
    trimmed.split(/\s+/).length <= SHORT_PROMPT_MAX_WORDS
  );
}

/** Detect substantial prompt shape without language-specific keyword lists. */
export function hasSubstantivePromptShape(text: string): boolean {
  const trimmed = text.trim();
  const compact = trimmed.replace(/\s+/g, "");
  if (!compact) return false;
  const wordTokens = text.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const hasCjkOrHangul =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(trimmed);
  if (wordTokens.length >= 7) return true;
  if (wordTokens.length >= 4 && (/[?？]/.test(trimmed) || hasCjkOrHangul)) return true;
  return hasCjkOrHangul && [...compact].length >= 12;
}

function runtimePromptSelectionSignals(
  signals: PromptSelectionSignal[],
  prompt: string,
): PromptSelectionSignal[] {
  if (signals.includes("substantive_prompt_shape") || !hasSubstantivePromptShape(prompt)) {
    return signals;
  }
  return [...signals, "substantive_prompt_shape"];
}

function isAbsorbedExternalReviewPrompt(
  interaction: Interaction,
  laterInteractions: Interaction[],
): boolean {
  const selection = interaction.selection;
  if (!selection || selection.source !== "window") return false;
  if ((interaction.files_touched?.length ?? 0) > 0) return false;
  if (!hasExternalWorkReference(interaction.prompt)) return false;
  if (!hasResponseAnchorSignal(selection.signals)) return false;
  if (hasCurrentPromptAnchorSignal(selection.signals)) return false;
  return laterInteractions.some(hasPrimaryEditInteraction);
}

function hasExternalWorkReference(prompt: string): boolean {
  return /https?:\/\/\S+\/(?:pull|issues)\/\d+\b/i.test(prompt);
}

function hasResponseAnchorSignal(signals: PromptSelectionSignal[]): boolean {
  return (
    signals.includes("response_exact_commit_path") ||
    signals.includes("response_basename_or_identifier")
  );
}

function hasCurrentPromptAnchorSignal(signals: PromptSelectionSignal[]): boolean {
  return (
    signals.includes("primary_edit_turn") ||
    signals.includes("exact_commit_path") ||
    signals.includes("commit_file_basename") ||
    signals.includes("diff_identifier") ||
    signals.includes("list_or_checklist_shape") ||
    signals.includes("multi_line_instruction") ||
    signals.includes("inline_code_or_path_shape")
  );
}

function hasPrimaryEditInteraction(interaction: Interaction): boolean {
  if ((interaction.files_touched?.length ?? 0) > 0) return true;
  const selection = interaction.selection;
  return (
    selection?.source === "primary" || selection?.signals.includes("primary_edit_turn") === true
  );
}

/**
 * Calculate AI ratio.
 * When line counts are available, uses line-level ratio (added lines only).
 * Falls back to file-count ratio when blob data is unavailable.
 */
export function calcAiRatio(files: FileEntry[], lineCounts?: LineCounts): number {
  if (lineCounts && lineCounts.totalAddedLines > 0) {
    return Math.round((lineCounts.aiAddedLines / lineCounts.totalAddedLines) * PERCENT_DENOMINATOR);
  }
  const eligible = countAiRatioEligibleFiles(files);
  if (eligible.total === 0) return 0;
  return Math.round((eligible.ai / eligible.total) * PERCENT_DENOMINATOR);
}

/** Determine attribution method from available data. */
function resolveMethod(lineCounts?: LineCounts): "line" | "file" | "none" {
  if (!lineCounts) return "file";
  if (lineCounts.totalAddedLines === 0) return "none";
  return "line";
}

/** Build the final git-note entry from collected session, attribution, and prompt data. */
export function buildEntry(opts: {
  agent?: string | null;
  sessionId: string;
  model?: string | null;
  interactions: Interaction[];
  commitFiles: string[];
  aiFiles: string[];
  generatedFiles?: string[];
  aiRatioExcludedFiles?: string[];
  lineCounts?: LineCounts;
  /** Per-interaction tools, keyed by interaction index. null = no data. */
  interactionTools?: Map<number, string[] | null>;
}): AgentnoteEntry {
  const generatedFiles = new Set(opts.generatedFiles ?? []);
  const aiRatioExcludedFiles = new Set(opts.aiRatioExcludedFiles ?? []);
  const files: FileEntry[] = opts.commitFiles.map((path) => ({
    path,
    by_ai: opts.aiFiles.includes(path),
    ...(generatedFiles.has(path) ? { generated: true } : {}),
    ...(aiRatioExcludedFiles.has(path) ? { ai_ratio_excluded: true } : {}),
  }));

  const method = resolveMethod(opts.lineCounts);
  const aiRatio = method === "none" ? 0 : calcAiRatio(files, opts.lineCounts);

  const attribution: Attribution = { ai_ratio: aiRatio, method };
  if (opts.lineCounts) {
    attribution.lines = {
      ai_added: opts.lineCounts.aiAddedLines,
      total_added: opts.lineCounts.totalAddedLines,
      deleted: opts.lineCounts.deletedLines,
    };
  }

  const interactions = opts.interactions.map((i, idx) => {
    const base: Interaction = { prompt: i.prompt, response: i.response };
    const contexts = normalizeInteractionContexts(i);
    if (contexts.length > 0) {
      base.contexts = contexts;
    }
    if (i.files_touched && i.files_touched.length > 0) {
      base.files_touched = i.files_touched;
    }
    if (i.selection) {
      base.selection = {
        schema: i.selection.schema,
        source: i.selection.source,
        signals: [...i.selection.signals],
      };
    }
    // Attach tools from interactionTools map (preserving null), or inherit from interaction.
    if (opts.interactionTools?.has(idx)) {
      base.tools = opts.interactionTools.get(idx) ?? null;
    } else if (i.tools !== undefined) {
      base.tools = i.tools;
    }
    return base;
  });

  return {
    v: SCHEMA_VERSION,
    agent: opts.agent ?? null,
    session_id: opts.sessionId,
    timestamp: new Date().toISOString(),
    model: opts.model ?? null,
    interactions,
    files,
    attribution,
  };
}
