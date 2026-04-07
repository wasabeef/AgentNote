import { commit } from "./commands/commit.js";
import { hook } from "./commands/hook.js";
import { init } from "./commands/init.js";
import { log } from "./commands/log.js";
import { pr } from "./commands/pr.js";
import { session } from "./commands/session.js";
import { show } from "./commands/show.js";
import { status } from "./commands/status.js";

const VERSION = "0.1.0";

const HELP = `
agentnote — remember why your code changed

usage:
  agentnote init                 set up hooks, workflow, and notes auto-fetch
  agentnote show [commit]        show session details for a commit
  agentnote log [n]              list recent commits with session info
  agentnote status               show current tracking state
  agentnote version              print version
  agentnote help                 show this help
`.trim();

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case "init":
    await init(args);
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
    await hook();
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(`agentnote v${VERSION}`);
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
