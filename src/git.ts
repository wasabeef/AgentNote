import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** git コマンドを実行し stdout を返す */
export async function git(
  args: string[],
  options?: { cwd?: string },
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: options?.cwd,
    encoding: "utf-8",
  });
  return stdout.trim();
}

/** git コマンドを実行し、終了コードを返す（エラーを投げない） */
export async function gitSafe(
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; exitCode: number }> {
  try {
    const stdout = await git(args, options);
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout?.trim() ?? "", exitCode: err.code ?? 1 };
  }
}

/** リポジトリルートを取得 */
export async function repoRoot(): Promise<string> {
  return git(["rev-parse", "--show-toplevel"]);
}
