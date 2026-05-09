import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AgentnoteEntry } from "../core/entry.js";

describe("agentnote why", () => {
  let testDir: string;
  let baseCommit: string;
  let featureCommit: string;
  let contextCommit: string;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-why-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email test@test.com", { cwd: testDir });
    execSync("git config user.name Test", { cwd: testDir });

    mkdirSync(join(testDir, "src"), { recursive: true });
    writeFileSync(join(testDir, "src", "app.ts"), "export const greeting = 'hello';\n");
    execSync("git add src/app.ts", { cwd: testDir });
    execSync("git commit -m 'chore: add app shell'", { cwd: testDir });
    baseCommit = execSync("git rev-parse HEAD", { cwd: testDir, encoding: "utf-8" }).trim();

    writeFileSync(
      join(testDir, "src", "app.ts"),
      "export const greeting = 'hello';\nexport const label = 'Agent Note';\n",
    );
    execSync("git add src/app.ts", { cwd: testDir });
    execSync("git commit -m 'feat: add label'", { cwd: testDir });
    featureCommit = execSync("git rev-parse HEAD", { cwd: testDir, encoding: "utf-8" }).trim();

    addNote(featureCommit, {
      v: 1,
      agent: "codex",
      session_id: "a1b2c3d4-aaaa-bbbb-cccc-dddddddddddd",
      timestamp: "2026-05-09T00:00:00.000Z",
      model: "gpt-5.4",
      interactions: [
        {
          prompt: "Add the Agent Note label to the app shell.",
          response: "I added the label export in src/app.ts.",
          files_touched: ["src/app.ts"],
        },
      ],
      files: [{ path: "src/app.ts", by_ai: true }],
      attribution: { ai_ratio: 100, method: "file" },
    });

    writeFileSync(
      join(testDir, "src", "app.ts"),
      "export const greeting = 'hello';\nexport const label = 'Agent Note';\nexport const ready = true;\n",
    );
    execSync("git add src/app.ts", { cwd: testDir });
    execSync("git commit -m 'feat: mark app ready'", { cwd: testDir });
    contextCommit = execSync("git rev-parse HEAD", { cwd: testDir, encoding: "utf-8" }).trim();

    addNote(contextCommit, {
      v: 1,
      agent: "codex",
      session_id: "b1b2c3d4-aaaa-bbbb-cccc-dddddddddddd",
      timestamp: "2026-05-09T00:00:00.000Z",
      model: "gpt-5.4",
      interactions: [
        {
          prompt: "Mark the app shell as ready after the label work.",
          response: "I added the ready export.",
        },
      ],
      files: [{ path: "src/app.ts", by_ai: false }],
      attribution: { ai_ratio: 0, method: "file" },
    });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("shows file-related Agent Note prompts for a blamed line", () => {
    const output = execFileSync("node", [cliPath, "why", "src/app.ts:2"], {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.match(output, /target: src\/app\.ts:2/);
    assert.match(output, /commit: [0-9a-f]{7} feat: add label/);
    assert.match(output, /agent:\s+codex/);
    assert.match(output, /ai ratio:\s+100%/);
    assert.match(output, /evidence: file/);
    assert.match(output, /evidence: file-level Agent Note data/);
    assert.match(output, /prompt:\s+Add the Agent Note label/);
    assert.match(output, /file:\s+src\/app\.ts/);
  });

  it("keeps missing notes explicit for older blamed lines", () => {
    const output = execFileSync("node", [cliPath, "why", "src/app.ts:1"], {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.match(output, new RegExp(`commit: ${baseCommit.slice(0, 7)} chore: add app shell`));
    assert.match(output, /evidence: none/);
    assert.match(output, /no Agent Note data exists/);
  });

  it("falls back to commit-level prompts when no file evidence exists", () => {
    const output = execFileSync("node", [cliPath, "why", "src/app.ts:3"], {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.match(output, new RegExp(`commit: ${contextCommit.slice(0, 7)} feat: mark app ready`));
    assert.match(output, /evidence: commit/);
    assert.match(output, /evidence: commit-level Agent Note data/);
    assert.match(output, /prompt:\s+Mark the app shell as ready/);
  });

  it("returns none when git blame cannot resolve the target", () => {
    const output = execFileSync("node", [cliPath, "why", "src/missing.ts:1"], {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.match(output, /evidence: none/);
    assert.match(output, /git blame did not return a committed line/);
  });

  it("supports range targets and the blame alias", () => {
    const output = execFileSync("node", [cliPath, "blame", "src/app.ts:1-3"], {
      cwd: testDir,
      encoding: "utf-8",
    });

    assert.match(output, /target: src\/app\.ts:1-3/);
    assert.match(output, new RegExp(baseCommit.slice(0, 7)));
    assert.match(output, new RegExp(featureCommit.slice(0, 7)));
    assert.match(output, new RegExp(contextCommit.slice(0, 7)));
  });

  function addNote(commitSha: string, entry: AgentnoteEntry): void {
    execFileSync(
      "git",
      ["notes", "--ref=agentnote", "add", "-f", "-m", JSON.stringify(entry), commitSha],
      {
        cwd: testDir,
      },
    );
  }
});
