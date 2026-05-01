import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgent, hasAgent } from "../agents/index.js";
import type { TranscriptInteraction } from "../agents/types.js";
import { git, gitSafe } from "../git.js";
import { computePositionAttribution, countLines, parseUnifiedHunks } from "./attribution.js";
import {
  ARCHIVE_ID_RE,
  CHANGES_FILE,
  COMMITTED_PAIRS_FILE,
  EMPTY_BLOB,
  EVENTS_FILE,
  PRE_BLOBS_FILE,
  PROMPTS_FILE,
  TURN_FILE,
} from "./constants.js";
import type {
  Interaction,
  InteractionSelection,
  LineCounts,
  PromptRuntimeSelection,
  PromptSelectionSignal,
} from "./entry.js";
import {
  buildEntry,
  hasGeneratedArtifactMarkers,
  isGeneratedArtifactPath,
  resolvePromptRuntimeLevel,
  resolvePromptRuntimeRole,
  scorePromptRuntime,
} from "./entry.js";
import {
  buildCommitContextSignature,
  type CommitContextSignature,
  composeInteractionContexts,
  selectInteractionContext,
  selectInteractionScopeContext,
  toReferenceContext,
} from "./interaction-context.js";
import { appendJsonl, readJsonlEntries } from "./jsonl.js";
import { readSessionAgent, readSessionTranscriptPath } from "./session.js";
import { readNote, writeNote } from "./storage.js";

type ConsumedPromptState = {
  legacyPromptIds: Set<string>;
  promptFilePairs: Set<string>;
  tailPromptIds: Set<string>;
};

type ConsumedTranscriptPromptFile = {
  turn: number;
  promptId: string;
  file: string;
};

const PROMPT_SELECTION_SOURCE = Symbol("agentnotePromptSelectionSource");
const PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY = Symbol(
  "agentnotePromptSelectionBeforeCommitBoundary",
);

type PromptEntryWithSelectionMetadata = Record<string, unknown> & {
  [PROMPT_SELECTION_SOURCE]?: InteractionSelection["source"];
  [PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY]?: boolean;
};

/** Record an agentnote entry as a git note after a successful commit. */
export async function recordCommitEntry(opts: {
  agentnoteDirPath: string;
  sessionId: string;
  transcriptPath?: string;
}): Promise<{ promptCount: number; aiRatio: number }> {
  const sessionDir = join(opts.agentnoteDirPath, "sessions", opts.sessionId);
  const sessionAgent = await readSessionAgent(sessionDir);
  const agentName = sessionAgent && hasAgent(sessionAgent) ? sessionAgent : "claude";
  const adapter = getAgent(agentName);
  const commitSha = await git(["rev-parse", "HEAD"]);

  // Idempotent: skip if a note already exists for this commit.
  // Prevents double-recording when both `agentnote commit` and post-commit hook run.
  const existingNote = await readNote(commitSha);
  if (existingNote) return { promptCount: 0, aiRatio: 0 };

  // Get files in THIS specific commit.
  let commitFiles: string[] = [];
  try {
    const raw = await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    commitFiles = raw.split("\n").filter(Boolean);
  } catch {
    // empty
  }

  const commitFileSet = new Set(commitFiles);
  let commitSubject = "";
  try {
    commitSubject = await git(["show", "-s", "--format=%s", "HEAD"]);
  } catch {
    // Subject is only a prompt-trimming hint. Recording should still proceed.
  }
  let commitDiffText = "";
  try {
    commitDiffText = await git(["show", "--format=", "--patch", "--unified=0", "HEAD"]);
  } catch {
    // Context is display-only. If diff extraction fails, simply skip code-symbol anchors.
  }
  const contextSignature = buildCommitContextSignature({
    changedFiles: commitFiles,
    diffText: commitDiffText,
    commitSubject,
  });

  // Read all change and prompt entries: current files + any rotated (archived) files
  // from previous turns that have not yet been attributed to a commit.
  const allChangeEntries = await readAllSessionJsonl(sessionDir, CHANGES_FILE);
  const promptEntries = await readAllSessionJsonl(sessionDir, PROMPTS_FILE);

  // Correct async turn drift: PostToolUse (async) may read TURN_FILE after the next
  // prompt has incremented it. Pre-blob entries (sync PreToolUse) have the authoritative
  // turn. Override changeEntries' turn with the pre-blob turn when tool_use_id matches.
  // Same drift can flip `prompt_id` (file_change reads PROMPT_ID_FILE async, which
  // the next UserPromptSubmit may have already overwritten). Pre-blob runs in the
  // synchronous PreToolUse hook with the authoritative id, so mirror the correction.
  const allPreBlobEntries = await readAllSessionJsonl(sessionDir, PRE_BLOBS_FILE);
  const preBlobTurnById = new Map<string, number>();
  const preBlobPromptIdById = new Map<string, string>();
  for (const e of allPreBlobEntries) {
    const id = e.tool_use_id as string | undefined;
    if (!id) continue;
    if (typeof e.turn === "number") preBlobTurnById.set(id, e.turn);
    if (typeof e.prompt_id === "string" && e.prompt_id) preBlobPromptIdById.set(id, e.prompt_id);
  }
  for (const entry of allChangeEntries) {
    const id = entry.tool_use_id as string | undefined;
    if (!id) continue;
    if (preBlobTurnById.has(id)) entry.turn = preBlobTurnById.get(id);
    if (preBlobPromptIdById.has(id)) entry.prompt_id = preBlobPromptIdById.get(id);
  }

  // Filter out (turn, file) pairs already attributed to a previous commit.
  // This prevents re-attribution when archives persist for split-commit support.
  const consumedPairs = await readConsumedPairs(sessionDir);
  const changeEntries = allChangeEntries.filter((e) => !consumedPairs.has(consumedKey(e)));
  const preBlobEntriesForTurnFix = allPreBlobEntries.filter(
    (e) => !consumedPairs.has(consumedKey(e)),
  );
  const consumedPromptState = await readConsumedPromptState(sessionDir);

  // Highest turn already attributed to a previous commit in this session.
  // Prompts from turns <= this are considered "spent" — their own commits
  // already carry them in their notes. Used to trim the prompt window below.
  const maxConsumedTurn = await readMaxConsumedTurn(sessionDir);
  const currentTurn = await readCurrentTurn(sessionDir);

  // Check if turn tracking is available (turn-attributed data has turn fields).
  const hasTurnData = promptEntries.some((e) => typeof e.turn === "number" && e.turn > 0);
  const unconsumedEditTurns = collectSessionEditTurns(changeEntries, preBlobEntriesForTurnFix);
  const commitFileTurns = collectCommitFileTurns(
    changeEntries,
    preBlobEntriesForTurnFix,
    commitFileSet,
  );

  let aiFiles: string[];
  let prompts: string[];
  let relevantPromptEntries: Record<string, unknown>[];
  let promptWindowConsumedEntries: Record<string, unknown>[] = [];
  const relevantTurns = new Set<number>(commitFileTurns.keys());
  let primaryTurns = new Set<number>();

  if (hasTurnData) {
    // Scope data to this commit's files via turn IDs.
    // Include files from both changeEntries (PostToolUse) AND pre-blob entries (PreToolUse)
    // so that a dropped async PostToolUse doesn't silently hide an AI-authored file.
    const aiFileSet = new Set<string>();
    for (const e of changeEntries) {
      const f = e.file as string;
      if (f && commitFileSet.has(f)) aiFileSet.add(f);
    }
    for (const e of preBlobEntriesForTurnFix) {
      const f = e.file as string;
      if (f && commitFileSet.has(f)) aiFileSet.add(f);
    }
    aiFiles = [...aiFileSet];

    relevantPromptEntries = [];
    prompts = [];
  } else {
    // Fallback: no turn data — use all prompts and changes (v1 compat).
    aiFiles = changeEntries.map((e) => e.file as string).filter(Boolean);
    prompts = promptEntries.map((e) => e.prompt as string);
    relevantPromptEntries = promptEntries;
  }

  const generatedFiles = await detectGeneratedFiles(commitSha, commitFiles);
  const attributionCommitFileSet = new Set(
    commitFiles.filter((file) => !generatedFiles.includes(file)),
  );
  const lineAttribution = hasTurnData
    ? await computeLineAttribution({
        sessionDir,
        commitFileSet,
        aiFileSet: new Set(aiFiles),
        generatedFileSet: new Set(generatedFiles),
        relevantTurns,
        hasTurnData,
        changeEntries,
      })
    : { counts: null, contributingTurns: new Set<number>() };
  if (hasTurnData) {
    const fileFallbackTurns = selectFileFallbackPrimaryTurns(commitFileTurns);
    primaryTurns =
      lineAttribution.contributingTurns.size > 0
        ? lineAttribution.contributingTurns
        : fileFallbackTurns.size > 0
          ? fileFallbackTurns
          : new Set(relevantTurns);
    const promptWindow = selectPromptWindowEntries(
      promptEntries,
      primaryTurns,
      unconsumedEditTurns,
      maxConsumedTurn,
      currentTurn,
      commitFiles,
      commitSubject,
      contextSignature,
      consumedPromptState,
    );
    relevantPromptEntries = promptWindow.selected;
    promptWindowConsumedEntries = promptWindow.consumed;
    prompts = relevantPromptEntries.map((e) => e.prompt as string);
  }

  // Resolve transcript path from argument or saved file.
  const transcriptPath =
    opts.transcriptPath ??
    (await readSessionTranscriptPath(sessionDir)) ??
    adapter.findTranscript(opts.sessionId);

  // Build interactions from transcript for accurate prompt-response pairing.
  //
  // Cross-turn commits (edits from multiple turns bundled into one commit) are
  // unsafe to pair via tail slicing — `slice(-prompts.length)` could pull in
  // unrelated interactions. But content-based exact matching is safe even
  // across turns, so we still try that path first.
  let crossTurnCommit = false;
  if (hasTurnData && relevantTurns.size > 0) {
    const minRelevantTurn = Math.min(...relevantTurns);
    crossTurnCommit = minRelevantTurn < currentTurn;
  }

  let interactions: Interaction[];
  let transcriptLineCounts: LineCounts | undefined;
  // Session entries that contributed to this commit's interactions. Passed
  // to recordConsumedPairs so maxConsumedTurn advances even when no
  // file_change/pre_blob entries exist (e.g. Codex transcript-driven path).
  let consumedPromptEntries: Record<string, unknown>[] = [];
  let consumedTranscriptPromptFiles: ConsumedTranscriptPromptFile[] = [];

  // Extract transcript interactions up front. Cross-turn commits tolerate
  // transcript failures (pre-PR #16 behavior); same-turn commits re-throw so
  // commit.ts can warn and skip the note (e.g. Codex requires a readable
  // transcript and intentionally throws on missing files).
  let allInteractions: TranscriptInteraction[] = [];
  if (transcriptPath) {
    try {
      allInteractions = await adapter.extractInteractions(transcriptPath);
    } catch (err) {
      if (!crossTurnCommit) throw err;
      // cross-turn: fall through with no interactions — handled below as prompts-only.
    }
  }

  // Tag each transcript interaction with the prompt_id of its corresponding
  // session prompt. Pairing is a pure map lookup below.
  const transcriptCorrelationStartMs = await readTranscriptCorrelationStartMs(sessionDir);
  correlatePromptIds(allInteractions, promptEntries, transcriptCorrelationStartMs);
  const interactionsById = new Map<string, TranscriptInteraction>();
  for (const i of allInteractions) {
    if (i.prompt_id) interactionsById.set(i.prompt_id, i);
  }

  // Human-only commit shortcut: when turn tracking says this commit has no
  // AI-edited files AND the transcript shows AI editing OTHER files but not
  // this commit's files, leave interactions empty so the empty-note skip
  // below fires. Without this guard a human commit could inherit unrelated
  // AI interactions from the same session.
  //
  // Two restrictions keep this narrow:
  //   1. transcript must reference edits on other files — a shell-only
  //      Codex session legitimately wants the prompt/response preserved
  //      even with no file attribution.
  //   2. transcript must NOT reference commit files — legitimate AI work on
  //      this commit still goes through the pairing path below.
  const transcriptEditsCommit = allInteractions.some((i) =>
    (i.files_touched ?? []).some((f) => commitFileSet.has(f)),
  );
  const transcriptEditsOthers = allInteractions.some((i) => {
    const touched = i.files_touched ?? [];
    return touched.length > 0 && !touched.some((f) => commitFileSet.has(f));
  });
  const promptOnlyFallbackEntries =
    agentName === "codex" &&
    hasTurnData &&
    aiFiles.length === 0 &&
    relevantPromptEntries.length === 0 &&
    maxConsumedTurn > 0 &&
    !transcriptEditsCommit &&
    transcriptEditsOthers
      ? selectPromptOnlyFallbackEntries(
          promptEntries,
          maxConsumedTurn,
          commitFiles,
          commitSubject,
          contextSignature,
          consumedPromptState,
          currentTurn,
        )
      : { selected: [], consumed: [] };
  const canUsePromptOnlyFallback =
    promptOnlyFallbackEntries.selected.length >= 2 &&
    promptOnlyFallbackEntries.selected.some((entry) => {
      const id = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
      return !!id && interactionsById.has(id);
    });
  if (
    hasTurnData &&
    prompts.length === 0 &&
    aiFiles.length === 0 &&
    !transcriptEditsCommit &&
    transcriptEditsOthers &&
    !canUsePromptOnlyFallback
  ) {
    interactions = [];
  } else if (relevantPromptEntries.length > 0) {
    // Session-driven path: session prompts drive the note. Each prompt is
    // paired with its transcript interaction by `prompt_id`. Prompts that
    // lack a `prompt_id` (pre-feature sessions, or the transition commit
    // that introduced it) simply get `response: null` — no text-window
    // heuristic or descending scan.
    interactions = relevantPromptEntries.map((entry) => {
      const id = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
      const matched = id ? interactionsById.get(id) : undefined;
      if (matched) return toRecordedInteraction(matched, commitFileSet, consumedPromptState);
      return { prompt: (entry.prompt as string) ?? "", response: null };
    });
    consumedPromptEntries =
      promptWindowConsumedEntries.length > 0 ? promptWindowConsumedEntries : relevantPromptEntries;

    const transcriptMatched = relevantPromptEntries
      .map((entry) => {
        const id = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
        return id ? interactionsById.get(id) : undefined;
      })
      .filter(
        (i): i is TranscriptInteraction =>
          !!i && (i.files_touched ?? []).some((f) => commitFileSet.has(f)),
      );

    if (transcriptMatched.length > 0) {
      aiFiles = [
        ...new Set(
          transcriptMatched.flatMap((i) =>
            filterInteractionCommitFiles(i, commitFileSet, consumedPromptState),
          ),
        ),
      ];
      transcriptLineCounts = await resolveTranscriptLineCounts(
        attributionCommitFileSet,
        transcriptMatched,
        consumedPromptState,
      );
    }
  } else if (canUsePromptOnlyFallback) {
    relevantPromptEntries = promptOnlyFallbackEntries.selected;
    prompts = promptOnlyFallbackEntries.selected.map((entry) => (entry.prompt as string) ?? "");
    interactions = promptOnlyFallbackEntries.selected.map((entry) => {
      const id = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
      const matched = id ? interactionsById.get(id) : undefined;
      if (matched) return toRecordedInteraction(matched, commitFileSet, consumedPromptState);
      return { prompt: (entry.prompt as string) ?? "", response: null };
    });
    consumedPromptEntries = promptOnlyFallbackEntries.consumed;
  } else if (transcriptPath && allInteractions.length > 0) {
    // Transcript-driven path: sessions that don't emit `file_change` events
    // (e.g. Codex) derive their causal window from transcript interactions.
    const transcriptMatched = allInteractions.filter((i) =>
      (i.files_touched ?? []).some((f) => commitFileSet.has(f)),
    );
    const selectableTranscriptMatched = filterSelectableTranscriptInteractions(
      transcriptMatched,
      promptEntries,
      attributionCommitFileSet,
      consumedPromptState,
      currentTurn,
    );
    const transcriptPrimaryTurns = await selectTranscriptPrimaryTurns(
      selectableTranscriptMatched,
      promptEntries,
      attributionCommitFileSet,
    );
    const transcriptEditTurns = collectTranscriptEditTurns(allInteractions, promptEntries);
    let promptWindow = emptyPromptWindowSelection();
    let useSelectableTranscriptAttribution = false;
    if (transcriptPrimaryTurns.size > 0) {
      promptWindow = selectPromptWindowEntries(
        promptEntries,
        transcriptPrimaryTurns,
        transcriptEditTurns,
        maxConsumedTurn,
        currentTurn,
        commitFiles,
        commitSubject,
        contextSignature,
        consumedPromptState,
      );
    } else if (
      hasUnlinkedCurrentTranscriptEdit(
        allInteractions,
        selectableTranscriptMatched,
        promptEntries,
        maxConsumedTurn,
        currentTurn,
      )
    ) {
      promptWindow = selectPromptOnlyFallbackEntries(
        promptEntries,
        maxConsumedTurn,
        commitFiles,
        commitSubject,
        contextSignature,
        consumedPromptState,
        currentTurn,
      );
    }
    relevantPromptEntries = promptWindow.selected;
    promptWindowConsumedEntries = promptWindow.consumed;
    prompts = relevantPromptEntries.map((entry) => (entry.prompt as string) ?? "");

    if (relevantPromptEntries.length > 0) {
      interactions = relevantPromptEntries.map((entry) => {
        const id = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
        const matched = id ? interactionsById.get(id) : undefined;
        if (matched) return toRecordedInteraction(matched, commitFileSet, consumedPromptState);
        return { prompt: (entry.prompt as string) ?? "", response: null };
      });
      consumedPromptEntries =
        promptWindowConsumedEntries.length > 0
          ? promptWindowConsumedEntries
          : relevantPromptEntries;
      useSelectableTranscriptAttribution = true;
    } else if (
      selectableTranscriptMatched.length > 0 &&
      (promptEntries.length === 0 || transcriptPrimaryTurns.size > 0)
    ) {
      // No session prompts at all — emit just the edit-linked transcript
      // interactions (e.g. commit with no surviving prompts.jsonl entry). If
      // session prompts exist but none were selected, do not revive old
      // prompt_id-less transcript edits as a last-ditch fallback.
      interactions = selectableTranscriptMatched.map((i) =>
        toRecordedInteraction(i, commitFileSet, consumedPromptState),
      );
      useSelectableTranscriptAttribution = true;
    } else if (!crossTurnCommit && transcriptMatched.length === 0) {
      interactions = selectTranscriptFallbackInteractions(allInteractions, commitFileSet);
    } else {
      interactions = [];
    }

    if (useSelectableTranscriptAttribution && selectableTranscriptMatched.length > 0) {
      aiFiles = [
        ...new Set(
          selectableTranscriptMatched.flatMap((i) =>
            filterInteractionCommitFiles(i, commitFileSet, consumedPromptState),
          ),
        ),
      ];
      transcriptLineCounts = await resolveTranscriptLineCounts(
        attributionCommitFileSet,
        selectableTranscriptMatched,
        consumedPromptState,
      );
      consumedTranscriptPromptFiles = collectConsumedTranscriptPromptFiles(
        selectableTranscriptMatched,
        promptEntries,
        commitFileSet,
        consumedPromptState,
      );
    }
  } else {
    interactions = prompts.map((p) => ({ prompt: p, response: null }));
  }

  await fillInteractionResponsesFromEvents(sessionDir, relevantPromptEntries, interactions);
  await attachInteractionContexts(
    sessionDir,
    promptEntries,
    relevantPromptEntries,
    interactions,
    contextSignature,
    interactionsById,
  );
  attachInteractionSelections(relevantPromptEntries, interactions, contextSignature, commitSubject);

  // Attach per-turn file attribution when turn data is available.
  if (hasTurnData) {
    attachFilesTouched(changeEntries, relevantPromptEntries, interactions, commitFileSet);
  }

  // Read model from session events (SessionStart).
  const model = await readSessionModel(sessionDir);

  // Aggregate per-interaction tools from changeEntries.
  const interactionTools = buildInteractionTools(
    changeEntries,
    relevantPromptEntries,
    commitFileSet,
  );

  // Skip writing an empty note. This happens when a rebased/cherry-picked commit
  // triggers post-commit but session data has already been rotated. Writing an
  // empty note would overwrite valuable data if notes are later copied from the
  // original SHA.
  if (interactions.length === 0 && aiFiles.length === 0) {
    return { promptCount: 0, aiRatio: 0 };
  }

  const entry = buildEntry({
    agent: agentName,
    sessionId: opts.sessionId,
    model,
    interactions,
    commitFiles,
    aiFiles,
    generatedFiles,
    lineCounts: lineAttribution.counts ?? transcriptLineCounts,
    interactionTools,
  });

  await writeNote(commitSha, entry as unknown as Record<string, unknown>);

  // Record consumed (turn, file) pairs so subsequent commits in this session
  // don't re-attribute the same edits. Append-only, not rotated.
  // Pre-blob entries are also recorded: an async PostToolUse drop can leave
  // a commit with only pre_blobs data. Without consuming those, the next
  // commit would see the pre_blobs' turn as "not yet consumed" and leak
  // those prompts into its own note window.
  await recordConsumedPairs(
    sessionDir,
    changeEntries,
    preBlobEntriesForTurnFix,
    commitFileSet,
    consumedPromptEntries,
    consumedTranscriptPromptFiles,
  );

  // Do NOT delete rotated archives here. They are kept available for subsequent
  // split commits in the same turn (each commit scopes its own files via
  // commitFileSet). Archives are purged at the start of the next turn by rotateLogs.

  return { promptCount: interactions.length, aiRatio: entry.attribution.ai_ratio };
}

/**
 * Tag each transcript interaction with the prompt_id of its matching session
 * prompt. Both lists are chronological and the transcript is a superset of
 * the session — so for each distinct prompt text the session's occurrences
 * pair 1:1 against the transcript's from the start.
 *
 * Strict count match: if transcript has FEWER occurrences of a given text
 * than the session (e.g. a dropped hook event), skip the entire text group
 * rather than silently shifting pairs by one. Losing the response on every
 * duplicate is safer than silently attaching the wrong one.
 *
 * When a transcript includes previous runs (for example Claude `--continue`),
 * `transcriptCorrelationStartMs` limits timestamped transcript candidates to
 * the current hook session. Fully timestampless transcripts keep the existing
 * pairing behavior; mixed timestamp data prefers timestamped current-session
 * candidates for each prompt text and skips ambiguous partial matches.
 *
 * Mutates `interactions` in place.
 */
function correlatePromptIds(
  interactions: TranscriptInteraction[],
  sessionPromptEntries: Record<string, unknown>[],
  transcriptCorrelationStartMs: number | null = null,
): void {
  const effectiveCorrelationStartMs = hasTranscriptCandidateAtOrAfter(
    interactions,
    transcriptCorrelationStartMs,
  )
    ? transcriptCorrelationStartMs
    : null;
  const sessionTextToIds = new Map<string, string[]>();
  for (const entry of sessionPromptEntries) {
    const text = typeof entry.prompt === "string" ? entry.prompt : undefined;
    const id = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
    if (!text || !id) continue;
    if (!sessionTextToIds.has(text)) sessionTextToIds.set(text, []);
    sessionTextToIds.get(text)?.push(id);
  }

  const txTextToIndices = new Map<string, number[]>();
  const txTextToUntimestampedIndices = new Map<string, number[]>();
  for (let idx = 0; idx < interactions.length; idx++) {
    if (!isTranscriptCorrelationCandidate(interactions[idx], effectiveCorrelationStartMs)) {
      continue;
    }
    const text = interactions[idx].prompt;
    const interactionMs = parseTimestampMs(interactions[idx].timestamp);
    const map =
      effectiveCorrelationStartMs !== null && interactionMs === null
        ? txTextToUntimestampedIndices
        : txTextToIndices;
    if (!map.has(text)) map.set(text, []);
    map.get(text)?.push(idx);
  }

  for (const [text, ids] of sessionTextToIds) {
    const indices = selectTranscriptIndicesForText(
      txTextToIndices.get(text) ?? [],
      txTextToUntimestampedIndices.get(text) ?? [],
      ids.length,
      effectiveCorrelationStartMs,
    );
    if (indices.length < ids.length) continue; // ambiguous — skip this text group
    // Transcript has >= session. Pair the first N transcript occurrences
    // (in chronological order) with session's N prompts; the session is a
    // prefix of the transcript for each text group since both are
    // append-only from session start.
    for (let i = 0; i < ids.length; i++) {
      interactions[indices[i]].prompt_id = ids[i];
    }
  }
}

function selectTranscriptIndicesForText(
  timestampedIndices: number[],
  untimestampedIndices: number[],
  expectedCount: number,
  transcriptCorrelationStartMs: number | null,
): number[] {
  if (transcriptCorrelationStartMs === null) return timestampedIndices;
  if (timestampedIndices.length >= expectedCount) return timestampedIndices;
  if (timestampedIndices.length === 0) return untimestampedIndices;
  return [];
}

function hasTranscriptCandidateAtOrAfter(
  interactions: TranscriptInteraction[],
  transcriptCorrelationStartMs: number | null,
): boolean {
  if (transcriptCorrelationStartMs === null) return true;
  return interactions.some((interaction) => {
    const interactionMs = parseTimestampMs(interaction.timestamp);
    return interactionMs !== null && interactionMs >= transcriptCorrelationStartMs;
  });
}

function isTranscriptCorrelationCandidate(
  interaction: TranscriptInteraction,
  transcriptCorrelationStartMs: number | null,
): boolean {
  if (transcriptCorrelationStartMs === null) return true;
  const interactionMs = parseTimestampMs(interaction.timestamp);
  if (interactionMs === null) return true;
  return interactionMs >= transcriptCorrelationStartMs;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toRecordedInteraction(
  interaction: TranscriptInteraction,
  commitFileSet: Set<string>,
  consumedPromptState?: ConsumedPromptState,
): Interaction {
  const recorded: Interaction = {
    prompt: interaction.prompt,
    response: interaction.response,
  };

  const filesTouched = filterInteractionCommitFiles(
    interaction,
    commitFileSet,
    consumedPromptState,
  );
  if (filesTouched && filesTouched.length > 0) {
    recorded.files_touched = [...new Set(filesTouched)];
  }

  if (interaction.tools !== undefined) {
    recorded.tools = interaction.tools;
  }

  return recorded;
}

function filterInteractionCommitFiles(
  interaction: TranscriptInteraction,
  commitFileSet: Set<string>,
  consumedPromptState?: ConsumedPromptState,
): string[] {
  const files = (interaction.files_touched ?? []).filter((file) => commitFileSet.has(file));
  if (!consumedPromptState || !interaction.prompt_id) return files;
  const promptId = interaction.prompt_id;
  return files.filter(
    (file) => !consumedPromptState.promptFilePairs.has(promptFilePairKey(promptId, file)),
  );
}

function selectTranscriptFallbackInteractions(
  interactions: TranscriptInteraction[],
  commitFileSet: Set<string>,
): Interaction[] {
  const latestToolBacked = [...interactions]
    .reverse()
    .find((interaction) => (interaction.tools?.length ?? 0) > 0);
  return latestToolBacked ? [toRecordedInteraction(latestToolBacked, commitFileSet)] : [];
}

async function fillInteractionResponsesFromEvents(
  sessionDir: string,
  promptEntries: Record<string, unknown>[],
  interactions: Interaction[],
): Promise<void> {
  if (interactions.length === 0 || promptEntries.length === 0) return;

  const responsesByTurn = await readResponsesByTurn(sessionDir);
  if (responsesByTurn.size === 0) return;

  for (let index = 0; index < interactions.length; index++) {
    const interaction = interactions[index];
    const promptEntry = promptEntries[index];
    if (!interaction || !promptEntry || interaction.response) continue;
    const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
    if (!turn) continue;
    const response = responsesByTurn.get(turn);
    if (response) {
      interaction.response = response;
    }
  }
}

async function attachInteractionContexts(
  sessionDir: string,
  allPromptEntries: Record<string, unknown>[],
  promptEntries: Record<string, unknown>[],
  interactions: Interaction[],
  signature: CommitContextSignature,
  interactionsById: Map<string, TranscriptInteraction>,
): Promise<void> {
  if (interactions.length === 0 || promptEntries.length === 0) return;

  const responsesByTurn = await readResponsesByTurn(sessionDir);
  for (const entry of allPromptEntries) {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (!turn || responsesByTurn.has(turn)) continue;
    const id = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
    const response = id ? interactionsById.get(id)?.response?.trim() : "";
    if (response) responsesByTurn.set(turn, response);
  }

  const selectedTurns = new Set(
    promptEntries
      .map((entry) => (typeof entry.turn === "number" ? entry.turn : 0))
      .filter((turn) => turn > 0),
  );

  for (let index = 0; index < interactions.length; index++) {
    const interaction = interactions[index];
    const promptEntry = promptEntries[index];
    if (!interaction || !promptEntry) continue;
    const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
    const reference =
      turn > 1
        ? selectInteractionContext(
            {
              prompt: interaction.prompt,
              previousResponse: responsesByTurn.get(turn - 1) ?? null,
              previousTurnSelected: selectedTurns.has(turn - 1),
            },
            signature,
          )
        : undefined;
    const scope = selectInteractionScopeContext(
      {
        prompt: interaction.prompt,
        response: interaction.response,
      },
      signature,
    );
    const contexts = composeInteractionContexts([
      toReferenceContext(interaction.context ?? reference),
      scope,
    ]);
    if (contexts.length > 0) {
      interaction.contexts = contexts;
      delete interaction.context;
    }
  }
}

function attachInteractionSelections(
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
    isEditTurn: (interaction.files_touched?.length ?? 0) > 0,
    isTail: source === "tail",
    isBeforeCommitBoundary: readPromptSelectionBeforeCommitBoundary(promptEntry),
    hasAdjacentNonExcludedPrompt,
    commitFiles: signature.changedFiles,
    commitSubject,
    diffIdentifiers: signature.codeIdentifiers,
  };
}

function hasAdjacentNonExcludedInteraction(
  index: number,
  nonExcludedIndexes: Set<number>,
): boolean {
  return nonExcludedIndexes.has(index - 1) || nonExcludedIndexes.has(index + 1);
}

async function resolveTranscriptLineCounts(
  commitFileSet: Set<string>,
  interactions: TranscriptInteraction[],
  consumedPromptState?: ConsumedPromptState,
): Promise<LineCounts | undefined> {
  const transcriptStats = new Map<string, { added: number; deleted: number }>();

  for (const interaction of interactions) {
    const eligibleFiles = new Set(
      filterInteractionCommitFiles(interaction, commitFileSet, consumedPromptState),
    );
    for (const [file, stats] of Object.entries(interaction.line_stats ?? {})) {
      if (!eligibleFiles.has(file)) continue;
      const previous = transcriptStats.get(file) ?? { added: 0, deleted: 0 };
      transcriptStats.set(file, {
        added: previous.added + stats.added,
        deleted: previous.deleted + stats.deleted,
      });
    }
  }

  if (transcriptStats.size === 0) return undefined;

  const committedDiffCounts = await readCommittedDiffCounts(commitFileSet);
  if (committedDiffCounts.size !== commitFileSet.size) return undefined;

  let aiAddedLines = 0;
  let totalAddedLines = 0;
  let deletedLines = 0;

  for (const file of commitFileSet) {
    const transcript = transcriptStats.get(file);
    const committed = committedDiffCounts.get(file);
    if (!transcript || !committed) return undefined;
    if (transcript.added !== committed.added || transcript.deleted !== committed.deleted) {
      return undefined;
    }
    aiAddedLines += transcript.added;
    totalAddedLines += committed.added;
    deletedLines += committed.deleted;
  }

  return { aiAddedLines, totalAddedLines, deletedLines };
}

async function readCommittedDiffCounts(
  commitFileSet: Set<string>,
): Promise<Map<string, { added: number; deleted: number }>> {
  const counts = new Map<string, { added: number; deleted: number }>();

  for (const file of commitFileSet) {
    const { stdout, exitCode } = await gitSafe([
      "diff-tree",
      "--patch",
      "--unified=0",
      "--root",
      "--no-commit-id",
      "-r",
      "HEAD",
      "--",
      file,
    ]);
    if (exitCode !== 0 && exitCode !== 1) {
      return new Map();
    }
    const diffCounts = countLines(parseUnifiedHunks(stdout));
    counts.set(file, diffCounts);
  }

  return counts;
}

/** Attach files_touched per interaction, scoped to the current commit's files. */
function attachFilesTouched(
  changeEntries: Record<string, unknown>[],
  promptEntries: Record<string, unknown>[],
  interactions: Interaction[],
  commitFileSet: Set<string>,
): void {
  // Build a map of turn → files (only files in this commit).
  const filesByTurn = new Map<number, Set<string>>();
  for (const entry of changeEntries) {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const file = entry.file as string;
    if (!file || !commitFileSet.has(file)) continue;
    if (!filesByTurn.has(turn)) filesByTurn.set(turn, new Set());
    filesByTurn.get(turn)?.add(file);
  }

  for (let i = 0; i < interactions.length; i++) {
    const promptEntry = promptEntries[i];
    if (!promptEntry) continue;
    const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
    const files = filesByTurn.get(turn);
    if (files && files.size > 0) {
      interactions[i].files_touched = [...files];
    }
  }
}

function collectCommitFileTurns(
  changeEntries: Record<string, unknown>[],
  preBlobEntries: Record<string, unknown>[],
  commitFileSet: Set<string>,
): Map<number, Set<string>> {
  const turns = new Map<number, Set<string>>();

  const addEntry = (entry: Record<string, unknown>) => {
    const file = entry.file as string;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (!file || !commitFileSet.has(file) || turn <= 0) return;
    if (!turns.has(turn)) turns.set(turn, new Set<string>());
    turns.get(turn)?.add(file);
  };

  for (const entry of changeEntries) addEntry(entry);
  for (const entry of preBlobEntries) addEntry(entry);

  return turns;
}

function selectFileFallbackPrimaryTurns(commitFileTurns: Map<number, Set<string>>): Set<number> {
  if (commitFileTurns.size === 0) return new Set<number>();

  const latestTurnByFile = new Map<string, number>();
  for (const [turn, files] of commitFileTurns) {
    for (const file of files) {
      const previous = latestTurnByFile.get(file) ?? 0;
      if (turn > previous) latestTurnByFile.set(file, turn);
    }
  }

  return new Set<number>(latestTurnByFile.values());
}

function collectSessionEditTurns(
  changeEntries: Record<string, unknown>[],
  preBlobEntries: Record<string, unknown>[],
): Set<number> {
  const turns = new Set<number>();
  for (const entry of [...changeEntries, ...preBlobEntries]) {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const file = entry.file as string | undefined;
    if (turn > 0 && file) turns.add(turn);
  }
  return turns;
}

function collectTranscriptEditTurns(
  interactions: TranscriptInteraction[],
  promptEntries: Record<string, unknown>[],
): Set<number> {
  const promptTurnById = buildPromptTurnById(promptEntries);

  const turns = new Set<number>();
  for (const interaction of interactions) {
    if (!interaction.prompt_id || (interaction.files_touched?.length ?? 0) === 0) continue;
    const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
    if (turn > 0) turns.add(turn);
  }
  return turns;
}

function buildPromptTurnById(promptEntries: Record<string, unknown>[]): Map<string, number> {
  const promptTurnById = new Map<string, number>();
  for (const entry of promptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (promptId && turn > 0) promptTurnById.set(promptId, turn);
  }
  return promptTurnById;
}

function promptFilePairKey(promptId: string, file: string): string {
  return `${promptId}\0${file}`;
}

function filterSelectableTranscriptInteractions(
  interactions: TranscriptInteraction[],
  promptEntries: Record<string, unknown>[],
  commitFileSet: Set<string>,
  consumedPromptState: ConsumedPromptState,
  currentTurn: number,
): TranscriptInteraction[] {
  const promptTurnById = buildPromptTurnById(promptEntries);
  return interactions.filter((interaction) => {
    if (!transcriptTouchesCommitFile(interaction, commitFileSet)) return false;
    if (!interaction.prompt_id) return true;

    const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
    if (currentTurn > 0 && turn > currentTurn) return false;
    return !isTranscriptPromptConsumedForCommit(interaction, commitFileSet, consumedPromptState);
  });
}

function transcriptTouchesCommitFile(
  interaction: TranscriptInteraction,
  commitFileSet: Set<string>,
): boolean {
  return (interaction.files_touched ?? []).some((file) => commitFileSet.has(file));
}

function isTranscriptPromptConsumedForCommit(
  interaction: TranscriptInteraction,
  commitFileSet: Set<string>,
  consumedPromptState: ConsumedPromptState,
): boolean {
  const promptId = interaction.prompt_id;
  if (!promptId) return false;
  if (consumedPromptState.legacyPromptIds.has(promptId)) return true;

  const files = (interaction.files_touched ?? []).filter((file) => commitFileSet.has(file));
  return (
    files.length > 0 &&
    files.every((file) =>
      consumedPromptState.promptFilePairs.has(promptFilePairKey(promptId, file)),
    )
  );
}

function hasUnlinkedCurrentTranscriptEdit(
  allInteractions: TranscriptInteraction[],
  interactions: TranscriptInteraction[],
  promptEntries: Record<string, unknown>[],
  maxConsumedTurn: number,
  currentTurn: number,
): boolean {
  const unlinkedMatches = new Set(interactions.filter((interaction) => !interaction.prompt_id));
  if (unlinkedMatches.size === 0) return false;

  const currentPromptIds = new Set<string>();
  for (const entry of promptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (promptId && turn > maxConsumedTurn && (currentTurn <= 0 || turn <= currentTurn)) {
      currentPromptIds.add(promptId);
    }
  }
  if (currentPromptIds.size === 0) return false;

  let sawCurrentPrompt = false;
  for (const interaction of allInteractions) {
    if (interaction.prompt_id && currentPromptIds.has(interaction.prompt_id)) {
      sawCurrentPrompt = true;
    }
    if (sawCurrentPrompt && unlinkedMatches.has(interaction)) return true;
  }
  return false;
}

function collectConsumedTranscriptPromptFiles(
  interactions: TranscriptInteraction[],
  promptEntries: Record<string, unknown>[],
  commitFileSet: Set<string>,
  consumedPromptState?: ConsumedPromptState,
): ConsumedTranscriptPromptFile[] {
  const promptTurnById = buildPromptTurnById(promptEntries);
  const consumed: ConsumedTranscriptPromptFile[] = [];
  const seen = new Set<string>();
  for (const interaction of interactions) {
    if (!interaction.prompt_id) continue;
    const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
    if (turn <= 0) continue;
    for (const file of filterInteractionCommitFiles(
      interaction,
      commitFileSet,
      consumedPromptState,
    )) {
      const key = promptFilePairKey(interaction.prompt_id, file);
      if (seen.has(key)) continue;
      seen.add(key);
      consumed.push({ turn, promptId: interaction.prompt_id, file });
    }
  }
  return consumed;
}

function selectPromptWindowEntries(
  promptEntries: Record<string, unknown>[],
  primaryTurns: Set<number>,
  editTurns: Set<number>,
  maxConsumedTurn: number,
  currentTurn: number,
  commitFiles: string[],
  commitSubject: string,
  contextSignature: CommitContextSignature,
  consumedPromptState: ConsumedPromptState,
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
    "window",
  );
}

function selectPromptOnlyFallbackEntries(
  promptEntries: Record<string, unknown>[],
  maxConsumedTurn: number,
  commitFiles: string[],
  commitSubject: string,
  contextSignature: CommitContextSignature,
  consumedPromptState: ConsumedPromptState,
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
    "fallback",
  );
}

type PromptWindowSelection = {
  selected: Record<string, unknown>[];
  consumed: Record<string, unknown>[];
};

export type PromptSelectionCandidate = {
  prompt: string;
  response: string | null;
  turn: number;
  promptId?: string;
  source: InteractionSelection["source"];
  isPrimaryTurn: boolean;
  isEditTurn: boolean;
  isTail: boolean;
  isBeforeCommitBoundary: boolean;
  hasAdjacentNonExcludedPrompt: boolean;
  commitFiles: string[];
  commitSubject: string;
  diffIdentifiers: Set<string>;
};

export type PromptSelectionAnalysis = {
  runtime: PromptRuntimeSelection;
  source: InteractionSelection["source"];
  signals: PromptSelectionSignal[];
  hardExcluded: boolean;
};

type PromptWindowRow = {
  entry: Record<string, unknown>;
  source: InteractionSelection["source"];
  fileRefScore: number;
  shapeScore: number;
  textScore: number;
  isQuotedHistory: boolean;
  isTinyPrompt: boolean;
  isPrimaryTurn: boolean;
  isTail: boolean;
  isBeforeCommitBoundary: boolean;
  isNonPrimaryEditTurn: boolean;
  isConsumedTailPrompt: boolean;
  hasPostPrimaryEditBarrier: boolean;
};

const PROMPT_WINDOW_MAX_ENTRIES = 24;
const PROMPT_WINDOW_ANCHOR_TEXT_SCORE = 2;
const PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE = 5;
const PROMPT_WINDOW_ANCHOR_SHAPE_SCORE = 44;
const PROMPT_SELECTION_SCHEMA = 1;

function emptyPromptWindowSelection(): PromptWindowSelection {
  return { selected: [], consumed: [] };
}

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

function isHardExcludedPromptSelection(candidate: PromptSelectionCandidate): boolean {
  if (candidate.isPrimaryTurn) return false;
  return isQuotedPromptHistory(candidate.prompt) || isStructurallyTinyPrompt(candidate.prompt);
}

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

function hasExactCommitPath(text: string, commitFiles: string[]): boolean {
  const lower = text.toLowerCase();
  return commitFiles.some((file) => lower.includes(file.toLowerCase()));
}

function hasCommitFileBasename(text: string, basenames: string[]): boolean {
  const lower = text.toLowerCase();
  return basenames.some(
    (basename) => basename.length > 0 && lower.includes(basename.toLowerCase()),
  );
}

function fileBasename(path: string): string {
  return path.split("/").pop() ?? path;
}

function hasDiffIdentifier(text: string, identifiers: Set<string>): boolean {
  for (const identifier of identifiers) {
    if (new RegExp(`\\b${escapeRegExp(identifier)}\\b`).test(text)) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasCommitSubjectOverlap(prompt: string, commitSubject: string): boolean {
  const promptTokens = tokenizePromptSelectionText(prompt);
  const subjectTokens = tokenizePromptSelectionText(commitSubject);
  for (const token of promptTokens) {
    if (subjectTokens.has(token)) return true;
  }
  return false;
}

function hasListOrChecklistShape(text: string): boolean {
  return /^\s*(?:[-*]|\d+\.)\s/m.test(text);
}

function hasMultiLineInstruction(text: string): boolean {
  return (
    text
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0).length >= 2
  );
}

function hasInlineCodeOrPathShape(text: string): boolean {
  return (
    /`[^`]+`/.test(text) ||
    /(^|\s)(?:\.{0,2}\/|~\/|[A-Za-z0-9_.-]+\/)[^\s]+/.test(text) ||
    /--[a-z0-9-]+/i.test(text)
  );
}

function hasSubstantivePromptShape(text: string): boolean {
  const trimmed = text.trim();
  const compact = trimmed.replace(/\s+/g, "");
  if (!compact) return false;
  const wordTokens = text.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  if (wordTokens.length >= 7) return true;
  if (wordTokens.length >= 4 && /[?？]/.test(trimmed)) return true;
  return (
    wordTokens.length <= 2 &&
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(trimmed) &&
    [...compact].length >= 14
  );
}

function isShortSelectionPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  const lines = trimmed.split("\n").filter((line) => line.trim().length > 0);
  return trimmed.length <= 120 && lines.length <= 3;
}

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
        latestPrimaryTurn,
        upperTurn,
        commitFiles,
        commitSubject,
        contextSignature,
        consumedPromptState,
        defaultSource,
      ),
    );
  markPostPrimaryEditBarriers(rows);

  if (rows.length === 0) return emptyPromptWindowSelection();

  let hardStartIndex = 0;
  while (hardStartIndex < rows.length - 1 && isHardTrimPromptRow(rows[hardStartIndex])) {
    hardStartIndex += 1;
  }
  const hardTrimmedRows = rows.slice(0, hardStartIndex);
  const hasQuotedHardTrim = hardTrimmedRows.some((row) => row.isQuotedHistory);
  const firstAnchorIndex = rows.findIndex(
    (row, index) => index >= hardStartIndex && isPromptWindowAnchor(row),
  );
  let startIndex = firstAnchorIndex >= 0 ? firstAnchorIndex : hardStartIndex;
  const softLeadingRows = firstAnchorIndex >= 0 ? rows.slice(hardStartIndex, firstAnchorIndex) : [];
  const preserveShortLeadingContext =
    firstAnchorIndex >= 0 &&
    !hasQuotedHardTrim &&
    firstAnchorIndex - hardStartIndex <= 2 &&
    softLeadingRows.every(isLowShapePromptRow);
  if (preserveShortLeadingContext) {
    startIndex = hardStartIndex;
  }

  const consumed = rows.map((row) => attachPromptSelectionMetadata(row));
  const selectedRows = rows.slice(startIndex).filter(shouldKeepPromptWindowRow);
  const selected =
    selectedRows.length > PROMPT_WINDOW_MAX_ENTRIES
      ? trimLongPromptWindow(selectedRows).map(attachPromptSelectionMetadata)
      : selectedRows.map(attachPromptSelectionMetadata);

  return { selected, consumed };
}

function buildPromptWindowRow(
  entry: Record<string, unknown>,
  primaryTurns: Set<number>,
  editTurns: Set<number>,
  latestPrimaryTurn: number,
  upperTurn: number,
  commitFiles: string[],
  commitSubject: string,
  contextSignature: CommitContextSignature,
  consumedPromptState: ConsumedPromptState,
  defaultSource: InteractionSelection["source"],
): PromptWindowRow {
  const prompt = typeof entry.prompt === "string" ? entry.prompt : "";
  const turn = typeof entry.turn === "number" ? entry.turn : 0;
  const isQuotedHistory = isQuotedPromptHistory(prompt);
  const rawTextScore = scorePromptTextOverlap(prompt, commitFiles, commitSubject);
  const isPrimaryTurn = primaryTurns.has(turn);
  const isTail = defaultSource !== "fallback" && !isPrimaryTurn && turn > latestPrimaryTurn;
  const source = resolvePromptSelectionSource(defaultSource, isPrimaryTurn, isTail);
  const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
  const hasConsumedTailPrompt = !!promptId && consumedPromptState.tailPromptIds.has(promptId);
  const analysis = analyzePromptSelection({
    prompt,
    response: null,
    turn,
    promptId,
    source,
    isPrimaryTurn,
    isEditTurn: editTurns.has(turn),
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
    fileRefScore: scorePromptFileRefs(prompt, commitFiles),
    shapeScore: scoreTextShape(prompt),
    textScore: isQuotedHistory ? Math.floor(rawTextScore * 0.25) : rawTextScore,
    isQuotedHistory,
    isTinyPrompt: analysis.hardExcluded,
    isPrimaryTurn,
    isTail,
    isBeforeCommitBoundary: turn === upperTurn,
    isNonPrimaryEditTurn: editTurns.has(turn) && !isPrimaryTurn,
    isConsumedTailPrompt: isTail && hasConsumedTailPrompt,
    hasPostPrimaryEditBarrier: false,
  };
}

function markPostPrimaryEditBarriers(rows: PromptWindowRow[]): void {
  let seenNonPrimaryTailEdit = false;
  for (const row of rows) {
    if (row.isTail) row.hasPostPrimaryEditBarrier = seenNonPrimaryTailEdit;
    if (row.isTail && row.isNonPrimaryEditTurn) seenNonPrimaryTailEdit = true;
  }
}

function shouldKeepPromptWindowRow(row: PromptWindowRow): boolean {
  if (row.isPrimaryTurn) return true;
  if (row.isQuotedHistory || row.isTinyPrompt || row.isNonPrimaryEditTurn) return false;
  if (row.isConsumedTailPrompt) return false;
  if (row.isTail) return shouldKeepTailPromptWindowRow(row);
  return true;
}

function shouldKeepTailPromptWindowRow(row: PromptWindowRow): boolean {
  if (row.hasPostPrimaryEditBarrier) {
    return (
      row.fileRefScore >= PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE ||
      row.textScore >= PROMPT_WINDOW_ANCHOR_TEXT_SCORE
    );
  }
  return (
    row.isBeforeCommitBoundary ||
    row.fileRefScore >= PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE ||
    row.textScore >= PROMPT_WINDOW_ANCHOR_TEXT_SCORE ||
    row.shapeScore >= PROMPT_WINDOW_ANCHOR_SHAPE_SCORE
  );
}

function isPromptWindowAnchor(row: PromptWindowRow): boolean {
  if (row.isPrimaryTurn) return true;
  if (!shouldKeepPromptWindowRow(row)) return false;
  return (
    row.textScore >= PROMPT_WINDOW_ANCHOR_TEXT_SCORE ||
    row.fileRefScore >= PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE ||
    row.shapeScore >= PROMPT_WINDOW_ANCHOR_SHAPE_SCORE
  );
}

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

function attachPromptSelectionMetadata(row: PromptWindowRow): Record<string, unknown> {
  const entry = row.entry as PromptEntryWithSelectionMetadata;
  entry[PROMPT_SELECTION_SOURCE] = row.source;
  entry[PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY] = row.isBeforeCommitBoundary;
  return row.entry;
}

function readPromptSelectionSource(
  entry: Record<string, unknown> | undefined,
): InteractionSelection["source"] {
  return (
    (entry as PromptEntryWithSelectionMetadata | undefined)?.[PROMPT_SELECTION_SOURCE] ?? "window"
  );
}

function readPromptSelectionBeforeCommitBoundary(
  entry: Record<string, unknown> | undefined,
): boolean {
  return !!(entry as PromptEntryWithSelectionMetadata | undefined)?.[
    PROMPT_SELECTION_BEFORE_COMMIT_BOUNDARY
  ];
}

function isHardTrimPromptRow(row: PromptWindowRow): boolean {
  if (row.isPrimaryTurn) return false;
  return (
    row.isQuotedHistory || row.isTinyPrompt || row.isNonPrimaryEditTurn || row.isConsumedTailPrompt
  );
}

function isLowShapePromptRow(row: PromptWindowRow): boolean {
  return (
    row.textScore < 2 &&
    row.fileRefScore < PROMPT_WINDOW_ANCHOR_FILE_REF_SCORE &&
    row.shapeScore < 20
  );
}

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

function promptRowTurn(row: PromptWindowRow): number {
  return typeof row.entry.turn === "number" ? row.entry.turn : 0;
}

function isStructurallyTinyPrompt(prompt: string): boolean {
  return prompt.trim().length <= 1;
}

function isQuotedPromptHistory(prompt: string): boolean {
  if (/🧑\s*Prompt/.test(prompt) && /🤖\s*Response/.test(prompt)) return true;
  if (/\bPrompt:\s/.test(prompt) && /\bResponse:\s/.test(prompt) && prompt.length > 300)
    return true;
  const indentedQuoteLines = prompt.match(/^\s{2,}\S/gm)?.length ?? 0;
  return prompt.length > 500 && indentedQuoteLines >= 8;
}

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

async function selectTranscriptPrimaryTurns(
  transcriptMatched: TranscriptInteraction[],
  promptEntries: Record<string, unknown>[],
  commitFileSet: Set<string>,
): Promise<Set<number>> {
  const promptTurnById = buildPromptTurnById(promptEntries);

  const matchedTurns = new Set<number>();
  for (const interaction of transcriptMatched) {
    if (!interaction.prompt_id) continue;
    const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
    if (turn > 0) matchedTurns.add(turn);
  }
  if (matchedTurns.size === 0) return matchedTurns;

  const committedDiffCounts = await readCommittedDiffCounts(commitFileSet);
  if (committedDiffCounts.size !== commitFileSet.size) return matchedTurns;

  const cumulative = new Map<string, { added: number; deleted: number }>();
  const suffixTurns = new Set<number>();

  for (let index = transcriptMatched.length - 1; index >= 0; index--) {
    const interaction = transcriptMatched[index];
    let contributedStats = false;
    for (const [file, stats] of Object.entries(interaction.line_stats ?? {})) {
      if (!commitFileSet.has(file)) continue;
      contributedStats = true;
      const previous = cumulative.get(file) ?? { added: 0, deleted: 0 };
      cumulative.set(file, {
        added: previous.added + stats.added,
        deleted: previous.deleted + stats.deleted,
      });
    }

    if (interaction.prompt_id) {
      const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
      if (turn > 0 && contributedStats) suffixTurns.add(turn);
    }

    if (matchesDiffCounts(cumulative, committedDiffCounts) && suffixTurns.size > 0) {
      return suffixTurns;
    }
  }

  return matchedTurns;
}

function matchesDiffCounts(
  actual: Map<string, { added: number; deleted: number }>,
  expected: Map<string, { added: number; deleted: number }>,
): boolean {
  if (actual.size !== expected.size) return false;
  for (const [file, expectedCounts] of expected) {
    const actualCounts = actual.get(file);
    if (!actualCounts) return false;
    if (
      actualCounts.added !== expectedCounts.added ||
      actualCounts.deleted !== expectedCounts.deleted
    ) {
      return false;
    }
  }
  return true;
}

async function detectGeneratedFiles(commitSha: string, commitFiles: string[]): Promise<string[]> {
  const generated = new Set<string>();

  for (const file of commitFiles) {
    if (isGeneratedArtifactPath(file)) {
      generated.add(file);
      continue;
    }

    const content = await readCommittedFilePrefix(commitSha, file);
    if (content && hasGeneratedArtifactMarkers(content)) {
      generated.add(file);
    }
  }

  return [...generated];
}

async function readCommittedFilePrefix(
  commitSha: string,
  file: string,
  maxBytes = 2048,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("git", ["show", `${commitSha}:${file}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const stdout = child.stdout;
    if (!stdout) {
      resolve(null);
      return;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let stoppedEarly = false;
    let sawBinaryData = false;
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    child.on("error", () => finish(null));

    stdout.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.includes(0)) {
        sawBinaryData = true;
        stoppedEarly = true;
        child.kill();
        return;
      }

      if (totalBytes < maxBytes) {
        const remaining = maxBytes - totalBytes;
        const prefix = buffer.subarray(0, remaining);
        chunks.push(prefix);
        totalBytes += prefix.length;
      }

      if (totalBytes >= maxBytes) {
        stoppedEarly = true;
        child.kill();
      }
    });

    child.on("close", (code) => {
      if (sawBinaryData) {
        finish(null);
        return;
      }
      if (!stoppedEarly && code !== 0) {
        finish(null);
        return;
      }
      finish(Buffer.concat(chunks).toString("utf-8"));
    });
  });
}

/**
 * Read entries from the current JSONL file and all rotated archives (stem-*.jsonl).
 * Rotated files are those renamed by the rotation mechanism on UserPromptSubmit.
 */
async function readAllSessionJsonl(
  sessionDir: string,
  baseFile: string,
): Promise<Record<string, unknown>[]> {
  const stem = baseFile.slice(0, baseFile.lastIndexOf(".jsonl"));
  const files = await readdir(sessionDir).catch(() => [] as string[]);
  const matching = files
    .filter((f) => {
      if (f === baseFile) return true;
      // Match rotated archives: stem-<Base36 ID>.jsonl
      const suffix = f.slice(stem.length + 1, -".jsonl".length);
      return f.startsWith(`${stem}-`) && f.endsWith(".jsonl") && ARCHIVE_ID_RE.test(suffix);
    })
    .sort((a, b) => {
      // Numeric Base36 sort. Base file (no suffix) sorts last (most recent).
      const getId = (f: string): number => {
        const s = f.slice(stem.length + 1, -".jsonl".length);
        return s ? parseInt(s, 36) : Infinity;
      };
      return getId(a) - getId(b);
    })
    .map((f) => join(sessionDir, f));

  const all: Record<string, unknown>[] = [];
  for (const file of matching) {
    const entries = await readJsonlEntries(file);
    all.push(...entries);
  }
  return all;
}

/**
 * Compute line-level AI attribution across all files in this commit.
 * Returns null if blob data is unavailable or attribution cannot be computed.
 */
async function computeLineAttribution(opts: {
  sessionDir: string;
  commitFileSet: Set<string>;
  aiFileSet: Set<string>;
  generatedFileSet: Set<string>;
  relevantTurns: Set<number>;
  hasTurnData: boolean;
  changeEntries: Record<string, unknown>[];
}): Promise<{ counts: LineCounts | null; contributingTurns: Set<number> }> {
  const {
    sessionDir,
    commitFileSet,
    aiFileSet,
    generatedFileSet,
    relevantTurns,
    hasTurnData,
    changeEntries,
  } = opts;

  // Parse parent↔committed blob hashes from git diff-tree.
  let diffTreeOutput: string;
  try {
    diffTreeOutput = await git(["diff-tree", "--raw", "--root", "-r", "HEAD"]);
  } catch {
    return { counts: null, contributingTurns: new Set<number>() };
  }
  const committedBlobs = parseDiffTreeBlobs(diffTreeOutput);
  if (committedBlobs.size === 0) {
    return { counts: null, contributingTurns: new Set<number>() };
  }

  // Write EMPTY_BLOB into the object store so new-file diffs work.
  // (blobHash returns EMPTY_BLOB as a constant without writing it to the store.)
  await ensureEmptyBlobInStore();

  // Read pre-blob entries (snapshot before AI edit).
  const preBlobEntries = await readAllSessionJsonl(sessionDir, PRE_BLOBS_FILE);

  // If no blob data exists at all (e.g., old session without hook v2), skip line-level
  // attribution and return null so the caller falls back to file-level ratio.
  const hasPreBlobData = preBlobEntries.some((e) => e.blob);
  const hasPostBlobData = changeEntries.some((e) => e.blob);
  if (!hasPreBlobData && !hasPostBlobData) {
    return { counts: null, contributingTurns: new Set<number>() };
  }

  const committedDiffCounts = await readCommittedDiffCounts(commitFileSet);
  if (committedDiffCounts.size !== commitFileSet.size) {
    return { counts: null, contributingTurns: new Set<number>() };
  }

  // Build map: tool_use_id → pre-blob info (file, blob, turn captured synchronously).
  // tool_use_id is the stable correlation key between PreToolUse and PostToolUse events.
  // Using it avoids FIFO ordering assumptions broken by async PostToolUse hooks.
  const preBlobById = new Map<string, { file: string; blob: string; turn: number }>();
  // Fallback: file → ordered preBlobs for entries without tool_use_id.
  const preBlobsFallback = new Map<string, Array<{ blob: string; turn: number }>>();

  for (const entry of preBlobEntries) {
    const file = entry.file as string;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const id = entry.tool_use_id as string | undefined;
    if (!file || !commitFileSet.has(file)) continue;
    // Caution: turn from pre_blob was captured synchronously (correct turn),
    // so use it for relevantTurns filtering rather than file_change's async turn.
    if (hasTurnData && !relevantTurns.has(turn)) continue;
    if (id) {
      preBlobById.set(id, { file, blob: (entry.blob as string) || "", turn });
    } else {
      // No tool_use_id — fall back to FIFO ordering per file.
      if (!preBlobsFallback.has(file)) preBlobsFallback.set(file, []);
      preBlobsFallback.get(file)?.push({ blob: (entry.blob as string) || "", turn });
    }
  }

  // Build turnPairs per file by joining pre/post blobs on tool_use_id.
  const turnPairsByFile = new Map<
    string,
    Array<{ turn: number; preBlob: string; postBlob: string }>
  >();
  const hadNewFileEditTurnsByFile = new Map<string, Set<number>>();
  const exactCursorEditCountFiles = new Set<string>();
  const exactCursorTurnsByFile = new Map<string, Set<number>>();
  const lastPostBlobByFile = new Map<string, string>();
  // Fallback: postBlobs per file for entries without tool_use_id.
  const postBlobsFallback = new Map<string, Array<{ blob: string; turn: number }>>();
  const cursorEditCountsByFile = new Map<string, { added: number; deleted: number }>();

  for (const entry of changeEntries) {
    const file = entry.file as string;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const id = entry.tool_use_id as string | undefined;
    const postBlob = (entry.blob as string) || "";
    if (!file || !commitFileSet.has(file) || !postBlob) continue;

    const editAdded = typeof entry.edit_added === "number" ? entry.edit_added : null;
    const editDeleted = typeof entry.edit_deleted === "number" ? entry.edit_deleted : null;
    if (
      editAdded !== null &&
      editDeleted !== null &&
      (!hasTurnData || relevantTurns.has(id ? (preBlobById.get(id)?.turn ?? turn) : turn))
    ) {
      const previous = cursorEditCountsByFile.get(file) ?? { added: 0, deleted: 0 };
      cursorEditCountsByFile.set(file, {
        added: previous.added + editAdded,
        deleted: previous.deleted + editDeleted,
      });
      if (!exactCursorTurnsByFile.has(file)) exactCursorTurnsByFile.set(file, new Set());
      exactCursorTurnsByFile.get(file)?.add(id ? (preBlobById.get(id)?.turn ?? turn) : turn);
    }
    lastPostBlobByFile.set(file, postBlob);

    if (id) {
      const pre = preBlobById.get(id);
      if (!pre) continue; // No matching pre-blob — skip this edit.
      // Use turn from pre_blob (sync capture) for relevantTurns check.
      if (hasTurnData && !relevantTurns.has(pre.turn)) continue;
      if (!pre.blob) {
        if (!hadNewFileEditTurnsByFile.has(file)) hadNewFileEditTurnsByFile.set(file, new Set());
        hadNewFileEditTurnsByFile.get(file)?.add(pre.turn);
      } else {
        if (!turnPairsByFile.has(file)) turnPairsByFile.set(file, []);
        turnPairsByFile.get(file)?.push({ turn: pre.turn, preBlob: pre.blob, postBlob });
      }
    } else {
      // No tool_use_id — fall back to FIFO.
      if (hasTurnData && !relevantTurns.has(turn)) continue;
      if (!postBlobsFallback.has(file)) postBlobsFallback.set(file, []);
      postBlobsFallback.get(file)?.push({ blob: postBlob, turn });
    }
  }

  // Merge FIFO fallback pairs into turnPairsByFile.
  for (const [file, postBlobs] of postBlobsFallback) {
    const preBlobs = preBlobsFallback.get(file) ?? [];
    const pairCount = Math.min(preBlobs.length, postBlobs.length);
    for (let i = 0; i < pairCount; i++) {
      const pre = preBlobs[i]?.blob || "";
      const preTurn = preBlobs[i]?.turn ?? 0;
      const post = postBlobs[i]?.blob || "";
      if (!pre) {
        if (!hadNewFileEditTurnsByFile.has(file)) hadNewFileEditTurnsByFile.set(file, new Set());
        hadNewFileEditTurnsByFile.get(file)?.add(preTurn);
      } else if (post) {
        if (!turnPairsByFile.has(file)) turnPairsByFile.set(file, []);
        turnPairsByFile.get(file)?.push({ turn: preTurn, preBlob: pre, postBlob: post });
      }
    }
  }

  // Completeness check (issue #3 from adversarial review):
  // An AI file needs a complete blob pair (pre + post) for line-level attribution.
  // Having only post blobs (PreToolUse hook not yet active) is not enough — it would
  // produce 0% AI ratio instead of falling back to file-level.
  for (const file of aiFileSet) {
    if (generatedFileSet.has(file)) continue;
    if (!commitFileSet.has(file)) continue;
    const hasPairs = (turnPairsByFile.get(file) ?? []).length > 0;
    const hasNewFileEdit = (hadNewFileEditTurnsByFile.get(file)?.size ?? 0) > 0;
    const cursorEditCounts = cursorEditCountsByFile.get(file);
    const committedCounts = committedDiffCounts.get(file);
    const committedBlob = committedBlobs.get(file)?.committedBlob ?? null;
    const lastPostBlob = lastPostBlobByFile.get(file) ?? null;
    const hasExactCursorEditCounts =
      !!cursorEditCounts &&
      !!committedCounts &&
      !!committedBlob &&
      committedBlob === lastPostBlob &&
      cursorEditCounts.added === committedCounts.added &&
      cursorEditCounts.deleted === committedCounts.deleted;
    if (hasExactCursorEditCounts) {
      exactCursorEditCountFiles.add(file);
    }
    if (!hasPairs && !hasNewFileEdit && !hasExactCursorEditCounts) {
      // No complete blob pair for this AI file — fall back to file-level for the whole commit.
      return { counts: null, contributingTurns: new Set<number>() };
    }
  }

  let totalAiAdded = 0;
  let totalAdded = 0;
  let totalDeleted = 0;
  const contributingTurns = new Set<number>();

  for (const file of commitFileSet) {
    if (generatedFileSet.has(file)) continue;
    const blobs = committedBlobs.get(file);
    if (!blobs) continue;

    const { parentBlob, committedBlob } = blobs;
    const turnPairs = turnPairsByFile.get(file) ?? [];
    const hadNewFileEditTurns = hadNewFileEditTurnsByFile.get(file) ?? new Set<number>();

    try {
      const result = await computePositionAttribution(parentBlob, committedBlob, turnPairs);

      // New file created by AI from scratch: attribute all added lines to AI.
      if (hadNewFileEditTurns.size > 0 && aiFileSet.has(file) && turnPairs.length === 0) {
        totalAiAdded += result.totalAddedLines;
        for (const turn of hadNewFileEditTurns) {
          if (turn > 0) contributingTurns.add(turn);
        }
      } else if (exactCursorEditCountFiles.has(file)) {
        // Cursor only exposes edit snippets today. If their aggregate line counts
        // exactly match the final commit diff, we can safely attribute the file's
        // added lines to AI without guessing positions.
        totalAiAdded += result.totalAddedLines;
        for (const turn of exactCursorTurnsByFile.get(file) ?? []) {
          if (turn > 0) contributingTurns.add(turn);
        }
      } else {
        totalAiAdded += result.aiAddedLines;
        for (const turn of result.contributingTurns) {
          if (turn > 0) contributingTurns.add(turn);
        }
      }
      totalAdded += result.totalAddedLines;
      totalDeleted += result.deletedLines;
    } catch {
      // Attribution failed for this file — skip it without breaking the commit.
    }
  }

  return {
    counts: {
      aiAddedLines: totalAiAdded,
      totalAddedLines: totalAdded,
      deletedLines: totalDeleted,
    },
    contributingTurns,
  };
}

/**
 * Parse `git diff-tree --raw --root -r HEAD` output into a file → blob hash map.
 * Maps the all-zeros "null blob" to EMPTY_BLOB.
 * Handles rename (R*) and copy (C*) statuses by using the destination path as key.
 */
function parseDiffTreeBlobs(
  output: string,
): Map<string, { parentBlob: string; committedBlob: string }> {
  const map = new Map<string, { parentBlob: string; committedBlob: string }>();
  const ZEROS = "0000000000000000000000000000000000000000";

  for (const line of output.split("\n")) {
    // Standard: :oldmode newmode oldblob newblob status\tfile
    // Rename/copy: :oldmode newmode oldblob newblob R100\told\tnew
    const m = line.match(/^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) \w+\t(.+)$/);
    if (!m) continue;
    const parentBlob = m[1] === ZEROS ? EMPTY_BLOB : m[1];
    const committedBlob = m[2] === ZEROS ? EMPTY_BLOB : m[2];
    const paths = m[3];
    // For rename/copy, paths = "old\tnew" — use the destination (last part).
    const parts = paths.split("\t");
    const file = parts[parts.length - 1];
    map.set(file, { parentBlob, committedBlob });
  }
  return map;
}

/**
 * Read consumed change identifiers from committed_pairs.jsonl.
 * Uses change_id/tool_use_id when available (unique per edit), falls back to turn:file.
 */
/**
 * Highest turn number recorded in the consumed-pairs log. Used to trim the
 * prompt window so a new commit does not re-emit prompts that earlier commits
 * in the same session already captured. Returns 0 when no prior commit has
 * happened (no file exists or no entries have a turn field).
 *
 * Example: a session commits three times at turns 10, 20, 30. The fourth
 * commit runs at turn 45. maxConsumedTurn returns 30, so the fourth note's
 * prompt window starts at turn 31. Prompts from turns 1–30 stay attached to
 * the earlier notes where they were first recorded.
 */
async function readMaxConsumedTurn(sessionDir: string): Promise<number> {
  const file = join(sessionDir, COMMITTED_PAIRS_FILE);
  if (!existsSync(file)) return 0;
  const entries = await readJsonlEntries(file);
  let max = 0;
  for (const e of entries) {
    if (e.prompt_scope === "tail") continue;
    const turn = typeof e.turn === "number" ? e.turn : 0;
    if (turn > max) max = turn;
  }
  return max;
}

async function readCurrentTurn(sessionDir: string): Promise<number> {
  const file = join(sessionDir, TURN_FILE);
  if (!existsSync(file)) return 0;
  return Number.parseInt((await readFile(file, "utf-8")).trim(), 10) || 0;
}

async function readConsumedPairs(sessionDir: string): Promise<Set<string>> {
  const file = join(sessionDir, COMMITTED_PAIRS_FILE);
  if (!existsSync(file)) return new Set();
  const entries = await readJsonlEntries(file);
  const set = new Set<string>();
  for (const e of entries) {
    // Prefer change_id/tool_use_id over turn:file so repeated same-file edits
    // within one turn stay attributable across split commits.
    if (typeof e.change_id === "string" && e.change_id) {
      set.add(`change:${e.change_id}`);
    } else if (e.tool_use_id) {
      set.add(`id:${e.tool_use_id}`);
    } else if (e.turn !== undefined && e.file) {
      set.add(`${e.turn}:${e.file}`);
    }
  }
  return set;
}

async function readConsumedPromptState(sessionDir: string): Promise<ConsumedPromptState> {
  const file = join(sessionDir, COMMITTED_PAIRS_FILE);
  const state: ConsumedPromptState = {
    legacyPromptIds: new Set(),
    promptFilePairs: new Set(),
    tailPromptIds: new Set(),
  };
  if (!existsSync(file)) return state;

  const entries = await readJsonlEntries(file);
  for (const entry of entries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
    if (!promptId) continue;

    if (entry.prompt_scope === "tail") {
      state.tailPromptIds.add(promptId);
      continue;
    }

    const filePath = typeof entry.file === "string" ? entry.file : undefined;
    if (filePath) {
      state.promptFilePairs.add(promptFilePairKey(promptId, filePath));
      continue;
    }

    // New prompt-window markers only advance maxConsumedTurn. Older entries did
    // not have a scope marker, so treat them as fully consumed to prevent stale
    // prompt revival after upgrading Agent Note mid-session.
    if (entry.prompt_scope !== "window") {
      state.legacyPromptIds.add(promptId);
    }
  }

  return state;
}

/** Build the consumed-pair key for a change/pre-blob entry. */
function consumedKey(entry: Record<string, unknown>): string {
  if (typeof entry.change_id === "string" && entry.change_id) {
    return `change:${entry.change_id}`;
  }
  if (entry.tool_use_id) return `id:${entry.tool_use_id}`;
  return `${entry.turn}:${entry.file}`;
}

/** Append consumed identifiers for changes used in this commit. */
async function recordConsumedPairs(
  sessionDir: string,
  changeEntries: Record<string, unknown>[],
  preBlobEntries: Record<string, unknown>[],
  commitFileSet: Set<string>,
  consumedPromptEntries: Record<string, unknown>[] = [],
  consumedTranscriptPromptFiles: ConsumedTranscriptPromptFile[] = [],
): Promise<void> {
  const seen = new Set<string>();
  const pairsFile = join(sessionDir, COMMITTED_PAIRS_FILE);
  // Iterate both change and pre-blob entries. A pre-blob-only commit (e.g.
  // async PostToolUse drop) still needs its turns recorded so the next
  // commit's prompt-window filter does not re-emit those prompts.
  const allEntries = [...changeEntries, ...preBlobEntries];
  for (const entry of allEntries) {
    const file = entry.file as string;
    if (!file || !commitFileSet.has(file)) continue;
    const key = consumedKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    await appendJsonl(pairsFile, {
      turn: entry.turn,
      file,
      change_id: entry.change_id ?? null,
      tool_use_id: entry.tool_use_id ?? null,
    });
  }
  const promptFileSeen = new Set<string>();
  for (const entry of consumedTranscriptPromptFiles) {
    if (!entry.promptId || !entry.file || !commitFileSet.has(entry.file)) continue;
    const key = promptFilePairKey(entry.promptId, entry.file);
    if (promptFileSeen.has(key) || seen.has(key)) continue;
    promptFileSeen.add(key);
    await appendJsonl(pairsFile, {
      turn: entry.turn,
      prompt_id: entry.promptId,
      file: entry.file,
      change_id: null,
      tool_use_id: null,
    });
  }
  // Record prompt-only consumed turns so transcript-driven agents (Codex)
  // advance maxConsumedTurn even with no file_change/pre_blob entries.
  // Without this, each Codex commit can keep dragging earlier prompt-only
  // context back into later causal windows.
  const promptSeen = new Set<string>();
  for (const entry of consumedPromptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
    const turn = typeof entry.turn === "number" ? entry.turn : undefined;
    if (!promptId || turn === undefined) continue;
    const key = `prompt:${promptId}`;
    if (promptSeen.has(key) || seen.has(key)) continue;
    promptSeen.add(key);
    await appendJsonl(pairsFile, {
      turn,
      prompt_id: promptId,
      file: null,
      prompt_scope: readPromptSelectionSource(entry) === "tail" ? "tail" : "window",
      change_id: null,
      tool_use_id: null,
    });
  }
}

async function readResponsesByTurn(sessionDir: string): Promise<Map<number, string>> {
  const eventsFile = join(sessionDir, EVENTS_FILE);
  if (!existsSync(eventsFile)) return new Map();

  const entries = await readJsonlEntries(eventsFile);
  const responsesByTurn = new Map<number, { response: string; priority: number }>();
  for (const entry of entries) {
    if (entry.event !== "response" && entry.event !== "stop") continue;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const response = typeof entry.response === "string" ? entry.response.trim() : "";
    if (!turn || !response) continue;
    const priority = entry.event === "response" ? 2 : 1;
    const current = responsesByTurn.get(turn);
    if (current && current.priority > priority) continue;
    responsesByTurn.set(turn, { response, priority });
  }
  return new Map([...responsesByTurn.entries()].map(([turn, value]) => [turn, value.response]));
}

async function readTranscriptCorrelationStartMs(sessionDir: string): Promise<number | null> {
  const eventsFile = join(sessionDir, EVENTS_FILE);
  if (!existsSync(eventsFile)) return null;

  const entries = await readJsonlEntries(eventsFile);
  let latestSessionStartMs: number | null = null;
  for (const entry of entries) {
    if (entry.event !== "session_start") continue;
    const timestampMs = parseTimestampMs(entry.timestamp);
    if (timestampMs === null) continue;
    if (latestSessionStartMs === null || timestampMs > latestSessionStartMs) {
      latestSessionStartMs = timestampMs;
    }
  }
  return latestSessionStartMs;
}

/** Read the most useful model field from the session's events.jsonl. */
async function readSessionModel(sessionDir: string): Promise<string | null> {
  const eventsFile = join(sessionDir, EVENTS_FILE);
  if (!existsSync(eventsFile)) return null;
  const entries = await readJsonlEntries(eventsFile);
  let fallbackModel: string | null = null;
  for (const e of entries) {
    if (e.event === "session_start" && typeof e.model === "string" && e.model) {
      return e.model;
    }
    if (fallbackModel === null && typeof e.model === "string" && e.model) {
      fallbackModel = e.model;
    }
  }
  return fallbackModel;
}

/**
 * Aggregate per-interaction tools from changeEntries.
 * Returns a Map from interaction index → tools array (file-edit tools only).
 * Interactions with no observed file-edit tools are omitted so transcript-
 * derived tools can still flow through unchanged.
 */
function buildInteractionTools(
  changeEntries: Record<string, unknown>[],
  promptEntries: Record<string, unknown>[],
  commitFileSet: Set<string>,
): Map<number, string[] | null> {
  // Group tools by turn.
  const toolsByTurn = new Map<number, Set<string>>();
  for (const entry of changeEntries) {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    const file = entry.file as string;
    const tool = entry.tool as string | undefined;
    if (!file || !commitFileSet.has(file) || !tool) continue;
    if (!toolsByTurn.has(turn)) toolsByTurn.set(turn, new Set());
    toolsByTurn.get(turn)?.add(tool);
  }

  // Map interaction index → tools.
  const result = new Map<number, string[] | null>();
  for (let i = 0; i < promptEntries.length; i++) {
    const promptEntry = promptEntries[i];
    if (!promptEntry) continue;
    const turn = typeof promptEntry.turn === "number" ? promptEntry.turn : 0;
    const tools = toolsByTurn.get(turn);
    if (tools && tools.size > 0) {
      result.set(i, [...tools]);
    }
  }
  return result;
}

/**
 * Write the git empty blob (e69de29...) into the object store using a temp file.
 * Required so that `git diff EMPTY_BLOB <blob>` works for new-file attribution.
 */
async function ensureEmptyBlobInStore(): Promise<void> {
  const tmp = join(tmpdir(), `agentnote-empty-${process.pid}.tmp`);
  try {
    await writeFile(tmp, "");
    await git(["hash-object", "-w", tmp]);
  } catch {
    // Not critical — new-file attribution may fall back to file-level.
  } finally {
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
  }
}
