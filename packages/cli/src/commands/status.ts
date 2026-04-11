import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgent, listAgents } from "../agents/index.js";
import { TRAILER_KEY } from "../core/constants.js";
import { readSessionAgent } from "../core/session.js";
import { gitSafe } from "../git.js";
import { agentnoteDir, root, sessionFile } from "../paths.js";

declare const __VERSION__: string;
const VERSION = __VERSION__;

export async function status(): Promise<void> {
  console.log(`agentnote v${VERSION}`);
  console.log();

  const repoRoot = await root();
  const enabledAgents: string[] = [];
  for (const agentName of listAgents()) {
    if (await getAgent(agentName).isEnabled(repoRoot)) {
      enabledAgents.push(agentName);
    }
  }

  if (enabledAgents.length > 0) {
    console.log(`hooks:   active (${enabledAgents.join(", ")})`);
  } else {
    console.log("hooks:   not configured (run 'agentnote init')");
  }

  const sessionPath = await sessionFile();
  if (existsSync(sessionPath)) {
    const sid = (await readFile(sessionPath, "utf-8")).trim();
    console.log(`session: ${sid.slice(0, 8)}…`);
    const agent = await readSessionAgent(join(await agentnoteDir(), "sessions", sid));
    if (agent) {
      console.log(`agent:   ${agent}`);
    }
  } else {
    console.log("session: none");
  }

  const { stdout } = await gitSafe([
    "log",
    "-20",
    `--format=%(trailers:key=${TRAILER_KEY},valueonly)`,
  ]);

  const linked = stdout.split("\n").filter((line) => line.trim().length > 0).length;
  console.log(`linked:  ${linked}/20 recent commits`);
}
