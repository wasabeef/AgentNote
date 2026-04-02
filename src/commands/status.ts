import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hooksDir, sessionFile } from "../paths.js";
import { gitSafe } from "../git.js";

const VERSION = "0.1.0";

export async function status(): Promise<void> {
  console.log(`lore v${VERSION}`);
  console.log();

  // hooks 状態
  const hookPath = `${await hooksDir()}/lore-hook.sh`;
  if (existsSync(hookPath)) {
    console.log("hooks:   active");
  } else {
    console.log("hooks:   not configured (run 'lore start')");
  }

  // session 状態
  const sf = await sessionFile();
  if (existsSync(sf)) {
    const sid = (await readFile(sf, "utf-8")).trim();
    console.log(`session: ${sid.slice(0, 8)}…`);
  } else {
    console.log("session: none");
  }

  // 直近の lore-linked commits
  const { stdout } = await gitSafe([
    "log",
    "-20",
    "--format=%(trailers:key=Lore-Session,valueonly)",
  ]);

  const linked = stdout
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  console.log(`linked:  ${linked}/20 recent commits`);
}
