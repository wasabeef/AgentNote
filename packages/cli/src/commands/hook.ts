import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { claudeCode } from "../agents/claude-code.js";
import type { HookInput } from "../agents/types.js";
import { appendJsonl } from "../core/jsonl.js";
import { recordCommitEntry } from "../core/record.js";
import { rotateLogs } from "../core/rotate.js";
import { git } from "../git.js";
import { agentnoteDir } from "../paths.js";

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
  const sessionDir = join(agentnoteDirPath, "sessions", event.sessionId);
  await mkdir(sessionDir, { recursive: true });

  switch (event.kind) {
    case "session_start": {
      await writeFile(join(agentnoteDirPath, "session"), event.sessionId);
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
      await writeFile(join(agentnoteDirPath, "session"), event.sessionId);
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
      // Rotate logs from previous prompt batch before starting fresh.
      // This ensures split commits each get scoped notes, while the next
      // prompt starts with clean JSONL files.
      const rotateId = Date.now().toString(36);
      await rotateLogs(sessionDir, rotateId);

      // Increment turn counter for causal file attribution.
      const turnFile = join(sessionDir, "turn");
      let turn = 0;
      if (existsSync(turnFile)) {
        const raw = (await readFile(turnFile, "utf-8")).trim();
        turn = Number.parseInt(raw, 10) || 0;
      }
      turn += 1;
      await writeFile(turnFile, String(turn));

      await appendJsonl(join(sessionDir, "prompts.jsonl"), {
        event: "prompt",
        timestamp: event.timestamp,
        prompt: event.prompt,
        turn,
      });
      break;
    }

    case "file_change": {
      // Normalize absolute paths to repo-relative for consistent matching.
      // Use git directly instead of cached root() since hook runs in different cwd contexts.
      let filePath = event.file ?? "";
      if (isAbsolute(filePath)) {
        try {
          const rawRoot = (await git(["rev-parse", "--show-toplevel"])).trim();
          // Resolve symlinks on the repo root (macOS /var → /private/var).
          const repoRoot = await realpath(rawRoot);
          // Normalize file path to match — add /private if root has it and file doesn't.
          let normalizedFile = filePath;
          if (repoRoot.startsWith("/private") && !normalizedFile.startsWith("/private")) {
            normalizedFile = `/private${normalizedFile}`;
          } else if (!repoRoot.startsWith("/private") && normalizedFile.startsWith("/private")) {
            normalizedFile = normalizedFile.replace(/^\/private/, "");
          }
          filePath = relative(repoRoot, normalizedFile);
        } catch {
          // Fallback: keep as-is.
        }
      }
      // Read current turn for causal attribution.
      let turn = 0;
      const turnFile = join(sessionDir, "turn");
      if (existsSync(turnFile)) {
        const raw = (await readFile(turnFile, "utf-8")).trim();
        turn = Number.parseInt(raw, 10) || 0;
      }

      await appendJsonl(join(sessionDir, "changes.jsonl"), {
        event: "file_change",
        timestamp: event.timestamp,
        tool: event.tool,
        file: filePath,
        session_id: event.sessionId,
        turn,
      });
      break;
    }

    case "pre_commit": {
      // Inject Agentnote-Session trailer using the session ID from the event directly,
      // not from the file — avoids race with async SessionStart/Stop writes.
      const cmd = event.commitCommand ?? "";
      if (!cmd.includes("Agentnote-Session") && event.sessionId) {
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              updatedInput: {
                command: `${cmd} --trailer 'Agentnote-Session: ${event.sessionId}'`,
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
