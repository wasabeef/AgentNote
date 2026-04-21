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
import type { Interaction, LineCounts } from "./entry.js";
import { buildEntry, hasGeneratedArtifactMarkers, isGeneratedArtifactPath } from "./entry.js";
import { appendJsonl, readJsonlEntries } from "./jsonl.js";
import { readSessionAgent, readSessionTranscriptPath } from "./session.js";
import { readNote, writeNote } from "./storage.js";

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

  // Highest turn already attributed to a previous commit in this session.
  // Prompts from turns <= this are considered "spent" — their own commits
  // already carry them in their notes. Used to trim the prompt window below.
  const maxConsumedTurn = await readMaxConsumedTurn(sessionDir);

  // Check if turn tracking is available (turn-attributed data has turn fields).
  const hasTurnData = promptEntries.some((e) => typeof e.turn === "number" && e.turn > 0);
  const allSessionEditTurns = collectSessionEditTurns(allChangeEntries, allPreBlobEntries);
  const commitFileTurns = collectCommitFileTurns(
    changeEntries,
    preBlobEntriesForTurnFix,
    commitFileSet,
  );

  let aiFiles: string[];
  let prompts: string[];
  let relevantPromptEntries: Record<string, unknown>[];
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
    relevantPromptEntries = selectPromptWindowEntries(
      promptEntries,
      primaryTurns,
      allSessionEditTurns,
      maxConsumedTurn,
    );
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
    const turnFilePath = join(sessionDir, TURN_FILE);
    let currentTurn = 0;
    if (existsSync(turnFilePath)) {
      currentTurn = Number.parseInt((await readFile(turnFilePath, "utf-8")).trim(), 10) || 0;
    }
    const minRelevantTurn = Math.min(...relevantTurns);
    crossTurnCommit = minRelevantTurn < currentTurn;
  }

  let interactions: Interaction[];
  let transcriptLineCounts: LineCounts | undefined;
  // Session entries that contributed to this commit's interactions. Passed
  // to recordConsumedPairs so maxConsumedTurn advances even when no
  // file_change/pre_blob entries exist (e.g. Codex transcript-driven path).
  let consumedPromptEntries: Record<string, unknown>[] = [];

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
  correlatePromptIds(allInteractions, promptEntries);
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
  if (
    hasTurnData &&
    prompts.length === 0 &&
    aiFiles.length === 0 &&
    !transcriptEditsCommit &&
    transcriptEditsOthers
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
      if (matched) return toRecordedInteraction(matched, commitFileSet);
      return { prompt: (entry.prompt as string) ?? "", response: null };
    });
    consumedPromptEntries = relevantPromptEntries;

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
            (i.files_touched ?? []).filter((f) => commitFileSet.has(f)),
          ),
        ),
      ];
      transcriptLineCounts = await resolveTranscriptLineCounts(
        attributionCommitFileSet,
        transcriptMatched,
      );
    }
  } else if (transcriptPath && allInteractions.length > 0) {
    // Transcript-driven path: sessions that don't emit `file_change` events
    // (e.g. Codex) derive their causal window from transcript interactions.
    const transcriptMatched = allInteractions.filter((i) =>
      (i.files_touched ?? []).some((f) => commitFileSet.has(f)),
    );
    const transcriptEditTurns = collectTranscriptEditTurns(allInteractions, promptEntries);
    const transcriptPrimaryTurns = await selectTranscriptPrimaryTurns(
      transcriptMatched,
      promptEntries,
      attributionCommitFileSet,
    );
    const windowEntries = selectPromptWindowEntries(
      promptEntries,
      transcriptPrimaryTurns,
      transcriptEditTurns,
      maxConsumedTurn,
    );
    relevantPromptEntries = windowEntries;
    prompts = windowEntries.map((entry) => (entry.prompt as string) ?? "");

    if (windowEntries.length > 0) {
      interactions = windowEntries.map((entry) => {
        const id = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
        const matched = id ? interactionsById.get(id) : undefined;
        if (matched) return toRecordedInteraction(matched, commitFileSet);
        return { prompt: (entry.prompt as string) ?? "", response: null };
      });
      consumedPromptEntries = windowEntries;
    } else if (transcriptMatched.length > 0) {
      // No session prompts at all — emit just the edit-linked transcript
      // interactions (e.g. commit with no surviving prompts.jsonl entry).
      interactions = transcriptMatched.map((i) => toRecordedInteraction(i, commitFileSet));
    } else if (!crossTurnCommit) {
      interactions = selectTranscriptFallbackInteractions(allInteractions, commitFileSet);
    } else {
      interactions = [];
    }

    if (transcriptMatched.length > 0) {
      aiFiles = [
        ...new Set(
          transcriptMatched.flatMap((i) =>
            (i.files_touched ?? []).filter((f) => commitFileSet.has(f)),
          ),
        ),
      ];
      transcriptLineCounts = await resolveTranscriptLineCounts(
        attributionCommitFileSet,
        transcriptMatched,
      );
    }
  } else {
    interactions = prompts.map((p) => ({ prompt: p, response: null }));
  }

  await fillInteractionResponsesFromEvents(sessionDir, relevantPromptEntries, interactions);

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
 * Known limitation: Claude `--continue` preserves the original session_id
 * but extends the transcript with prior-run turns, while `prompts.jsonl`
 * starts fresh for the resumed run. A repeated prompt text that also
 * appeared in the prior run can have its session_id stamped onto a
 * transcript index that belongs to the prior run, producing response=null
 * (or, worse, a wrong-session response) for the current run's pairing.
 * Fixing this cleanly needs a chronological lower bound (first transcript
 * index to consider) derived from the session_start timestamp; deferred.
 *
 * Mutates `interactions` in place.
 */
function correlatePromptIds(
  interactions: TranscriptInteraction[],
  sessionPromptEntries: Record<string, unknown>[],
): void {
  const sessionTextToIds = new Map<string, string[]>();
  for (const entry of sessionPromptEntries) {
    const text = typeof entry.prompt === "string" ? entry.prompt : undefined;
    const id = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
    if (!text || !id) continue;
    if (!sessionTextToIds.has(text)) sessionTextToIds.set(text, []);
    sessionTextToIds.get(text)?.push(id);
  }

  const txTextToIndices = new Map<string, number[]>();
  for (let idx = 0; idx < interactions.length; idx++) {
    const text = interactions[idx].prompt;
    if (!txTextToIndices.has(text)) txTextToIndices.set(text, []);
    txTextToIndices.get(text)?.push(idx);
  }

  for (const [text, ids] of sessionTextToIds) {
    const indices = txTextToIndices.get(text) ?? [];
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

function toRecordedInteraction(
  interaction: TranscriptInteraction,
  commitFileSet: Set<string>,
): Interaction {
  const recorded: Interaction = {
    prompt: interaction.prompt,
    response: interaction.response,
  };

  const filesTouched = interaction.files_touched?.filter((file) => commitFileSet.has(file));
  if (filesTouched && filesTouched.length > 0) {
    recorded.files_touched = [...new Set(filesTouched)];
  }

  if (interaction.tools !== undefined) {
    recorded.tools = interaction.tools;
  }

  return recorded;
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

async function resolveTranscriptLineCounts(
  commitFileSet: Set<string>,
  interactions: TranscriptInteraction[],
): Promise<LineCounts | undefined> {
  const transcriptStats = new Map<string, { added: number; deleted: number }>();

  for (const interaction of interactions) {
    for (const [file, stats] of Object.entries(interaction.line_stats ?? {})) {
      if (!commitFileSet.has(file)) continue;
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
  const promptTurnById = new Map<string, number>();
  for (const entry of promptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (promptId && turn > 0) promptTurnById.set(promptId, turn);
  }

  const turns = new Set<number>();
  for (const interaction of interactions) {
    if (!interaction.prompt_id || (interaction.files_touched?.length ?? 0) === 0) continue;
    const turn = promptTurnById.get(interaction.prompt_id) ?? 0;
    if (turn > 0) turns.add(turn);
  }
  return turns;
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

function selectPromptWindowEntries(
  promptEntries: Record<string, unknown>[],
  primaryTurns: Set<number>,
  editTurns: Set<number>,
  maxConsumedTurn: number,
): Record<string, unknown>[] {
  if (primaryTurns.size === 0) return [];

  const orderedPrimaryTurns = [...primaryTurns].filter((turn) => turn > 0).sort((a, b) => a - b);
  if (orderedPrimaryTurns.length === 0) return [];

  const orderedEditTurns = [...editTurns].filter((turn) => turn > 0).sort((a, b) => a - b);
  const primaryTurnSet = new Set(orderedPrimaryTurns);
  const clusters: Array<{
    lowerBoundary: number;
    upperBoundary: number;
    primaryTurns: Set<number>;
  }> = [];

  let lastEditTurn = 0;
  let activeCluster: {
    lowerBoundary: number;
    primaryTurns: Set<number>;
  } | null = null;

  for (const turn of orderedEditTurns) {
    if (primaryTurnSet.has(turn)) {
      if (!activeCluster) {
        activeCluster = {
          lowerBoundary: lastEditTurn,
          primaryTurns: new Set<number>(),
        };
      }
      activeCluster.primaryTurns.add(turn);
    } else if (activeCluster) {
      clusters.push({
        lowerBoundary: activeCluster.lowerBoundary,
        upperBoundary: turn,
        primaryTurns: activeCluster.primaryTurns,
      });
      activeCluster = null;
    }

    lastEditTurn = turn;
  }

  if (activeCluster) {
    clusters.push({
      lowerBoundary: activeCluster.lowerBoundary,
      upperBoundary: Number.POSITIVE_INFINITY,
      primaryTurns: activeCluster.primaryTurns,
    });
  }

  return promptEntries.filter((entry) => {
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (turn <= 0) return false;

    for (const cluster of clusters) {
      if (turn <= cluster.lowerBoundary || turn >= cluster.upperBoundary) continue;
      if (cluster.primaryTurns.has(turn)) return true;
      return turn > maxConsumedTurn;
    }

    return false;
  });
}

async function selectTranscriptPrimaryTurns(
  transcriptMatched: TranscriptInteraction[],
  promptEntries: Record<string, unknown>[],
  commitFileSet: Set<string>,
): Promise<Set<number>> {
  const promptTurnById = new Map<string, number>();
  for (const entry of promptEntries) {
    const promptId = typeof entry.prompt_id === "string" ? entry.prompt_id : undefined;
    const turn = typeof entry.turn === "number" ? entry.turn : 0;
    if (promptId && turn > 0) promptTurnById.set(promptId, turn);
  }

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
    const turn = typeof e.turn === "number" ? e.turn : 0;
    if (turn > max) max = turn;
  }
  return max;
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
