import type {
  Interaction,
  InteractionSelection,
  PromptRuntimeSelection,
  PromptSelectionSignal,
} from "./entry.js";
import {
  hasSubstantivePromptShape,
  isShortSelectionPrompt,
  resolvePromptRuntimeLevel,
  resolvePromptRuntimeRole,
  scorePromptRuntime,
} from "./entry.js";
import type { CommitContextSignature } from "./interaction-context.js";

/** Prompt-consumption markers that prevent stale prompt windows from reviving. */
export type ConsumedPromptState = {
  legacyPromptIds: Set<string>;
  promptFilePairs: Set<string>;
  tailPromptIds: Set<string>;
};

/** Prompt entries selected for display plus rows that should be marked consumed. */
type PromptWindowSelection = {
  selected: Record<string, unknown>[];
  consumed: Record<string, unknown>[];
};

/** Stable, language-neutral evidence used to score one prompt at runtime. */
export type PromptSelectionCandidate = {
  prompt: string;
  response: string | null;
  turn: number;
  promptId?: string;
  source: InteractionSelection["source"];
  isPrimaryTurn: boolean;
  isTail: boolean;
  isBeforeCommitBoundary: boolean;
  hasAdjacentNonExcludedPrompt: boolean;
  commitFiles: string[];
  commitSubject: string;
  diffIdentifiers: Set<string>;
};

/** Runtime analysis plus the stable subset that may be persisted in git notes. */
export type PromptSelectionAnalysis = {
  runtime: PromptRuntimeSelection;
  source: InteractionSelection["source"];
  signals: PromptSelectionSignal[];
  hardExcluded: boolean;
};

/** Normalized prompt-window row with policy state derived from one prompt entry. */
type PromptWindowRow = {
  entry: Record<string, unknown>;
  source: InteractionSelection["source"];
  windowFileRefScore: number;
  windowShapeScore: number;
  windowTextScore: number;
  hasResponseAnchor: boolean;
  isQuotedHistory: boolean;
  isTinyPrompt: boolean;
  isPrimaryTurn: boolean;
  isTail: boolean;
  isWithinCommitWindow: boolean;
  isBeforeCommitBoundary: boolean;
  isNonPrimaryEditTurn: boolean;
  isConsumedTailPrompt: boolean;
  hasPostPrimaryEditBarrier: boolean;
};

/** In-memory provenance marker attached before interactions are converted to notes. */
const PROMPT_SELECTION_SOURCE = Symbol("agentnotePromptSelectionSource");
/** In-memory marker for prompt entries that sit on the commit boundary. */
const PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY = Symbol(
  "agentnotePromptSelectionBeforeCommitBoundary",
);

/** Prompt entry shape after prompt-window selection attaches non-persisted markers. */
type PromptEntryWithSelectionMetadata = Record<string, unknown> & {
  [PROMPT_SELECTION_SOURCE]?: InteractionSelection["source"];
  [PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY]?: boolean;
};

/** Maximum number of selected prompt rows preserved for one commit note. */
const PROMPT_WINDOW_MAX_ENTRIES = 24;
/** Minimal subject/path token overlap that can anchor a prompt window. */
const PROMPT_WINDOW_ANCHOR_TEXT_SCORE = 2;
/** Minimal file-reference score that can anchor a prompt window. */
const PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE = 5;
/** Minimal shape score that can anchor a prompt window without text overlap. */
const PROMPT_WINDOW_ANCHOR_SHAPE_SCORE = 44;
/** Version for the stable interaction selection metadata stored in git notes. */
const PROMPT_SELECTION_SCHEMA = 1;
/** Minimum length for obvious quoted prompt/response history blocks. */
const QUOTED_HISTORY_MIN_PROMPT_CHARS = 300;
/** Minimum count of indented lines for long copied transcript snippets. */
const QUOTED_HISTORY_MIN_INDENTED_LINES = 8;
/** Minimum size for indented copied transcript snippets. */
const QUOTED_HISTORY_MIN_INDENTED_PROMPT_CHARS = 500;

/** Select commit-window prompts and consumed markers for commits with known edit turns. */
export function selectPromptWindowEntries(
  promptEntries: Record<string, unknown>[],
  primaryTurns: Set<number>,
  editTurns: Set<number>,
  maxConsumedTurn: number,
  currentTurn: number,
  commitFiles: string[],
  commitSubject: string,
  contextSignature: CommitContextSignature,
  consumedPromptState: ConsumedPromptState,
  responsesByTurn: Map<number, string>,
): PromptWindowSelection {
  if (primaryTurns.size === 0) return emptyPromptWindowSelection();

  const orderedPrimaryTurns = [...primaryTurns].filter((turn) => turn > 0).sort((a, b) => a - b);
  if (orderedPrimaryTurns.length === 0) return emptyPromptWindowSelection();

  return selectCommitPromptWindow(
    promptEntries,
    maxConsumedTurn,
    orderedPrimaryTurns[orderedPrimaryTurns.length - 1] ?? 0,
    currentTurn,
    primaryTurns,
    editTurns,
    commitFiles,
    commitSubject,
    contextSignature,
    consumedPromptState,
    responsesByTurn,
    "window",
  );
}

/** Select prompt-only fallback context when transcript attribution cannot find committed files. */
export function selectPromptOnlyFallbackEntries(
  promptEntries: Record<string, unknown>[],
  maxConsumedTurn: number,
  commitFiles: string[],
  commitSubject: string,
  contextSignature: CommitContextSignature,
  consumedPromptState: ConsumedPromptState,
  responsesByTurn: Map<number, string>,
  currentTurn = Number.POSITIVE_INFINITY,
): PromptWindowSelection {
  const upperTurn = currentTurn > 0 ? currentTurn : Number.POSITIVE_INFINITY;
  const latestPromptTurn = promptEntries.reduce((latest, entry) => {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (turn > upperTurn) return latest;
    return turn > latest ? turn : latest;
  }, 0);
  if (latestPromptTurn <= maxConsumedTurn) return emptyPromptWindowSelection();

  return selectCommitPromptWindow(
    promptEntries,
    maxConsumedTurn,
    latestPromptTurn,
    latestPromptTurn,
    new Set<number>(),
    new Set<number>(),
    commitFiles,
    commitSubject,
    contextSignature,
    consumedPromptState,
    responsesByTurn,
    "fallback",
  );
}

/** Attach persisted selection evidence after interactions have been assembled. */
export function attachInteractionSelections(
  promptEntries: Record<string, unknown>[],
  interactions: Interaction[],
  signature: CommitContextSignature,
  commitSubject: string,
): void {
  const candidates = interactions.map((interaction, index) => {
    const promptEntry = promptEntries[index];
    if (!interaction || !promptEntry) return null;
    return buildPromptSelectionCandidate(interaction, promptEntry, false, signature, commitSubject);
  });
  const nonExcludedIndexes = new Set<number>();
  candidates.forEach((candidate, index) => {
    if (candidate && !analyzePromptSelection(candidate).hardExcluded) {
      nonExcludedIndexes.add(index);
    }
  });

  for (let index = 0; index < interactions.length; index++) {
    const interaction = interactions[index];
    const promptEntry = promptEntries[index];
    if (!interaction || !promptEntry) continue;
    const candidate = buildPromptSelectionCandidate(
      interaction,
      promptEntry,
      hasAdjacentNonExcludedInteraction(index, nonExcludedIndexes),
      signature,
      commitSubject,
    );
    const analysis = analyzePromptSelection(candidate);
    const selection = toPersistedSelection(analysis);
    if (selection) interaction.selection = selection;
  }
}

/** Analyze one prompt without mutating note data or persisting threshold-derived fields. */
export function analyzePromptSelection(
  candidate: PromptSelectionCandidate,
): PromptSelectionAnalysis {
  const hardExcluded = isHardExcludedPromptSelection(candidate);
  if (hardExcluded) {
    return {
      runtime: { score: 0, role: "background", level: "low" },
      source: candidate.source,
      signals: [],
      hardExcluded: true,
    };
  }

  const signals = collectPromptSelectionSignals(candidate);
  const role = resolvePromptRuntimeRole(candidate.source, signals, candidate.prompt);
  const score = scorePromptRuntime({ role, signals });
  return {
    runtime: { score, role, level: resolvePromptRuntimeLevel({ score, role }) },
    source: candidate.source,
    signals,
    hardExcluded: false,
  };
}

/** Convert runtime analysis into the stable git-note schema. */
export function toPersistedSelection(
  analysis: PromptSelectionAnalysis,
): InteractionSelection | null {
  if (analysis.hardExcluded) return null;
  return {
    schema: PROMPT_SELECTION_SCHEMA,
    source: analysis.source,
    signals: analysis.signals,
  };
}

/** Read the temporary in-memory source marker attached during prompt-window selection. */
export function readPromptSelectionSource(
  entry: Record<string, unknown> | undefined,
): InteractionSelection["source"] {
  return (
    (entry as PromptEntryWithSelectionMetadata | undefined)?.[PROMPT_SELECTION_SOURCE] ?? "window"
  );
}

/** Return an empty selection object without sharing mutable arrays. */
function emptyPromptWindowSelection(): PromptWindowSelection {
  return { selected: [], consumed: [] };
}

/** Build the runtime scoring candidate from a selected note interaction. */
function buildPromptSelectionCandidate(
  interaction: Interaction,
  promptEntry: Record<string, unknown>,
  hasAdjacentNonExcludedPrompt: boolean,
  signature: CommitContextSignature,
  commitSubject: string,
): PromptSelectionCandidate {
  const source = readPromptSelectionSource(promptEntry);
  const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
  const promptId = typeof promptEntry.prompt_id === "string" ? promptEntry.prompt_id : undefined;
  return {
    prompt: interaction.prompt,
    response: interaction.response,
    turn,
    promptId,
    source,
    isPrimaryTurn: source === "primary",
    isTail: source === "tail",
    isBeforeCommitBoundary: readPromptSelectionBeforeCommitBoundary(promptEntry),
    hasAdjacentNonExcludedPrompt,
    commitFiles: signature.changedFiles,
    commitSubject,
    diffIdentifiers: signature.codeIdentifiers,
  };
}

/** Return whether a short prompt has neighboring prompts that survived hard exclusion. */
function hasAdjacentNonExcludedInteraction(
  index: number,
  nonExcludedIndexes: Set<number>,
): boolean {
  return nonExcludedIndexes.has(index - 1) || nonExcludedIndexes.has(index + 1);
}

/** Exclude prompts that are structural noise before any score is assigned. */
function isHardExcludedPromptSelection(candidate: PromptSelectionCandidate): boolean {
  if (candidate.isPrimaryTurn) return false;
  return isQuotedPromptHistory(candidate.prompt) || isStructurallyTinyPrompt(candidate.prompt);
}

/** Collect stable structural signals that are safe to persist in git notes. */
function collectPromptSelectionSignals(
  candidate: PromptSelectionCandidate,
): PromptSelectionSignal[] {
  const signals: PromptSelectionSignal[] = [];
  const prompt = candidate.prompt;
  const response = candidate.response ?? "";
  const basenames = candidate.commitFiles.map((file) => fileBasename(file)).filter(Boolean);

  if (candidate.isPrimaryTurn) signals.push("primary_edit_turn");
  if (hasExactCommitPath(prompt, candidate.commitFiles)) signals.push("exact_commit_path");
  if (hasCommitFileBasename(prompt, basenames)) signals.push("commit_file_basename");
  if (hasDiffIdentifier(prompt, candidate.diffIdentifiers)) signals.push("diff_identifier");
  if (response && hasExactCommitPath(response, candidate.commitFiles)) {
    signals.push("response_exact_commit_path");
  }
  if (
    response &&
    (hasCommitFileBasename(response, basenames) ||
      hasDiffIdentifier(response, candidate.diffIdentifiers))
  ) {
    signals.push("response_basename_or_identifier");
  }
  if (hasCommitSubjectOverlap(prompt, candidate.commitSubject)) {
    signals.push("commit_subject_overlap");
  }
  if (hasListOrChecklistShape(prompt)) signals.push("list_or_checklist_shape");
  if (hasMultiLineInstruction(prompt)) signals.push("multi_line_instruction");
  if (hasInlineCodeOrPathShape(prompt)) signals.push("inline_code_or_path_shape");
  if (hasSubstantivePromptShape(prompt)) signals.push("substantive_prompt_shape");
  if (candidate.isBeforeCommitBoundary) signals.push("before_commit_boundary");
  if (isShortSelectionPrompt(prompt) && candidate.hasAdjacentNonExcludedPrompt) {
    signals.push("between_non_excluded_prompts");
  }

  return [...new Set(signals)];
}

/** Return true when text mentions a committed path exactly. */
function hasExactCommitPath(text: string, commitFiles: string[]): boolean {
  const lower = text.toLowerCase();
  return commitFiles.some((file) => lower.includes(file.toLowerCase()));
}

/** Return true when text mentions one of the committed file basenames. */
function hasCommitFileBasename(text: string, basenames: string[]): boolean {
  const lower = text.toLowerCase();
  return basenames.some(
    (basename) => basename.length > 0 && lower.includes(basename.toLowerCase()),
  );
}

/** Extract the final path segment without depending on platform separators. */
function fileBasename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Return true when text mentions a code identifier extracted from the diff. */
function hasDiffIdentifier(text: string, identifiers: Set<string>): boolean {
  for (const identifier of identifiers) {
    if (new RegExp(`\\b${escapeRegExp(identifier)}\\b`).test(text)) return true;
  }
  return false;
}

/** Escape a literal token before building a boundary-aware regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Return true when prompt tokens overlap with the commit subject. */
function hasCommitSubjectOverlap(prompt: string, commitSubject: string): boolean {
  const promptTokens = tokenizePromptSelectionText(prompt);
  const subjectTokens = tokenizePromptSelectionText(commitSubject);
  for (const token of promptTokens) {
    if (subjectTokens.has(token)) return true;
  }
  return false;
}

/** Detect list-like prompts that usually describe work scope. */
function hasListOrChecklistShape(text: string): boolean {
  return /^\s*(?:[-*]|\d+\.)\s/m.test(text);
}

/** Detect multi-line prompts that usually carry more than approval intent. */
function hasMultiLineInstruction(text: string): boolean {
  return (
    text
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0).length >= 2
  );
}

/** Detect inline code, path, or CLI flag shapes without language-specific words. */
function hasInlineCodeOrPathShape(text: string): boolean {
  return (
    /`[^`]+`/.test(text) ||
    /(^|\s)(?:\.{0,2}\/|~\/|[A-Za-z0-9_.-]+\/)[^\s]+/.test(text) ||
    /--[a-z0-9-]+/i.test(text)
  );
}

/**
 * Apply the commit-to-commit prompt-window policy.
 *
 * This keeps the current commit narrative broad enough for review while
 * trimming stale tasks, quoted history, consumed tail prompts, and edit turns
 * that belong to a different commit.
 */
function selectCommitPromptWindow(
  promptEntries: Record<string, unknown>[],
  lowerTurn: number,
  latestPrimaryTurn: number,
  upperTurn: number,
  primaryTurns: Set<number>,
  editTurns: Set<number>,
  commitFiles: string[],
  commitSubject: string,
  contextSignature: CommitContextSignature,
  consumedPromptState: ConsumedPromptState,
  responsesByTurn: Map<number, string>,
  defaultSource: InteractionSelection["source"],
): PromptWindowSelection {
  if (upperTurn <= lowerTurn && primaryTurns.size === 0) return emptyPromptWindowSelection();

  const rows = promptEntries
    .filter((entry) => {
      const turn = typeof entry.turn === "number" ? entry.turn : 0;
      return (turn > lowerTurn && turn <= upperTurn) || primaryTurns.has(turn);
    })
    .sort((left, right) => {
      const leftTurn = typeof left.turn === "number" ? left.turn : 0;
      const rightTurn = typeof right.turn === "number" ? right.turn : 0;
      return leftTurn - rightTurn;
    })
    .map((entry) =>
      buildPromptWindowRow(
        entry,
        primaryTurns,
        editTurns,
        lowerTurn,
        latestPrimaryTurn,
        upperTurn,
        commitFiles,
        commitSubject,
        contextSignature,
        consumedPromptState,
        responsesByTurn,
        defaultSource,
      ),
    );
  const hasCurrentWindowExplanation = rows.some(
    (row) => row.isWithinCommitWindow && isPromptWindowAnchor(row),
  );
  const hadStalePrimaryBeforeWindow = rows.some(
    (row) => row.isPrimaryTurn && !row.isWithinCommitWindow,
  );
  const boundedRows = rows.filter((row) =>
    shouldKeepTaskBoundaryPromptRow(row, hasCurrentWindowExplanation),
  );
  const taskBoundedRows =
    hadStalePrimaryBeforeWindow && hasCurrentWindowExplanation
      ? trimLeadingStaleWindowRows(boundedRows)
      : boundedRows;
  // The task-boundary trim narrows both selected and consumed rows. Leading rows
  // before the first current-task boundary are treated as stale context rather
  // than as prompts this commit should mark consumed.
  markPostPrimaryEditBarriers(taskBoundedRows);

  if (taskBoundedRows.length === 0) return emptyPromptWindowSelection();

  let hardStartIndex = 0;
  while (
    hardStartIndex < taskBoundedRows.length - 1 &&
    isHardTrimPromptRow(taskBoundedRows[hardStartIndex])
  ) {
    hardStartIndex += 1;
  }
  const hardTrimmedRows = taskBoundedRows.slice(0, hardStartIndex);
  const hasQuotedHardTrim = hardTrimmedRows.some((row) => row.isQuotedHistory);
  const firstAnchorIndex = taskBoundedRows.findIndex(
    (row, index) => index >= hardStartIndex && isPromptWindowAnchor(row),
  );
  let startIndex = firstAnchorIndex >= 0 ? firstAnchorIndex : hardStartIndex;
  const softLeadingRows =
    firstAnchorIndex >= 0 ? taskBoundedRows.slice(hardStartIndex, firstAnchorIndex) : [];
  const preserveShortLeadingContext =
    firstAnchorIndex >= 0 &&
    !hasQuotedHardTrim &&
    firstAnchorIndex - hardStartIndex <= 2 &&
    softLeadingRows.every(isLowShapePromptRow);
  if (preserveShortLeadingContext) {
    startIndex = hardStartIndex;
  }

  const consumed = taskBoundedRows.map((row) => attachPromptSelectionMetadata(row));
  const selectedRows = taskBoundedRows.slice(startIndex).filter(shouldKeepPromptWindowRow);
  const selected =
    selectedRows.length > PROMPT_WINDOW_MAX_ENTRIES
      ? trimLongPromptWindow(selectedRows).map(attachPromptSelectionMetadata)
      : selectedRows.map(attachPromptSelectionMetadata);

  return { selected, consumed };
}

/** Drop stale leading rows once the current task has a clear in-window boundary. */
function trimLeadingStaleWindowRows(rows: PromptWindowRow[]): PromptWindowRow[] {
  const taskStartIndex = rows.findIndex(isCurrentTaskBoundaryRow);
  return taskStartIndex > 0 ? rows.slice(taskStartIndex) : rows;
}

/** Return true when a row can start the current task after stale carryover. */
function isCurrentTaskBoundaryRow(row: PromptWindowRow): boolean {
  return row.isPrimaryTurn || row.windowShapeScore >= PROMPT_WINDOW_ANCHOR_SHAPE_SCORE;
}

/**
 * Decide whether an out-of-window primary turn is legitimate split-commit
 * carryover or stale task history.
 */
function shouldKeepTaskBoundaryPromptRow(
  row: PromptWindowRow,
  hasCurrentWindowExplanation: boolean,
): boolean {
  if (row.isWithinCommitWindow) return true;
  if (!row.isPrimaryTurn) return false;

  // Split commits may reuse an older primary prompt only when the current
  // commit has no in-window explanation. If the current window already
  // explains the commit, carrying older primary prompts forward revives stale
  // task history even when files overlap.
  return !hasCurrentWindowExplanation;
}

/** Derive all prompt-window policy flags for one raw prompt entry. */
function buildPromptWindowRow(
  entry: Record<string, unknown>,
  primaryTurns: Set<number>,
  editTurns: Set<number>,
  lowerTurn: number,
  latestPrimaryTurn: number,
  upperTurn: number,
  commitFiles: string[],
  commitSubject: string,
  contextSignature: CommitContextSignature,
  consumedPromptState: ConsumedPromptState,
  responsesByTurn: Map<number, string>,
  defaultSource: InteractionSelection["source"],
): PromptWindowRow {
  const prompt = typeof entry.prompt === "string" ? entry.prompt : "";
  const turn = typeof entry.turn === "number" ? entry.turn : 0;
  const response = responsesByTurn.get(turn) ?? null;
  const isQuotedHistory = isQuotedPromptHistory(prompt);
  const rawTextScore = scorePromptTextOverlap(prompt, commitFiles, commitSubject);
  const isPrimaryTurn = primaryTurns.has(turn);
  const isTail = defaultSource !== "fallback" && !isPrimaryTurn && turn > latestPrimaryTurn;
  const source = resolvePromptSelectionSource(defaultSource, isPrimaryTurn, isTail);
  const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
  const hasConsumedTailPrompt = !!promptId && consumedPromptState.tailPromptIds.has(promptId);
  const analysis = analyzePromptSelection({
    prompt,
    response,
    turn,
    promptId,
    source,
    isPrimaryTurn,
    isTail,
    isBeforeCommitBoundary: turn === upperTurn,
    hasAdjacentNonExcludedPrompt: false,
    commitFiles,
    commitSubject,
    diffIdentifiers: contextSignature.codeIdentifiers,
  });
  return {
    entry,
    source,
    windowFileRefScore: scorePromptFileRefs(prompt, commitFiles),
    windowShapeScore: scoreTextShape(prompt),
    windowTextScore: isQuotedHistory ? Math.floor(rawTextScore * 0.25) : rawTextScore,
    hasResponseAnchor:
      !!response && hasResponsePromptWindowAnchor(response, commitFiles, contextSignature),
    isQuotedHistory,
    isTinyPrompt: analysis.hardExcluded,
    isPrimaryTurn,
    isTail,
    isWithinCommitWindow: turn > lowerTurn && turn <= upperTurn,
    isBeforeCommitBoundary: turn === upperTurn,
    isNonPrimaryEditTurn: editTurns.has(turn) && !isPrimaryTurn,
    // A tail marker is only a display dedupe marker, not edit ownership.
    // Re-evaluate it if the same prompt later owns a committed edit or if
    // Codex needs the prompt-only fallback path. For ordinary prompt windows,
    // do not let an old commit/PR boundary prompt come back as context for a
    // later primary turn.
    isConsumedTailPrompt: defaultSource !== "fallback" && hasConsumedTailPrompt && !isPrimaryTurn,
    hasPostPrimaryEditBarrier: false,
  };
}

/** Mark tail rows that appear after a non-primary edit turn. */
function markPostPrimaryEditBarriers(rows: PromptWindowRow[]): void {
  let seenNonPrimaryTailEdit = false;
  for (const row of rows) {
    if (row.isTail) row.hasPostPrimaryEditBarrier = seenNonPrimaryTailEdit;
    if (row.isTail && row.isNonPrimaryEditTurn) seenNonPrimaryTailEdit = true;
  }
}

/** Final selected-row filter after task-boundary and hard-trim preparation. */
function shouldKeepPromptWindowRow(row: PromptWindowRow): boolean {
  if (row.isPrimaryTurn) return true;
  if (row.isQuotedHistory || row.isTinyPrompt || row.isNonPrimaryEditTurn) return false;
  if (row.isConsumedTailPrompt) return false;
  if (row.isTail) return shouldKeepTailPromptWindowRow(row);
  return true;
}

/** Keep only tail rows that explain the current commit rather than later chatter. */
function shouldKeepTailPromptWindowRow(row: PromptWindowRow): boolean {
  if (row.hasResponseAnchor) return true;
  if (row.hasPostPrimaryEditBarrier) {
    return (
      row.windowFileRefScore >= PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE ||
      row.windowTextScore >= PROMPT_WINDOW_ANCHOR_TEXT_SCORE
    );
  }
  return (
    row.isBeforeCommitBoundary ||
    row.windowFileRefScore >= PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE ||
    row.windowTextScore >= PROMPT_WINDOW_ANCHOR_TEXT_SCORE ||
    row.windowShapeScore >= PROMPT_WINDOW_ANCHOR_SHAPE_SCORE
  );
}

/** Return whether this row is strong enough to anchor the current task window. */
function isPromptWindowAnchor(row: PromptWindowRow): boolean {
  if (row.isPrimaryTurn) return true;
  if (!shouldKeepPromptWindowRow(row)) return false;
  if (row.hasResponseAnchor) return true;
  return (
    row.windowTextScore >= PROMPT_WINDOW_ANCHOR_TEXT_SCORE ||
    row.windowFileRefScore >= PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE ||
    row.windowShapeScore >= PROMPT_WINDOW_ANCHOR_SHAPE_SCORE
  );
}

/** Check whether the assistant response anchors a tail prompt to this commit. */
function hasResponsePromptWindowAnchor(
  response: string,
  commitFiles: string[],
  contextSignature: CommitContextSignature,
): boolean {
  const basenames = commitFiles.map(fileBasename).filter(Boolean);
  return (
    hasExactCommitPath(response, commitFiles) ||
    hasCommitFileBasename(response, basenames) ||
    hasDiffIdentifier(response, contextSignature.codeIdentifiers)
  );
}

/** Resolve the persisted provenance source for a prompt-window row. */
function resolvePromptSelectionSource(
  defaultSource: InteractionSelection["source"],
  isPrimaryTurn: boolean,
  isTail: boolean,
): InteractionSelection["source"] {
  if (defaultSource === "fallback") return "fallback";
  if (isPrimaryTurn) return "primary";
  if (isTail) return "tail";
  return "window";
}

/** Attach temporary in-memory metadata that later becomes stable selection evidence. */
function attachPromptSelectionMetadata(row: PromptWindowRow): Record<string, unknown> {
  const entry = row.entry as PromptEntryWithSelectionMetadata;
  entry[PROMPT_SELECTION_SOURCE] = row.source;
  entry[PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY] = row.isBeforeCommitBoundary;
  return row.entry;
}

/** Read the temporary in-memory commit-boundary marker for a prompt entry. */
function readPromptSelectionBeforeCommitBoundary(
  entry: Record<string, unknown> | undefined,
): boolean {
  return !!(entry as PromptEntryWithSelectionMetadata | undefined)?.[
    PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY
  ];
}

/** Return true for leading rows that should never be preserved as soft context. */
function isHardTrimPromptRow(row: PromptWindowRow): boolean {
  if (row.isPrimaryTurn) return false;
  return (
    row.isQuotedHistory || row.isTinyPrompt || row.isNonPrimaryEditTurn || row.isConsumedTailPrompt
  );
}

/** Return true for weak leading rows that may be kept as short soft context. */
function isLowShapePromptRow(row: PromptWindowRow): boolean {
  return (
    row.windowTextScore < 2 &&
    row.windowFileRefScore < PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE &&
    row.windowShapeScore < 20
  );
}

/** Keep the first row, all primary rows, and the latest remaining rows under the cap. */
function trimLongPromptWindow(rows: PromptWindowRow[]): PromptWindowRow[] {
  const first = rows[0];
  const selected = new Map<number, PromptWindowRow>();
  if (first) selected.set(promptRowTurn(first), first);
  for (const row of rows) {
    if (row.isPrimaryTurn) selected.set(promptRowTurn(row), row);
  }
  const remainingSlots = Math.max(PROMPT_WINDOW_MAX_ENTRIES - selected.size, 0);
  const tail =
    remainingSlots > 0
      ? rows.filter((row) => !selected.has(promptRowTurn(row))).slice(-remainingSlots)
      : [];
  for (const row of tail) selected.set(promptRowTurn(row), row);
  return [...selected.values()].sort((left, right) => promptRowTurn(left) - promptRowTurn(right));
}

/** Read a row turn number for deterministic sorting and map keys. */
function promptRowTurn(row: PromptWindowRow): number {
  return typeof row.entry.turn === "number" ? row.entry.turn : 0;
}

/** Return true for detached continuation prompts that have no useful context. */
function isStructurallyTinyPrompt(prompt: string): boolean {
  return prompt.trim().length <= 1;
}

/** Detect copied prompt/response history blocks that should not become new context. */
function isQuotedPromptHistory(prompt: string): boolean {
  if (/🧑\s*Prompt/.test(prompt) && /🤖\s*Response/.test(prompt)) return true;
  if (
    /\bPrompt:\s/.test(prompt) &&
    /\bResponse:\s/.test(prompt) &&
    prompt.length > QUOTED_HISTORY_MIN_PROMPT_CHARS
  )
    return true;
  const indentedQuoteLines = prompt.match(/^\s{2,}\S/gm)?.length ?? 0;
  return (
    prompt.length > QUOTED_HISTORY_MIN_INDENTED_PROMPT_CHARS &&
    indentedQuoteLines >= QUOTED_HISTORY_MIN_INDENTED_LINES
  );
}

/** Score prompt shape for window anchoring, independent of runtime prompt score. */
function scoreTextShape(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let score = Math.min(Math.floor(trimmed.length / 4), 24);
  const newlines = (trimmed.match(/\n/g) ?? []).length;
  score += Math.min(newlines * 10, 30);
  if (/`[^`]+`/.test(trimmed)) score += 18;
  if (/(^|\s)(?:\.{0,2}\/|~\/|[A-Za-z0-9_.-]+\/)[^\s]+/.test(trimmed)) score += 16;
  if (/--[a-z0-9-]+/i.test(trimmed)) score += 14;
  if (/^\s*(?:[-*]|\d+\.)\s/m.test(trimmed)) score += 20;

  return score;
}

/** Score coarse token overlap between a prompt and the current commit metadata. */
function scorePromptTextOverlap(
  prompt: string,
  commitFiles: string[],
  commitSubject: string,
): number {
  const promptTokens = tokenizePromptSelectionText(prompt);
  const commitTokens = tokenizePromptSelectionText(`${commitSubject}\n${commitFiles.join("\n")}`);
  let score = 0;
  for (const token of promptTokens) {
    if (commitTokens.has(token)) score += token.includes("/") || token.includes(".") ? 4 : 1;
  }
  return score;
}

/** Score exact path, basename, and path-segment references to committed files. */
function scorePromptFileRefs(prompt: string, commitFiles: string[]): number {
  const lowerPrompt = prompt.toLowerCase();
  let score = 0;
  for (const file of commitFiles) {
    const lowerFile = file.toLowerCase();
    if (lowerPrompt.includes(lowerFile)) score += 80;
    const segments = file.split(/[/.]/).filter((segment) => segment.length >= 4);
    for (const segment of segments) {
      if (lowerPrompt.includes(segment.toLowerCase())) score += 5;
    }
    const basename = file.split("/").pop();
    if (basename && lowerPrompt.includes(basename.toLowerCase())) score += 20;
  }
  return score;
}

/** Tokenize prompt-selection text without relying on any natural-language keyword list. */
function tokenizePromptSelectionText(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^\p{L}\p{N}_\-./]+/gu, " ")
    .toLowerCase();
  for (const raw of normalized.split(/\s+/)) {
    if (!raw || raw.length < 2) continue;
    tokens.add(raw);
    for (const part of raw.split(/[./_-]/)) {
      if (part.length >= 3) tokens.add(part);
    }
  }
  return tokens;
}
