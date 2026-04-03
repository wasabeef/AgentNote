import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loreDir } from "../paths.js";
import { git } from "../git.js";
import { claudeCode } from "../agents/claude-code.js";
import type { HookInput, NormalizedEvent } from "../agents/types.js";
import { readJsonlField, appendJsonl } from "../core/jsonl.js";
import { writeNote } from "../core/storage.js";
import { buildEntry } from "../core/entry.js";
import { rotateLogs } from "../core/rotate.js";

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

  const loreDirPath = await loreDir();
  const sessionDir = join(loreDirPath, "sessions", event.sessionId);
  await mkdir(sessionDir, { recursive: true });

  switch (event.kind) {
    case "session_start": {
      await writeFile(join(loreDirPath, "session"), event.sessionId);
      if (event.transcriptPath) {
        await writeFile(join(sessionDir, "transcript_path"), event.transcriptPath);
      }
      await appendJsonl(join(sessionDir, "events.jsonl"), {
        event: "session_start",
        session_id: event.sessionId,
        timestamp: event.timestamp,
        model: event.model ?? null,
      });
      break;
    }

    case "stop": {
      await writeFile(join(loreDirPath, "session"), event.sessionId);
      if (event.transcriptPath) {
        await writeFile(join(sessionDir, "transcript_path"), event.transcriptPath);
      }
      await appendJsonl(join(sessionDir, "events.jsonl"), {
        event: "stop",
        session_id: event.sessionId,
        timestamp: event.timestamp,
      });
      break;
    }

    case "prompt": {
      await appendJsonl(join(sessionDir, "prompts.jsonl"), {
        event: "prompt",
        timestamp: event.timestamp,
        prompt: event.prompt,
      });
      break;
    }

    case "file_change": {
      await appendJsonl(join(sessionDir, "changes.jsonl"), {
        event: "file_change",
        timestamp: event.timestamp,
        tool: event.tool,
        file: event.file,
        session_id: event.sessionId,
      });
      break;
    }

    case "pre_commit": {
      // Inject Lore-Session trailer using the session ID from the event directly,
      // not from the file — avoids race with async SessionStart/Stop writes.
      const cmd = event.commitCommand ?? "";
      if (!cmd.includes("Lore-Session") && event.sessionId) {
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              updatedInput: {
                command: `${cmd} --trailer 'Lore-Session: ${event.sessionId}'`,
              },
            },
          }),
        );
      }
      break;
    }

    case "post_commit": {
      try {
        await recordEntry(loreDirPath, event.sessionId, event.transcriptPath);
      } catch {
        // Never break the workflow if entry recording fails.
      }
      break;
    }
  }
}

/** Record a lore entry as a git note after a successful commit. */
async function recordEntry(
  loreDirPath: string,
  sessionId: string,
  eventTranscriptPath?: string,
): Promise<void> {
  const sessionDir = join(loreDirPath, "sessions", sessionId);
  const commitSha = await git(["rev-parse", "HEAD"]);

  let commitFiles: string[] = [];
  try {
    const raw = await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    commitFiles = raw.split("\n").filter(Boolean);
  } catch {
    // empty
  }

  const aiFiles = await readJsonlField(join(sessionDir, "changes.jsonl"), "file");
  const prompts = await readJsonlField(join(sessionDir, "prompts.jsonl"), "prompt");

  // Resolve transcript path from event or saved file.
  const transcriptPath = eventTranscriptPath ?? await readSavedTranscriptPath(sessionDir);

  // Build interactions from transcript for accurate prompt-response pairing.
  const adapter = claudeCode;
  let interactions: Array<{ prompt: string; response: string | null }>;

  if (transcriptPath) {
    const allInteractions = await adapter.extractInteractions(transcriptPath);
    interactions = prompts.length > 0 && allInteractions.length > 0
      ? allInteractions.slice(-prompts.length)
      : prompts.map((p) => ({ prompt: p, response: null }));
  } else {
    interactions = prompts.map((p) => ({ prompt: p, response: null }));
  }

  const entry = buildEntry({
    sessionId,
    interactions,
    commitFiles,
    aiFiles,
  });

  await writeNote(commitSha, entry as unknown as Record<string, unknown>);
  await rotateLogs(sessionDir, commitSha);
}

async function readSavedTranscriptPath(sessionDir: string): Promise<string | null> {
  const saved = join(sessionDir, "transcript_path");
  if (!existsSync(saved)) return null;
  const p = (await readFile(saved, "utf-8")).trim();
  return p || null;
}
