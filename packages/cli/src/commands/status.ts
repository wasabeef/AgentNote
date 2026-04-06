import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { sessionFile, root } from "../paths.js";
import { gitSafe } from "../git.js";
import { claudeCode } from "../agents/claude-code.js";

const VERSION = "0.1.0";

export async function status(): Promise<void> {
  console.log(`agentnote v${VERSION}`);
  console.log();

  const repoRoot = await root();
  const adapter = claudeCode;
  const hooksActive = await adapter.isEnabled(repoRoot);

  if (hooksActive) {
    console.log("hooks:   active");
  } else {
    console.log("hooks:   not configured (run 'agentnote enable')");
  }

  const sessionPath = await sessionFile();
  if (existsSync(sessionPath)) {
    const sid = (await readFile(sessionPath, "utf-8")).trim();
    console.log(`session: ${sid.slice(0, 8)}…`);
  } else {
    console.log("session: none");
  }

  const { stdout } = await gitSafe([
    "log",
    "-20",
    "--format=%(trailers:key=Agentnote-Session,valueonly)",
  ]);

  const linked = stdout
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  console.log(`linked:  ${linked}/20 recent commits`);
}
