import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { sessionFile, loreDir } from "../paths.js";
import { git } from "../git.js";

interface LoreEntry {
  commit_sha: string;
  timestamp: string;
  session_id: string;
  prompts: string[];
  files_by_ai: string[];
  files_in_commit: string[];
  ai_ratio: number;
}

/** commit の diff から変更されたファイル一覧を取得 */
async function getCommitFiles(ref: string): Promise<string[]> {
  try {
    const raw = await git(["diff-tree", "--no-commit-id", "--name-only", "-r", ref]);
    return raw.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** session の changes.jsonl から AI が変更したファイル一覧を取得 */
async function getAiChangedFiles(sessionDir: string): Promise<string[]> {
  const changesFile = join(sessionDir, "changes.jsonl");
  if (!existsSync(changesFile)) return [];

  const content = await readFile(changesFile, "utf-8");
  const files = new Set<string>();
  for (const line of content.trim().split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.file) files.add(entry.file);
    } catch {
      // skip malformed lines
    }
  }
  return [...files];
}

/** session の prompts.jsonl から全 prompt を取得 */
async function getPrompts(sessionDir: string): Promise<string[]> {
  const promptsFile = join(sessionDir, "prompts.jsonl");
  if (!existsSync(promptsFile)) return [];

  const content = await readFile(promptsFile, "utf-8");
  const prompts: string[] = [];
  for (const line of content.trim().split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.prompt) prompts.push(entry.prompt);
    } catch {
      // skip
    }
  }
  return prompts;
}

/** AI 比率を計算: commit 内のファイルのうち AI が触ったファイルの割合 */
function calcAiRatio(commitFiles: string[], aiFiles: string[]): number {
  if (commitFiles.length === 0) return 0;
  const aiSet = new Set(aiFiles.map((f) => f.replace(/^\/.*\//, ""))); // absolute → relative
  const matched = commitFiles.filter(
    (f) => aiSet.has(f) || [...aiSet].some((af) => af.endsWith(f)),
  );
  return Math.round((matched.length / commitFiles.length) * 100);
}

export async function commit(args: string[]): Promise<void> {
  const sf = await sessionFile();
  let sessionId = "";

  if (existsSync(sf)) {
    sessionId = (await readFile(sf, "utf-8")).trim();
  }

  // git commit に trailer を追加
  const gitArgs = ["commit"];
  if (sessionId) {
    gitArgs.push("--trailer", `Lore-Session: ${sessionId}`);
  }
  gitArgs.push(...args);

  // git commit を透過的に実行
  const child = spawn("git", gitArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  // commit 成功後: lore entry を記録
  if (sessionId) {
    try {
      const loreDirPath = await loreDir();
      const sessionDir = join(loreDirPath, "sessions", sessionId);
      const commitSha = await git(["rev-parse", "HEAD"]);
      const commitFiles = await getCommitFiles("HEAD");
      const aiFiles = await getAiChangedFiles(sessionDir);
      const prompts = await getPrompts(sessionDir);
      const aiRatio = calcAiRatio(commitFiles, aiFiles);

      const entry: LoreEntry = {
        commit_sha: commitSha,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        prompts,
        files_by_ai: aiFiles,
        files_in_commit: commitFiles,
        ai_ratio: aiRatio,
      };

      // entry を保存
      const entriesDir = join(loreDirPath, "entries");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(entriesDir, { recursive: true });
      const entryFile = join(entriesDir, `${commitSha.slice(0, 12)}.json`);
      await writeFile(entryFile, JSON.stringify(entry, null, 2) + "\n");

      // prompts と changes をローテーション（次の commit 用にリセット）
      const promptsFile = join(sessionDir, "prompts.jsonl");
      const changesFile = join(sessionDir, "changes.jsonl");
      if (existsSync(promptsFile)) {
        await rename(
          promptsFile,
          join(sessionDir, `prompts-${commitSha.slice(0, 8)}.jsonl`),
        );
      }
      if (existsSync(changesFile)) {
        await rename(
          changesFile,
          join(sessionDir, `changes-${commitSha.slice(0, 8)}.jsonl`),
        );
      }

      console.log(`lore: ${prompts.length} prompts, AI ratio ${aiRatio}%`);
    } catch (err: any) {
      // lore の記録失敗で commit を妨げない
      console.error(`lore: warning: ${err.message}`);
    }
  }
}
