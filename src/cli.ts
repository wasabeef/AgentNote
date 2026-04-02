import { parseArgs } from "node:util";
import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { commit } from "./commands/commit.js";
import { show } from "./commands/show.js";
import { log } from "./commands/log.js";
import { status } from "./commands/status.js";

const VERSION = "0.1.0";

const HELP = `
lore — コードの「なぜ」を Git に残す

usage:
  lore start             hooks を設定し session tracking を開始
  lore stop              hooks を削除し tracking を停止
  lore commit [args]     session を紐づけて git commit
  lore show [commit]     commit の session 情報を表示
  lore log [n]           直近 n 件の commit と session を表示
  lore status            現在の状態を表示
  lore version           バージョンを表示
  lore help              このヘルプを表示
`.trim();

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case "start":
    await start();
    break;
  case "stop":
    await stop();
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
  case "status":
    await status();
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
