import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TEXT_ENCODING } from "./core/constants.js";

const execFileAsync = promisify(execFile);
const GIT_BINARY = "git";
const GIT_COMMAND_COMMIT = "commit";
const GIT_COMMAND_ENV = "env";
const GIT_COMMAND_WRAPPER = "command";
const GIT_AMEND_FLAG = "--amend";
const GIT_END_OF_OPTIONS = "--";
const SHELL_AND_OPERATOR = "&";
const SHELL_PIPE_OPERATOR = "|";
const SHELL_SEMICOLON_OPERATOR = ";";
const SHELL_NEWLINE = "\n";
const SHELL_ESCAPE = "\\";
const SHELL_COMMENT = "#";
const SHELL_SINGLE_QUOTE = "'";
const SHELL_DOUBLE_QUOTE = '"';
const ENV_IGNORE_FLAGS = new Set(["-i", "--ignore-environment"]);
const GIT_OPTIONS_WITH_VALUES = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const GIT_OPTIONS_WITH_INLINE_VALUES = ["--git-dir=", "--work-tree=", "--namespace=", "-c="];

type ShellToken = {
  value: string;
  start: number;
  end: number;
};

/** Location where `--trailer` can be inserted into one parsed git commit command. */
type GitCommitCommand = {
  /** Index where flags should be inserted, immediately after the commit token. */
  insertAt: number;
};

/** Run a git command through `execFile` and return trimmed stdout. */
export async function git(args: string[], options?: { cwd?: string }): Promise<string> {
  const { stdout } = await execFileAsync(GIT_BINARY, args, {
    cwd: options?.cwd,
    encoding: TEXT_ENCODING,
  });
  return stdout.trim();
}

/** Run a git command and return stdout plus exit code instead of throwing. */
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

/** Resolve the current repository root path using the Git CLI. */
export async function repoRoot(): Promise<string> {
  return git(["rev-parse", "--show-toplevel"]);
}

/** Return the length of a shell control operator starting at the given index. */
function isShellControlStart(command: string, index: number): number {
  const char = command[index];
  const next = command[index + 1];
  if (char === SHELL_AND_OPERATOR && next === SHELL_AND_OPERATOR) return 2;
  if (char === SHELL_PIPE_OPERATOR && next === SHELL_PIPE_OPERATOR) return 2;
  if (char === SHELL_SEMICOLON_OPERATOR || char === SHELL_PIPE_OPERATOR || char === SHELL_NEWLINE)
    return 1;
  return 0;
}

/** Detect shell-style environment assignments before a simple command. */
function isEnvAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

/**
 * Tokenize a shell command into simple-command segments.
 *
 * This intentionally supports only the shell features needed for hook command
 * inspection: quoting, escaping, comments, env assignments, and command
 * separators. It avoids executing or expanding the command.
 */
function tokenizeShellCommand(command: string): ShellToken[][] {
  const segments: ShellToken[][] = [[]];
  let token: ShellToken | null = null;
  let quote: typeof SHELL_SINGLE_QUOTE | typeof SHELL_DOUBLE_QUOTE | null = null;
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
      if (char === SHELL_NEWLINE) {
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
      if (quote === SHELL_DOUBLE_QUOTE && char === SHELL_ESCAPE) {
        escaped = true;
        continue;
      }
      ensureToken(index).value += char;
      continue;
    }

    if (char === SHELL_ESCAPE) {
      escaped = true;
      ensureToken(index);
      continue;
    }

    if (char === SHELL_SINGLE_QUOTE || char === SHELL_DOUBLE_QUOTE) {
      ensureToken(index);
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      finishToken(index);
      if (char === SHELL_NEWLINE) finishSegment();
      continue;
    }

    if (char === SHELL_COMMENT && !token) {
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

/** Find the first real command token after env/command wrappers. */
function findSimpleCommandIndex(tokens: ShellToken[]): number {
  let index = 0;

  while (index < tokens.length && isEnvAssignment(tokens[index].value)) {
    index += 1;
  }

  if (tokens[index]?.value === GIT_COMMAND_ENV) {
    index += 1;
    while (index < tokens.length) {
      const value = tokens[index].value;
      if (isEnvAssignment(value)) {
        index += 1;
        continue;
      }
      if (ENV_IGNORE_FLAGS.has(value)) {
        index += 1;
        continue;
      }
      break;
    }
  }

  if (tokens[index]?.value === GIT_COMMAND_WRAPPER) {
    index += 1;
  }

  return index;
}

/** Return whether a git global option consumes the following token as a value. */
function gitOptionConsumesValue(value: string): boolean {
  return GIT_OPTIONS_WITH_VALUES.has(value);
}

/** Find the `commit` token in a parsed `git commit` command segment. */
function findGitCommitToken(tokens: ShellToken[]): ShellToken | null {
  let index = findSimpleCommandIndex(tokens);
  if (tokens[index]?.value !== GIT_BINARY) return null;

  index += 1;
  while (index < tokens.length) {
    const value = tokens[index].value;
    if (value === GIT_COMMAND_COMMIT) {
      const hasAmend = tokens.slice(index + 1).some((token) => {
        return token.value === GIT_AMEND_FLAG || token.value.startsWith(`${GIT_AMEND_FLAG}=`);
      });
      return hasAmend ? null : tokens[index];
    }

    if (value === GIT_END_OF_OPTIONS) return null;
    if (gitOptionConsumesValue(value)) {
      index += 2;
      continue;
    }
    if (GIT_OPTIONS_WITH_INLINE_VALUES.some((prefix) => value.startsWith(prefix))) {
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

/** Locate a non-amend `git commit` command inside a possibly chained shell command. */
export function findGitCommitCommand(command: string): GitCommitCommand | null {
  for (const segment of tokenizeShellCommand(command)) {
    const commitToken = findGitCommitToken(segment);
    if (commitToken) return { insertAt: commitToken.end };
  }
  return null;
}

/** Inject an `Agentnote-Session` trailer into the git commit segment only. */
export function injectGitCommitTrailer(command: string, trailer: string): string | null {
  const match = findGitCommitCommand(command);
  if (!match) return null;
  return `${command.slice(0, match.insertAt)} ${trailer}${command.slice(match.insertAt)}`;
}
