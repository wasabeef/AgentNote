import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { root, agentnoteDir } from "../paths.js";
import { claudeCode } from "../agents/claude-code.js";
import { gitSafe } from "../git.js";

const WORKFLOW_TEMPLATE = `name: Agent Note
on:
  pull_request:
    types: [opened, synchronize]
concurrency:
  group: agentnote-\${{ github.event.pull_request.number }}
  cancel-in-progress: true
permissions:
  contents: read
  pull-requests: write
jobs:
  report:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: wasabeef/agentnote@v0
`;

export async function init(args: string[]): Promise<void> {
  const skipHooks = args.includes("--no-hooks");
  const skipAction = args.includes("--no-action");
  const skipNotes = args.includes("--no-notes");
  const hooksOnly = args.includes("--hooks");
  const actionOnly = args.includes("--action");

  const repoRoot = await root();
  const results: string[] = [];

  // Always create the data directory.
  await mkdir(await agentnoteDir(), { recursive: true });

  // Hooks
  if (!skipHooks && !actionOnly) {
    const adapter = claudeCode;
    if (await adapter.isEnabled(repoRoot)) {
      results.push("  · hooks already configured");
    } else {
      await adapter.installHooks(repoRoot);
      results.push("  ✓ hooks added to .claude/settings.json");
    }
  }

  // GitHub Action workflow
  if (!skipAction && !hooksOnly) {
    const workflowDir = join(repoRoot, ".github", "workflows");
    const workflowPath = join(workflowDir, "agentnote.yml");

    if (existsSync(workflowPath)) {
      results.push("  · workflow already exists at .github/workflows/agentnote.yml");
    } else {
      await mkdir(workflowDir, { recursive: true });
      await writeFile(workflowPath, WORKFLOW_TEMPLATE);
      results.push("  ✓ workflow created at .github/workflows/agentnote.yml");
    }
  }

  // Auto-fetch notes on git pull
  if (!skipNotes && !hooksOnly && !actionOnly) {
    const { stdout } = await gitSafe([
      "config",
      "--get-all",
      "remote.origin.fetch",
    ]);

    if (stdout.includes("refs/notes/agentnote")) {
      results.push("  · git already configured to fetch notes");
    } else {
      await gitSafe([
        "config",
        "--add",
        "remote.origin.fetch",
        "+refs/notes/agentnote:refs/notes/agentnote",
      ]);
      results.push("  ✓ git configured to auto-fetch notes on pull");
    }
  }

  // Output
  console.log("");
  console.log("agentnote init");
  console.log("");
  for (const line of results) {
    console.log(line);
  }

  // Determine what needs to be committed
  const toCommit: string[] = [];
  if (!skipHooks && !actionOnly) toCommit.push(".claude/settings.json");
  if (!skipAction && !hooksOnly) {
    const workflowPath = join(repoRoot, ".github", "workflows", "agentnote.yml");
    if (existsSync(workflowPath)) toCommit.push(".github/workflows/agentnote.yml");
  }

  if (toCommit.length > 0) {
    console.log("");
    console.log("  Next: commit and push these files");
    console.log(`    git add ${toCommit.join(" ")}`);
    console.log('    git commit -m "chore: enable agentnote session tracking"');
    console.log("    git push");
  }
  console.log("");
}
