import { stat } from "node:fs/promises";
import { claudeCode } from "../agents/claude-code.js";
import {
  BAR_WIDTH_FULL,
  TRAILER_KEY,
  TRUNCATE_PROMPT,
  TRUNCATE_RESPONSE_SHOW,
} from "../core/constants.js";
import type { AgentnoteEntry } from "../core/entry.js";
import { readNote } from "../core/storage.js";
import { git } from "../git.js";

interface Interaction {
  prompt: string;
  response: string | null;
  files_touched?: string[];
}

export async function show(commitRef?: string): Promise<void> {
  const ref = commitRef ?? "HEAD";

  const commitInfo = await git(["log", "-1", "--format=%h %s", ref]);
  const commitSha = await git(["log", "-1", "--format=%H", ref]);

  const sessionId = (
    await git(["log", "-1", `--format=%(trailers:key=${TRAILER_KEY},valueonly)`, ref])
  ).trim();

  console.log(`commit:  ${commitInfo}`);

  if (!sessionId) {
    console.log("session: none (no agentnote data)");
    return;
  }

  console.log(`session: ${sessionId}`);

  const raw = await readNote(commitSha);
  const entry = raw as unknown as AgentnoteEntry | null;

  if (entry) {
    console.log();
    const ratioBar = renderRatioBar(entry.ai_ratio);
    const lineDetail =
      entry.ai_added_lines !== undefined &&
      entry.total_added_lines !== undefined &&
      entry.total_added_lines > 0
        ? ` (${entry.ai_added_lines}/${entry.total_added_lines} lines)`
        : "";
    console.log(`ai:      ${entry.ai_ratio}%${lineDetail} ${ratioBar}`);
    console.log(
      `files:   ${entry.files_in_commit.length} changed, ${entry.files_by_ai.length} by AI`,
    );

    if (entry.files_in_commit.length > 0) {
      console.log();
      for (const file of entry.files_in_commit) {
        const isAi = entry.files_by_ai.includes(file);
        const marker = isAi ? "  🤖" : "  👤";
        console.log(`  ${file}${marker}`);
      }
    }

    // Support both current (interactions) and legacy (prompts) formats.
    const legacy = entry as unknown as { prompts?: string[] };
    const interactions: Interaction[] =
      entry.interactions ??
      (legacy.prompts ?? []).map((p: string) => ({
        prompt: p,
        response: null,
      }));

    if (interactions.length > 0) {
      console.log();
      console.log(`prompts: ${interactions.length}`);

      for (let i = 0; i < interactions.length; i++) {
        const interaction = interactions[i];
        console.log();
        console.log(`  ${i + 1}. ${truncateLines(interaction.prompt, TRUNCATE_PROMPT)}`);
        if (interaction.response) {
          console.log(`     → ${truncateLines(interaction.response, TRUNCATE_RESPONSE_SHOW)}`);
        }
        if (interaction.files_touched && interaction.files_touched.length > 0) {
          for (const file of interaction.files_touched) {
            console.log(`     📄 ${file}`);
          }
        }
      }
    }
  } else {
    console.log("entry:   no agentnote note found for this commit");
  }

  // Show transcript location only if available locally.
  const adapter = claudeCode;
  const transcriptPath = adapter.findTranscript(sessionId);
  if (transcriptPath) {
    console.log();
    const stats = await stat(transcriptPath);
    const sizeKb = (stats.size / 1024).toFixed(1);
    console.log(`transcript: ${transcriptPath} (${sizeKb} KB)`);
  }
}

function renderRatioBar(ratio: number): string {
  const width = BAR_WIDTH_FULL;
  const filled = Math.round((ratio / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

function truncateLines(text: string, maxLen: number): string {
  const firstLine = text.split("\n")[0];
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, maxLen)}…`;
}
