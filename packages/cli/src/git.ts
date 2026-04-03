import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Run a git command and return its stdout. */
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

/** Run a git command and return its exit code instead of throwing. */
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

/** Get the repository root path. */
export async function repoRoot(): Promise<string> {
  return git(["rev-parse", "--show-toplevel"]);
}
