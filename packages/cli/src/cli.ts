import { enable } from "./commands/enable.js";
import { disable } from "./commands/disable.js";
import { commit } from "./commands/commit.js";
import { show } from "./commands/show.js";
import { log } from "./commands/log.js";
import { status } from "./commands/status.js";
import { hook } from "./commands/hook.js";
import { pr } from "./commands/pr.js";

const VERSION = "0.1.0";

const HELP = `
lore — remember why your code changed

usage:
  lore enable             add hooks to .claude/settings.json (commit to share)
  lore disable            remove hooks from .claude/settings.json
  lore commit [args]      git commit with session context attached
  lore show [commit]      show session details for a commit
  lore log [n]            list recent commits with session info
  lore pr [base] [--json]  generate report for a PR (markdown or JSON)
  lore status             show current tracking state
  lore version            print version
  lore help               show this help
`.trim();

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case "enable":
    await enable();
    break;
  case "disable":
    await disable();
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
  case "hook":
    await hook();
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(`lore v${VERSION}`);
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
