import { commit } from "./commands/commit.js";
import { deinit } from "./commands/deinit.js";
import { hook } from "./commands/hook.js";
import { init } from "./commands/init.js";
import { log } from "./commands/log.js";
import { pr } from "./commands/pr.js";
import { pushNotes } from "./commands/push-notes.js";
import { session } from "./commands/session.js";
import { show } from "./commands/show.js";
import { status } from "./commands/status.js";

declare const __VERSION__: string;
const VERSION = __VERSION__;

const HELP = `
agent-note v${VERSION} — remember why your code changed

usage:
  agent-note init --agent <name>    set up hooks, workflow, and notes auto-fetch (agents: claude, codex, cursor, gemini)
                                    [--no-hooks] [--no-action] [--no-notes] [--no-git-hooks] [--hooks] [--action]
  agent-note deinit --agent <name>  remove hooks and config [--remove-workflow] [--keep-notes]
  agent-note show [commit]          show session details for a commit
  agent-note log [n]                list recent commits with session info
  agent-note pr [base] [--json] [--update <PR#>] [--output description|comment]
                                    generate PR report or update PR description/comment
  agent-note session <id>           show commits for a session
  agent-note commit [args]          git commit with session tracking
  agent-note status                 show current tracking state
  agent-note version                print version
  agent-note help                   show this help
`.trim();

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case "init":
    await init(args);
    break;
  case "deinit":
    await deinit(args);
    break;
  case "commit":
    await commit(args);
    break;
  case "show":
    await show(args[0]);
    break;
  case "log":
    await log(args[0] ? parseInt(args[0], 10) : 10);
    break;
  case "pr":
    await pr(args);
    break;
  case "status":
    await status();
    break;
  case "session":
    await session(args[0]);
    break;
  case "hook":
    await hook(args);
    break;
  case "record": {
    // Record agentnote entry for HEAD — used by post-commit git hook.
    // Unlike `commit`, this does NOT run `git commit`.
    // Session ID is passed as argument (validated by the hook) to avoid re-reading
    // the session file and prevent TOCTOU races with concurrent sessions.
    const sid = args[0];
    if (sid) {
      try {
        const { recordCommitEntry } = await import("./core/record.js");
        const { agentnoteDir } = await import("./paths.js");
        const dir = await agentnoteDir();
        await recordCommitEntry({ agentnoteDirPath: dir, sessionId: sid });
      } catch {
        /* never break git */
      }
    }
    break;
  }
  case "push-notes":
    await pushNotes(args);
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(`agent-note v${VERSION}`);
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    console.log(HELP);
    break;
  default:
    console.error(`unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
}
