import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TEXT_ENCODING } from "./core/constants.js";

const execFileAsync = promisify(execFile);

type ShellToken = {
  value: string;
  start: number;
  end: number;
};

type GitCommitCommand = {
  /** Index where flags should be inserted, immediately after the commit token. */
  insertAt: number;
};

/** Run a git command and return its stdout. */
export async function git(args: string[], options?: { cwd?: string }): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: options?.cwd,
    encoding: TEXT_ENCODING,
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
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    return {
      stdout: typeof e.stdout === "string" ? e.stdout.trim() : "",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

/** Get the repository root path. */
export async function repoRoot(): Promise<string> {
  return git(["rev-parse", "--show-toplevel"]);
}

function isShellControlStart(command: string, index: number): number {
  const char = command[index];
  const next = command[index + 1];
  if (char === "&" && next === "&") return 2;
  if (char === "|" && next === "|") return 2;
  if (char === ";" || char === "|" || char === "\n") return 1;
  return 0;
}

function isEnvAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

function tokenizeShellCommand(command: string): ShellToken[][] {
  const segments: ShellToken[][] = [[]];
  let token: ShellToken | null = null;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let comment = false;

  const currentSegment = () => segments[segments.length - 1];
  const ensureToken = (index: number): ShellToken => {
    token ??= { value: "", start: index, end: index };
    return token;
  };
  const finishToken = (index: number) => {
    if (!token) return;
    token.end = index;
    currentSegment().push(token);
    token = null;
  };
  const markTokenEnd = (index: number) => {
    if (!token) return;
    token.end = index;
  };
  const finishSegment = () => {
    if (currentSegment().length > 0) segments.push([]);
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (comment) {
      if (char === "\n") {
        comment = false;
        finishSegment();
      }
      continue;
    }

    if (escaped) {
      ensureToken(index - 1).value += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
        markTokenEnd(index + 1);
        continue;
      }
      if (quote === '"' && char === "\\") {
        escaped = true;
        continue;
      }
      ensureToken(index).value += char;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      ensureToken(index);
      continue;
    }

    if (char === "'" || char === '"') {
      ensureToken(index);
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      finishToken(index);
      if (char === "\n") finishSegment();
      continue;
    }

    if (char === "#" && !token) {
      comment = true;
      continue;
    }

    const controlLength = isShellControlStart(command, index);
    if (controlLength > 0) {
      finishToken(index);
      finishSegment();
      index += controlLength - 1;
      continue;
    }

    ensureToken(index).value += char;
  }

  finishToken(command.length);
  return segments.filter((segment) => segment.length > 0);
}

function findSimpleCommandIndex(tokens: ShellToken[]): number {
  let index = 0;

  while (index < tokens.length && isEnvAssignment(tokens[index].value)) {
    index += 1;
  }

  if (tokens[index]?.value === "env") {
    index += 1;
    while (index < tokens.length) {
      const value = tokens[index].value;
      if (isEnvAssignment(value)) {
        index += 1;
        continue;
      }
      if (value === "-i" || value === "--ignore-environment") {
        index += 1;
        continue;
      }
      break;
    }
  }

  if (tokens[index]?.value === "command") {
    index += 1;
  }

  return index;
}

function gitOptionConsumesValue(value: string): boolean {
  return ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(value);
}

function findGitCommitToken(tokens: ShellToken[]): ShellToken | null {
  let index = findSimpleCommandIndex(tokens);
  if (tokens[index]?.value !== "git") return null;

  index += 1;
  while (index < tokens.length) {
    const value = tokens[index].value;
    if (value === "commit") {
      const hasAmend = tokens.slice(index + 1).some((token) => {
        return token.value === "--amend" || token.value.startsWith("--amend=");
      });
      return hasAmend ? null : tokens[index];
    }

    if (value === "--") return null;
    if (gitOptionConsumesValue(value)) {
      index += 2;
      continue;
    }
    if (
      value.startsWith("--git-dir=") ||
      value.startsWith("--work-tree=") ||
      value.startsWith("--namespace=") ||
      value.startsWith("-c=")
    ) {
      index += 1;
      continue;
    }
    if (value.startsWith("-")) {
      index += 1;
      continue;
    }
    return null;
  }

  return null;
}

export function findGitCommitCommand(command: string): GitCommitCommand | null {
  for (const segment of tokenizeShellCommand(command)) {
    const commitToken = findGitCommitToken(segment);
    if (commitToken) return { insertAt: commitToken.end };
  }
  return null;
}

export function injectGitCommitTrailer(command: string, trailer: string): string | null {
  const match = findGitCommitCommand(command);
  if (!match) return null;
  return `${command.slice(0, match.insertAt)} ${trailer}${command.slice(match.insertAt)}`;
}
