import { stat } from "node:fs/promises";
import { git } from "../git.js";
import { readNote } from "../core/storage.js";
import { claudeCode } from "../agents/claude-code.js";
import type { LoreEntry } from "../core/entry.js";

interface Interaction {
  prompt: string;
  response: string | null;
}

export async function show(commitRef?: string): Promise<void> {
  const ref = commitRef ?? "HEAD";

  const commitInfo = await git(["log", "-1", "--format=%h %s", ref]);
  const commitSha = await git(["log", "-1", "--format=%H", ref]);

  const sessionId = (
    await git([
      "log",
      "-1",
      "--format=%(trailers:key=Lore-Session,valueonly)",
      ref,
    ])
  ).trim();

  console.log(`commit:  ${commitInfo}`);

  if (!sessionId) {
    console.log("session: none (no lore data)");
    return;
  }

  console.log(`session: ${sessionId}`);

  const raw = await readNote(commitSha);
  const entry = raw as unknown as LoreEntry | null;

  if (entry) {
    console.log();
    const ratioBar = renderRatioBar(entry.ai_ratio);
    console.log(`ai:      ${entry.ai_ratio}% ${ratioBar}`);
    console.log(
      `files:   ${entry.files_in_commit.length} changed, ${entry.files_by_ai.length} by AI`,
    );

    if (entry.files_in_commit.length > 0) {
      console.log();
      for (const file of entry.files_in_commit) {
        const isAi = entry.files_by_ai.some((af) => af.endsWith(file));
        const marker = isAi ? "  🤖" : "  👤";
        console.log(`  ${file}${marker}`);
      }
    }

    // Support both current (interactions) and legacy (prompts) formats.
    const interactions: Interaction[] =
      entry.interactions ??
      ((entry as any).prompts ?? []).map((p: string) => ({
        prompt: p,
        response: null,
      }));

    if (interactions.length > 0) {
      console.log();
      console.log(`prompts: ${interactions.length}`);

      for (let i = 0; i < interactions.length; i++) {
        const { prompt, response } = interactions[i];
        console.log();
        console.log(`  ${i + 1}. ${truncateLines(prompt, 120)}`);
        if (response) {
          console.log(`     → ${truncateLines(response, 200)}`);
        }
      }
    }
  } else {
    console.log("entry:   no lore note found for this commit");
  }

  // Show transcript location if available locally.
  console.log();
  const adapter = claudeCode;
  const transcriptPath = adapter.findTranscript(sessionId);
  if (transcriptPath) {
    const stats = await stat(transcriptPath);
    const sizeKb = (stats.size / 1024).toFixed(1);
    console.log(`transcript: ${transcriptPath} (${sizeKb} KB)`);
  } else {
    console.log("transcript: not found locally");
  }
}

function renderRatioBar(ratio: number): string {
  const width = 20;
  const filled = Math.round((ratio / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

function truncateLines(text: string, maxLen: number): string {
  const firstLine = text.split("\n")[0];
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen) + "…";
}
