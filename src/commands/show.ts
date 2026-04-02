import { readFile, stat } from "node:fs/promises";
import { existsSync, globSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { git } from "../git.js";
import { loreDir } from "../paths.js";

interface LoreEntry {
  commit_sha: string;
  timestamp: string;
  session_id: string;
  prompts: string[];
  files_by_ai: string[];
  files_in_commit: string[];
  ai_ratio: number;
}

export async function show(commitRef?: string): Promise<void> {
  const ref = commitRef ?? "HEAD";

  // commit 情報
  const commitInfo = await git(["log", "-1", "--format=%h %s", ref]);
  const commitSha = await git(["log", "-1", "--format=%H", ref]);

  // session ID を trailer から取得
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

  // lore entry を読む
  const loreDirPath = await loreDir();
  const entryFile = join(
    loreDirPath,
    "entries",
    `${commitSha.slice(0, 12)}.json`,
  );

  if (existsSync(entryFile)) {
    const entry: LoreEntry = JSON.parse(await readFile(entryFile, "utf-8"));

    // AI 比率
    console.log();
    const ratioBar = renderRatioBar(entry.ai_ratio);
    console.log(`ai:      ${entry.ai_ratio}% ${ratioBar}`);
    console.log(
      `files:   ${entry.files_in_commit.length} changed, ${entry.files_by_ai.length} by AI`,
    );

    // ファイル一覧
    if (entry.files_in_commit.length > 0) {
      console.log();
      for (const file of entry.files_in_commit) {
        const isAi = entry.files_by_ai.some((af) => af.endsWith(file));
        const marker = isAi ? "  🤖" : "  👤";
        console.log(`  ${file}${marker}`);
      }
    }

    // prompt 一覧
    if (entry.prompts.length > 0) {
      console.log();
      console.log(`prompts: ${entry.prompts.length}`);
      console.log();
      for (let i = 0; i < entry.prompts.length; i++) {
        const prompt = entry.prompts[i];
        const truncated =
          prompt.length > 120 ? prompt.slice(0, 120) + "…" : prompt;
        const lines = truncated.split("\n");
        console.log(`  ${i + 1}. ${lines[0]}`);
        for (const line of lines.slice(1)) {
          console.log(`     ${line}`);
        }
      }
    }
  } else {
    // entry がない場合は transcript を探す
    console.log("entry:   not found (commit was not made with 'lore commit')");
  }

  // transcript パス
  console.log();
  const claudeDir = join(homedir(), ".claude", "projects");
  const pattern = join(claudeDir, "**", "sessions", `${sessionId}.jsonl`);
  const matches = globSync(pattern);

  if (matches.length > 0) {
    const transcriptPath = matches[0];
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
