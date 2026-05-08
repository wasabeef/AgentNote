import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { getAgent, hasAgent } from "../agents/index.js";
import { AGENT_NAMES, type HookInput, NORMALIZED_EVENT_KINDS } from "../agents/types.js";
import {
  CHANGES_FILE,
  EMPTY_BLOB,
  EVENTS_FILE,
  HEARTBEAT_FILE,
  PENDING_COMMIT_FILE,
  PRE_BLOBS_FILE,
  PROMPT_ID_FILE,
  PROMPTS_FILE,
  SESSION_FILE,
  SESSIONS_DIR,
  TEXT_ENCODING,
  TRAILER_KEY,
  TURN_FILE,
} from "../core/constants.js";
import { appendJsonl } from "../core/jsonl.js";
import { recordCommitEntry } from "../core/record.js";
import { rotateLogs } from "../core/rotate.js";
import {
  hasRecordableSessionData,
  writeSessionAgent,
  writeSessionTranscriptPath,
} from "../core/session.js";
import { git, injectGitCommitTrailer } from "../git.js";
import { agentnoteDir } from "../paths.js";

const CLAUDE_PRE_TOOL_USE_EVENT = "PreToolUse";
const CURSOR_BEFORE_SUBMIT_PROMPT_EVENT = "beforeSubmitPrompt";
const CURSOR_BEFORE_SHELL_EXECUTION_EVENT = "beforeShellExecution";
const GEMINI_BEFORE_TOOL_EVENT = "BeforeTool";
const GEMINI_ALLOW_DECISION = "allow";
const JSON_INDENT_SPACES = 2;
const PRE_BLOB_EVENT = "pre_blob";
const SYNCHRONOUS_HOOK_EVENTS = new Set([
  CLAUDE_PRE_TOOL_USE_EVENT,
  CURSOR_BEFORE_SUBMIT_PROMPT_EVENT,
  CURSOR_BEFORE_SHELL_EXECUTION_EVENT,
  GEMINI_BEFORE_TOOL_EVENT,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Detect agent hook events that must respond synchronously on stdout. */
export function isSynchronousHookEvent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.hook_event_name !== "string") return false;
  return SYNCHRONOUS_HOOK_EVENTS.has(value.hook_event_name);
}

/**
 * Normalize an absolute file path to a repo-relative path.
 * Returns the original path if normalization fails or path is already relative.
 */
async function normalizeToRepoRelative(filePath: string): Promise<string> {
  if (!isAbsolute(filePath)) return filePath;
  try {
    const rawRoot = (await git(["rev-parse", "--show-toplevel"])).trim();
    const repoRoot = await realpath(rawRoot);
    let normalized = filePath;
    if (repoRoot.startsWith("/private") && !normalized.startsWith("/private")) {
      normalized = `/private${normalized}`;
    } else if (!repoRoot.startsWith("/private") && normalized.startsWith("/private")) {
      normalized = normalized.replace(/^\/private/, "");
    }
    return relative(repoRoot, normalized);
  } catch {
    return filePath;
  }
}

/**
 * Compute the git blob hash for a file on disk and write it to the object store.
 * Returns EMPTY_BLOB if the file does not exist or on error.
 */
async function blobHash(absPath: string): Promise<string> {
  try {
    if (!existsSync(absPath)) return EMPTY_BLOB;
    return (await git(["hash-object", "-w", absPath])).trim();
  } catch {
    return EMPTY_BLOB;
  }
}

/** Read all of stdin as a string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString(TEXT_ENCODING);
}

async function readCurrentTurn(sessionDir: string): Promise<number> {
  const turnPath = join(sessionDir, TURN_FILE);
  if (!existsSync(turnPath)) return 0;
  const raw = (await readFile(turnPath, TEXT_ENCODING)).trim();
  return Number.parseInt(raw, 10) || 0;
}

async function readCurrentPromptId(sessionDir: string): Promise<string | null> {
  const p = join(sessionDir, PROMPT_ID_FILE);
  if (!existsSync(p)) return null;
  const raw = (await readFile(p, TEXT_ENCODING)).trim();
  return raw || null;
}

async function readCurrentHead(): Promise<string | null> {
  try {
    return (await git(["rev-parse", "HEAD"])).trim();
  } catch {
    return null;
  }
}

type RefreshHeartbeatOptions = {
  onlyIfExists?: boolean;
};

/** Keep a live session fresh while long agent turns emit tool/response events. */
async function refreshHeartbeat(
  agentnoteDirPath: string,
  sessionId: string,
  opts: RefreshHeartbeatOptions = {},
): Promise<void> {
  const heartbeatPath = join(agentnoteDirPath, SESSIONS_DIR, sessionId, HEARTBEAT_FILE);
  if (opts.onlyIfExists && !existsSync(heartbeatPath)) return;
  await writeFile(heartbeatPath, String(Date.now()));
}

/** Handle one normalized agent hook event from stdin. */
export async function hook(args: string[] = []): Promise<void> {
  const raw = await readStdin();

  // Determine if this is a synchronous hook (PreToolUse) by peeking at the event name.
  let sync = false;
  let peek: unknown;
  try {
    peek = JSON.parse(raw);
    sync = isSynchronousHookEvent(peek);
  } catch {
    return;
  }

  const agentArgIndex = args.indexOf("--agent");
  const agentName = agentArgIndex >= 0 && args[agentArgIndex + 1] ? args[agentArgIndex + 1] : null;
  if (!agentName || !hasAgent(agentName)) return;

  const adapter = getAgent(agentName);
  const input: HookInput = { raw, sync };
  const event = adapter.parseEvent(input);
  if (!event) {
    // Even when the adapter filters an event (e.g. system-injected messages),
    // refresh the heartbeat to prevent session expiry during long idle periods.
    const peekSid = isRecord(peek) && typeof peek.session_id === "string" ? peek.session_id : "";
    if (
      peekSid &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(peekSid)
    ) {
      try {
        const dir = await agentnoteDir();
        await refreshHeartbeat(dir, peekSid, { onlyIfExists: true });
      } catch {
        // Never break the agent workflow for heartbeat refresh.
      }
    }
    // Gemini BeforeTool requires {"decision": "allow"} even for unrecognized tools.
    if (adapter.name === AGENT_NAMES.gemini && input.sync) {
      if (isRecord(peek) && peek.hook_event_name === GEMINI_BEFORE_TOOL_EVENT) {
        process.stdout.write(JSON.stringify({ decision: "allow" }));
      }
    }
    return;
  }

  const agentnoteDirPath = await agentnoteDir();
  const sessionDir = join(agentnoteDirPath, SESSIONS_DIR, event.sessionId);
  await mkdir(sessionDir, { recursive: true });
  // Only Gemini maps `stop` to true session termination today; other adapters
  // use `stop` for response-end events and must keep the heartbeat alive.
  if (!(adapter.name === AGENT_NAMES.gemini && event.kind === NORMALIZED_EVENT_KINDS.stop)) {
    await refreshHeartbeat(agentnoteDirPath, event.sessionId);
  }

  switch (event.kind) {
    case NORMALIZED_EVENT_KINDS.sessionStart: {
      await writeFile(join(agentnoteDirPath, SESSION_FILE), event.sessionId);
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      await appendJsonl(join(sessionDir, EVENTS_FILE), {
        event: NORMALIZED_EVENT_KINDS.sessionStart,
        session_id: event.sessionId,
        timestamp: event.timestamp,
        agent: adapter.name,
        model: event.model ?? null,
      });
      break;
    }

    case NORMALIZED_EVENT_KINDS.stop: {
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      const turn = await readCurrentTurn(sessionDir);
      await appendJsonl(join(sessionDir, EVENTS_FILE), {
        event: NORMALIZED_EVENT_KINDS.stop,
        session_id: event.sessionId,
        timestamp: event.timestamp,
        turn,
        response: event.response ?? null,
      });
      // Do NOT invalidate heartbeat on Stop. Claude Code fires Stop when the AI
      // finishes responding, NOT when the session ends. The session remains active
      // for subsequent prompts. SessionStart from the next session overwrites the
      // session pointer and heartbeat naturally.
      //
      // Gemini SessionEnd is a true session termination — delete this session's
      // heartbeat so prepare-commit-msg treats it as expired. Only the per-session
      // heartbeat is touched; the global SESSION_FILE is left alone to avoid a
      // TOCTOU race with a concurrent SessionStart from /clear or a new terminal.
      //
      // This is best-effort: Gemini CLI does not wait for SessionEnd hooks to
      // complete, so the heartbeat may survive if the process exits first. The
      // prepare-commit-msg 1-hour staleness check is the ultimate safeguard.
      if (adapter.name === AGENT_NAMES.gemini) {
        try {
          await unlink(join(sessionDir, HEARTBEAT_FILE));
        } catch {
          // already removed or never created
        }
      }
      break;
    }

    case NORMALIZED_EVENT_KINDS.prompt: {
      await writeFile(join(agentnoteDirPath, SESSION_FILE), event.sessionId);
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      const eventsPath = join(sessionDir, EVENTS_FILE);
      if (!existsSync(eventsPath)) {
        await appendJsonl(eventsPath, {
          event: NORMALIZED_EVENT_KINDS.sessionStart,
          session_id: event.sessionId,
          timestamp: event.timestamp,
          agent: adapter.name,
          model: event.model ?? null,
        });
      }
      // Rotate logs from previous prompt batch before starting fresh.
      // This ensures split commits each get scoped notes, while the next
      // prompt starts with clean JSONL files.
      const rotateId = Date.now().toString(36);
      await rotateLogs(sessionDir, rotateId, [PROMPTS_FILE, CHANGES_FILE, PRE_BLOBS_FILE]);

      // Increment turn counter for causal file attribution.
      const turnPath = join(sessionDir, TURN_FILE);
      let turn = await readCurrentTurn(sessionDir);
      turn += 1;
      await writeFile(turnPath, String(turn));

      // Primary key for this prompt — carried into every change/pre_blob
      // and used to pair session prompts with transcript interactions
      // without relying on text-content comparison (which breaks on
      // identical repeated prompts like "continue").
      const promptId = randomUUID();
      await writeFile(join(sessionDir, PROMPT_ID_FILE), promptId);

      await appendJsonl(join(sessionDir, PROMPTS_FILE), {
        event: NORMALIZED_EVENT_KINDS.prompt,
        timestamp: event.timestamp,
        prompt: event.prompt,
        prompt_id: promptId,
        turn,
      });
      await appendJsonl(eventsPath, {
        event: NORMALIZED_EVENT_KINDS.prompt,
        session_id: event.sessionId,
        timestamp: event.timestamp,
        prompt_id: promptId,
        turn,
        model: event.model ?? null,
      });
      if (adapter.name === AGENT_NAMES.cursor) {
        process.stdout.write(JSON.stringify({ continue: true }));
      }
      break;
    }

    case NORMALIZED_EVENT_KINDS.response: {
      const turn = await readCurrentTurn(sessionDir);
      await appendJsonl(join(sessionDir, EVENTS_FILE), {
        event: NORMALIZED_EVENT_KINDS.response,
        session_id: event.sessionId,
        timestamp: event.timestamp,
        turn,
        response: event.response ?? null,
      });
      break;
    }

    case NORMALIZED_EVENT_KINDS.preEdit: {
      // Capture blob hash before AI edit for line-level attribution.
      const absPath = event.file ?? "";
      const filePath = await normalizeToRepoRelative(absPath);

      // Read current turn and prompt_id for causal attribution.
      const turn = await readCurrentTurn(sessionDir);
      const promptId = await readCurrentPromptId(sessionDir);

      // Write blob to object store before the edit happens.
      const preBlob = isAbsolute(absPath) ? await blobHash(absPath) : EMPTY_BLOB;

      await appendJsonl(join(sessionDir, PRE_BLOBS_FILE), {
        event: PRE_BLOB_EVENT,
        turn,
        prompt_id: promptId,
        file: filePath,
        blob: preBlob,
        // tool_use_id links this pre-blob to its PostToolUse counterpart,
        // enabling correct pairing even when async hooks fire out of order.
        tool_use_id: event.toolUseId ?? null,
      });

      // Gemini BeforeTool requires {"decision": "allow"} on stdout.
      if (adapter.name === AGENT_NAMES.gemini) {
        process.stdout.write(JSON.stringify({ decision: "allow" }));
      }
      break;
    }

    case NORMALIZED_EVENT_KINDS.fileChange: {
      // Normalize absolute paths to repo-relative for consistent matching.
      const absPath = event.file ?? "";
      const filePath = await normalizeToRepoRelative(absPath);

      // Read current turn and prompt_id for causal attribution.
      const turn = await readCurrentTurn(sessionDir);
      const promptId = await readCurrentPromptId(sessionDir);

      // Capture post-edit blob hash for line-level attribution.
      const postBlob = isAbsolute(absPath) ? await blobHash(absPath) : EMPTY_BLOB;
      // Cursor emits repeated same-file edits without a stable event ID. Persist a
      // per-edit key so split commits do not consume later edits early.
      const changeId =
        adapter.name === AGENT_NAMES.cursor
          ? `${event.timestamp}:${event.tool ?? NORMALIZED_EVENT_KINDS.fileChange}:${filePath}:${postBlob}`
          : null;

      await appendJsonl(join(sessionDir, CHANGES_FILE), {
        event: NORMALIZED_EVENT_KINDS.fileChange,
        timestamp: event.timestamp,
        tool: event.tool,
        file: filePath,
        session_id: event.sessionId,
        turn,
        prompt_id: promptId,
        blob: postBlob,
        change_id: changeId,
        edit_added: event.editStats?.added ?? null,
        edit_deleted: event.editStats?.deleted ?? null,
        // Same tool_use_id as the matching pre_blob entry — used for reliable pairing
        // even when this async hook fires after the next prompt has advanced the turn counter.
        tool_use_id: event.toolUseId ?? null,
      });
      break;
    }

    case NORMALIZED_EVENT_KINDS.preCommit: {
      if (adapter.name === AGENT_NAMES.gemini) {
        const headBefore = await readCurrentHead();
        await writeFile(
          join(sessionDir, PENDING_COMMIT_FILE),
          `${JSON.stringify(
            {
              command: event.commitCommand ?? "",
              head_before: headBefore,
              timestamp: event.timestamp,
            },
            null,
            JSON_INDENT_SPACES,
          )}\n`,
        );
        process.stdout.write(JSON.stringify({ decision: GEMINI_ALLOW_DECISION }));
        break;
      }

      if (adapter.name === AGENT_NAMES.cursor) {
        const headBefore = await readCurrentHead();
        await writeFile(
          join(sessionDir, PENDING_COMMIT_FILE),
          `${JSON.stringify(
            {
              command: event.commitCommand ?? "",
              head_before: headBefore,
              timestamp: event.timestamp,
            },
            null,
            JSON_INDENT_SPACES,
          )}\n`,
        );
        process.stdout.write(JSON.stringify({ continue: true }));
        break;
      }

      // Inject Agentnote-Session trailer into the git commit part of the command.
      // The command may be chained (e.g., "git add . && git commit -m '...' && git push"),
      // so we must inject --trailer into the git commit segment only, not at the end.
      const cmd = event.commitCommand ?? "";
      if (
        !cmd.includes(TRAILER_KEY) &&
        event.sessionId &&
        (await hasRecordableSessionData(sessionDir))
      ) {
        const trailer = `--trailer '${TRAILER_KEY}: ${event.sessionId}'`;
        const updatedCmd = injectGitCommitTrailer(cmd, trailer);
        if (updatedCmd) {
          process.stdout.write(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: CLAUDE_PRE_TOOL_USE_EVENT,
                updatedInput: {
                  command: updatedCmd,
                },
              },
            }),
          );
        }
      }
      break;
    }

    case NORMALIZED_EVENT_KINDS.postCommit: {
      if (adapter.name === AGENT_NAMES.cursor || adapter.name === AGENT_NAMES.gemini) {
        const pendingPath = join(sessionDir, PENDING_COMMIT_FILE);
        if (!existsSync(pendingPath)) break;

        let headBefore: string | null = null;
        try {
          const pending = JSON.parse(await readFile(pendingPath, TEXT_ENCODING)) as {
            head_before?: string | null;
          };
          headBefore = pending.head_before?.trim() || null;
        } catch {
          headBefore = null;
        }

        const headAfter = await readCurrentHead();
        try {
          await unlink(pendingPath);
        } catch {
          // ignore cleanup errors
        }
        if (!headAfter || headAfter === headBefore) break;
      }

      try {
        await recordCommitEntry({
          agentnoteDirPath,
          sessionId: event.sessionId,
          transcriptPath: event.transcriptPath,
        });
      } catch {
        // Never break the workflow if entry recording fails.
      }
      break;
    }
  }
}
