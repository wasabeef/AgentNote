import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { getAgent, getDefaultAgent, hasAgent } from "../agents/index.js";
import type { HookInput } from "../agents/types.js";
import {
  CHANGES_FILE,
  EMPTY_BLOB,
  EVENTS_FILE,
  HEARTBEAT_FILE,
  PENDING_COMMIT_FILE,
  PRE_BLOBS_FILE,
  PROMPTS_FILE,
  SESSION_FILE,
  SESSIONS_DIR,
  TRAILER_KEY,
  TURN_FILE,
} from "../core/constants.js";
import { appendJsonl } from "../core/jsonl.js";
import { recordCommitEntry } from "../core/record.js";
import { rotateLogs } from "../core/rotate.js";
import { writeSessionAgent, writeSessionTranscriptPath } from "../core/session.js";
import { git } from "../git.js";
import { agentnoteDir } from "../paths.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeCodexPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hookEventName = value.hook_event_name;
  const sessionId = value.session_id;
  const hasTranscriptPath =
    typeof value.transcript_path === "string" || value.transcript_path === null;
  if (typeof hookEventName !== "string" || typeof sessionId !== "string") return false;
  return hasTranscriptPath && ["SessionStart", "UserPromptSubmit", "Stop"].includes(hookEventName);
}

export function isSynchronousHookEvent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.hook_event_name !== "string") return false;
  return ["PreToolUse", "beforeSubmitPrompt", "beforeShellExecution", "BeforeTool"].includes(
    value.hook_event_name,
  );
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
  return Buffer.concat(chunks).toString("utf-8");
}

async function readCurrentTurn(sessionDir: string): Promise<number> {
  const turnPath = join(sessionDir, TURN_FILE);
  if (!existsSync(turnPath)) return 0;
  const raw = (await readFile(turnPath, "utf-8")).trim();
  return Number.parseInt(raw, 10) || 0;
}

async function readCurrentHead(): Promise<string | null> {
  try {
    return (await git(["rev-parse", "HEAD"])).trim();
  } catch {
    return null;
  }
}

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
  const explicitAgent = agentArgIndex >= 0 && Boolean(args[agentArgIndex + 1]);
  const agentName =
    explicitAgent && args[agentArgIndex + 1] ? args[agentArgIndex + 1] : getDefaultAgent().name;
  if (!hasAgent(agentName)) return;

  if (!explicitAgent && looksLikeCodexPayload(peek)) {
    console.error("agentnote: Codex hook payload detected; run `agentnote hook --agent codex`");
    process.exitCode = 1;
    return;
  }

  const adapter = getAgent(agentName);
  const input: HookInput = { raw, sync };
  const event = adapter.parseEvent(input);
  if (!event) {
    // Gemini BeforeTool requires {"decision": "allow"} even for unrecognized tools.
    if (adapter.name === "gemini" && input.sync) {
      // Reuse already-parsed peek to avoid double JSON.parse.
      if (isRecord(peek) && peek.hook_event_name === "BeforeTool") {
        process.stdout.write(JSON.stringify({ decision: "allow" }));
      }
    }
    return;
  }

  const agentnoteDirPath = await agentnoteDir();
  const sessionDir = join(agentnoteDirPath, SESSIONS_DIR, event.sessionId);
  await mkdir(sessionDir, { recursive: true });

  switch (event.kind) {
    case "session_start": {
      await writeFile(join(agentnoteDirPath, SESSION_FILE), event.sessionId);
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      await appendJsonl(join(sessionDir, EVENTS_FILE), {
        event: "session_start",
        session_id: event.sessionId,
        timestamp: event.timestamp,
        agent: adapter.name,
        model: event.model ?? null,
      });
      await writeFile(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));
      break;
    }

    case "stop": {
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      const turn = await readCurrentTurn(sessionDir);
      await appendJsonl(join(sessionDir, EVENTS_FILE), {
        event: "stop",
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
      // Gemini SessionEnd is a true session termination. Invalidate heartbeat and
      // clear the session pointer so prepare-commit-msg does not inject a stale
      // trailer into subsequent plain git commits.
      //
      // NOTE: Gemini's SessionEnd hook is best-effort — the CLI does not wait for
      // it to complete. This cleanup may not run before the process exits. The
      // prepare-commit-msg 1-hour heartbeat check remains the ultimate safeguard.
      if (adapter.name === "gemini") {
        try {
          await unlink(join(sessionDir, HEARTBEAT_FILE));
        } catch {
          // already removed or never created
        }
        // Only clear the global session pointer if it still points to *this*
        // session. A newer SessionStart (/clear, new terminal) may have already
        // overwritten it, and blindly deleting would break the active session.
        try {
          const sessionFilePath = join(agentnoteDirPath, SESSION_FILE);
          const currentPointer = (await readFile(sessionFilePath, "utf-8")).trim();
          if (currentPointer === event.sessionId) {
            await unlink(sessionFilePath);
          }
        } catch {
          // missing or unreadable — nothing to clean up
        }
      }
      break;
    }

    case "prompt": {
      await writeFile(join(agentnoteDirPath, SESSION_FILE), event.sessionId);
      await writeSessionAgent(sessionDir, adapter.name);
      if (event.transcriptPath) {
        await writeSessionTranscriptPath(sessionDir, event.transcriptPath);
      }
      const eventsPath = join(sessionDir, EVENTS_FILE);
      if (!existsSync(eventsPath)) {
        await appendJsonl(eventsPath, {
          event: "session_start",
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

      await appendJsonl(join(sessionDir, PROMPTS_FILE), {
        event: "prompt",
        timestamp: event.timestamp,
        prompt: event.prompt,
        turn,
      });
      await appendJsonl(eventsPath, {
        event: "prompt",
        session_id: event.sessionId,
        timestamp: event.timestamp,
        turn,
        model: event.model ?? null,
      });
      await writeFile(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));
      if (adapter.name === "cursor") {
        process.stdout.write(JSON.stringify({ continue: true }));
      }
      break;
    }

    case "response": {
      const turn = await readCurrentTurn(sessionDir);
      await appendJsonl(join(sessionDir, EVENTS_FILE), {
        event: "response",
        session_id: event.sessionId,
        timestamp: event.timestamp,
        turn,
        response: event.response ?? null,
      });
      break;
    }

    case "pre_edit": {
      // Capture blob hash before AI edit for line-level attribution.
      const absPath = event.file ?? "";
      const filePath = await normalizeToRepoRelative(absPath);

      // Read current turn for causal attribution.
      const turn = await readCurrentTurn(sessionDir);

      // Write blob to object store before the edit happens.
      const preBlob = isAbsolute(absPath) ? await blobHash(absPath) : EMPTY_BLOB;

      await appendJsonl(join(sessionDir, PRE_BLOBS_FILE), {
        event: "pre_blob",
        turn,
        file: filePath,
        blob: preBlob,
        // tool_use_id links this pre-blob to its PostToolUse counterpart,
        // enabling correct pairing even when async hooks fire out of order.
        tool_use_id: event.toolUseId ?? null,
      });

      // Gemini BeforeTool requires {"decision": "allow"} on stdout.
      if (adapter.name === "gemini") {
        process.stdout.write(JSON.stringify({ decision: "allow" }));
      }
      break;
    }

    case "file_change": {
      // Normalize absolute paths to repo-relative for consistent matching.
      const absPath = event.file ?? "";
      const filePath = await normalizeToRepoRelative(absPath);

      // Read current turn for causal attribution.
      const turn = await readCurrentTurn(sessionDir);

      // Capture post-edit blob hash for line-level attribution.
      const postBlob = isAbsolute(absPath) ? await blobHash(absPath) : EMPTY_BLOB;
      // Cursor emits repeated same-file edits without a stable event ID. Persist a
      // per-edit key so split commits do not consume later edits early.
      const changeId =
        adapter.name === "cursor"
          ? `${event.timestamp}:${event.tool ?? "file_change"}:${filePath}:${postBlob}`
          : null;

      await appendJsonl(join(sessionDir, CHANGES_FILE), {
        event: "file_change",
        timestamp: event.timestamp,
        tool: event.tool,
        file: filePath,
        session_id: event.sessionId,
        turn,
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

    case "pre_commit": {
      if (adapter.name === "gemini") {
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
            2,
          )}\n`,
        );
        process.stdout.write(JSON.stringify({ decision: "allow" }));
        break;
      }

      if (adapter.name === "cursor") {
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
            2,
          )}\n`,
        );
        process.stdout.write(JSON.stringify({ continue: true }));
        break;
      }

      // Inject Agentnote-Session trailer into the git commit part of the command.
      // The command may be chained (e.g., "git add . && git commit -m '...' && git push"),
      // so we must inject --trailer into the git commit segment only, not at the end.
      const cmd = event.commitCommand ?? "";
      if (!cmd.includes(TRAILER_KEY) && event.sessionId) {
        const trailer = `--trailer '${TRAILER_KEY}: ${event.sessionId}'`;
        // Replace "git commit" with "git commit --trailer ..." to ensure the trailer
        // is attached to the commit command, not to a subsequent chained command.
        const updatedCmd = cmd.replace(/(git\s+commit)/, `$1 ${trailer}`);
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              updatedInput: {
                command: updatedCmd,
              },
            },
          }),
        );
      }
      break;
    }

    case "post_commit": {
      if (adapter.name === "cursor" || adapter.name === "gemini") {
        const pendingPath = join(sessionDir, PENDING_COMMIT_FILE);
        if (!existsSync(pendingPath)) break;

        let headBefore: string | null = null;
        try {
          const pending = JSON.parse(await readFile(pendingPath, "utf-8")) as {
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
