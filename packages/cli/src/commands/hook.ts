import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { claudeCode } from "../agents/claude-code.js";
import type { HookInput } from "../agents/types.js";
import {
  CHANGES_FILE,
  EMPTY_BLOB,
  EVENTS_FILE,
  HEARTBEAT_FILE,
  PRE_BLOBS_FILE,
  PROMPTS_FILE,
  SESSION_FILE,
  SESSIONS_DIR,
  TRAILER_KEY,
  TRANSCRIPT_PATH_FILE,
  TURN_FILE,
} from "../core/constants.js";
import { appendJsonl } from "../core/jsonl.js";
import { recordCommitEntry } from "../core/record.js";
import { rotateLogs } from "../core/rotate.js";
import { git } from "../git.js";
import { agentnoteDir } from "../paths.js";

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

export async function hook(): Promise<void> {
  const raw = await readStdin();

  // Determine if this is a synchronous hook (PreToolUse) by peeking at the event name.
  let sync = false;
  try {
    const peek = JSON.parse(raw);
    sync = peek.hook_event_name === "PreToolUse";
  } catch {
    return;
  }

  const adapter = claudeCode;
  const input: HookInput = { raw, sync };
  const event = adapter.parseEvent(input);
  if (!event) return;

  const agentnoteDirPath = await agentnoteDir();
  const sessionDir = join(agentnoteDirPath, SESSIONS_DIR, event.sessionId);
  await mkdir(sessionDir, { recursive: true });

  switch (event.kind) {
    case "session_start": {
      await writeFile(join(agentnoteDirPath, SESSION_FILE), event.sessionId);
      if (event.transcriptPath) {
        await writeFile(join(sessionDir, TRANSCRIPT_PATH_FILE), event.transcriptPath);
      }
      await appendJsonl(join(sessionDir, EVENTS_FILE), {
        event: "session_start",
        session_id: event.sessionId,
        timestamp: event.timestamp,
        model: event.model ?? null,
      });
      await writeFile(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));
      break;
    }

    case "stop": {
      if (event.transcriptPath) {
        await writeFile(join(sessionDir, TRANSCRIPT_PATH_FILE), event.transcriptPath);
      }
      await appendJsonl(join(sessionDir, EVENTS_FILE), {
        event: "stop",
        session_id: event.sessionId,
        timestamp: event.timestamp,
      });
      // Do NOT invalidate heartbeat on Stop. Claude Code fires Stop when the AI
      // finishes responding, NOT when the session ends. The session remains active
      // for subsequent prompts. SessionStart from the next session overwrites the
      // session pointer and heartbeat naturally.
      break;
    }

    case "prompt": {
      // Rotate logs from previous prompt batch before starting fresh.
      // This ensures split commits each get scoped notes, while the next
      // prompt starts with clean JSONL files.
      const rotateId = Date.now().toString(36);
      await rotateLogs(sessionDir, rotateId, [PROMPTS_FILE, CHANGES_FILE, PRE_BLOBS_FILE]);

      // Increment turn counter for causal file attribution.
      const turnPath = join(sessionDir, TURN_FILE);
      let turn = 0;
      if (existsSync(turnPath)) {
        const raw = (await readFile(turnPath, "utf-8")).trim();
        turn = Number.parseInt(raw, 10) || 0;
      }
      turn += 1;
      await writeFile(turnPath, String(turn));

      await appendJsonl(join(sessionDir, PROMPTS_FILE), {
        event: "prompt",
        timestamp: event.timestamp,
        prompt: event.prompt,
        turn,
      });
      await writeFile(join(sessionDir, HEARTBEAT_FILE), String(Date.now()));
      break;
    }

    case "pre_edit": {
      // Capture blob hash before AI edit for line-level attribution.
      const absPath = event.file ?? "";
      const filePath = await normalizeToRepoRelative(absPath);

      // Read current turn for causal attribution.
      let turn = 0;
      const turnPath = join(sessionDir, TURN_FILE);
      if (existsSync(turnPath)) {
        const raw = (await readFile(turnPath, "utf-8")).trim();
        turn = Number.parseInt(raw, 10) || 0;
      }

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
      break;
    }

    case "file_change": {
      // Normalize absolute paths to repo-relative for consistent matching.
      const absPath = event.file ?? "";
      const filePath = await normalizeToRepoRelative(absPath);

      // Read current turn for causal attribution.
      let turn = 0;
      const turnPath = join(sessionDir, TURN_FILE);
      if (existsSync(turnPath)) {
        const raw = (await readFile(turnPath, "utf-8")).trim();
        turn = Number.parseInt(raw, 10) || 0;
      }

      // Capture post-edit blob hash for line-level attribution.
      const postBlob = isAbsolute(absPath) ? await blobHash(absPath) : EMPTY_BLOB;

      await appendJsonl(join(sessionDir, CHANGES_FILE), {
        event: "file_change",
        timestamp: event.timestamp,
        tool: event.tool,
        file: filePath,
        session_id: event.sessionId,
        turn,
        blob: postBlob,
        // Same tool_use_id as the matching pre_blob entry — used for reliable pairing
        // even when this async hook fires after the next prompt has advanced the turn counter.
        tool_use_id: event.toolUseId ?? null,
      });
      break;
    }

    case "pre_commit": {
      // Inject Agentnote-Session trailer using the session ID from the event directly,
      // not from the file — avoids race with async SessionStart/Stop writes.
      const cmd = event.commitCommand ?? "";
      if (!cmd.includes(TRAILER_KEY) && event.sessionId) {
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              updatedInput: {
                command: `${cmd} --trailer '${TRAILER_KEY}: ${event.sessionId}'`,
              },
            },
          }),
        );
      }
      break;
    }

    case "post_commit": {
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
