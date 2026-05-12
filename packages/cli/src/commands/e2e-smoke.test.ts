import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AgentnoteEntry } from "../core/entry.js";

type CliCase = {
  args: string[];
  includes?: RegExp;
  code?: number;
};

describe("agent-note dist CLI e2e smoke", () => {
  const cliPath = join(process.cwd(), "dist", "cli.js");
  let testDir: string;
  let homeDir: string;
  let commandCount = 0;
  let baseCommit = "";
  let featureCommit = "";
  let followupCommit = "";
  let scopedCommit = "";

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-e2e-smoke-"));
    homeDir = join(testDir, ".home");
    mkdirSync(homeDir, { recursive: true });
    git(["init"]);
    git(["config", "user.email", "e2e@example.com"]);
    git(["config", "user.name", "Agent Note E2E"]);

    mkdirSync(join(testDir, "src"), { recursive: true });
    mkdirSync(join(testDir, "docs"), { recursive: true });
    writeFileSync(join(testDir, "README.md"), "# E2E\n\nSeed\n");
    git(["add", "README.md"]);
    git(["commit", "-m", "chore: seed readme"]);
    baseCommit = gitOutput(["rev-parse", "HEAD"]);

    writeFileSync(
      join(testDir, "src", "app.ts"),
      "export const greeting = 'hello';\nexport const label = 'Agent Note';\n",
    );
    git(["add", "src/app.ts"]);
    git(["commit", "-m", "feat: add app label"]);
    featureCommit = gitOutput(["rev-parse", "HEAD"]);
    addNote(featureCommit, {
      v: 1,
      agent: "codex",
      session_id: "11111111-2222-4333-8444-555555555555",
      timestamp: "2026-05-12T00:00:00.000Z",
      model: "gpt-5.4",
      interactions: [
        {
          prompt: "Add the Agent Note label to src/app.ts.",
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
    writeFileSync(join(testDir, "docs", "space file.md"), "# Space File\n\nReady\n");
    git(["add", "src/app.ts", "docs/space file.md"]);
    git(["commit", "-m", "fix: mark app ready"]);
    followupCommit = gitOutput(["rev-parse", "HEAD"]);
    addNote(followupCommit, {
      v: 1,
      agent: "claude",
      session_id: "22222222-3333-4444-8555-666666666666",
      timestamp: "2026-05-12T00:01:00.000Z",
      model: "claude-opus-4-6",
      interactions: [
        {
          prompt: "Mark the app ready and document the spaced path.",
          response: "I updated src/app.ts and added docs/space file.md.",
          files_touched: ["src/app.ts", "docs/space file.md"],
        },
      ],
      files: [
        { path: "src/app.ts", by_ai: true },
        { path: "docs/space file.md", by_ai: true },
      ],
      attribution: { ai_ratio: 100, method: "file" },
    });

    mkdirSync(join(testDir, "@scope"), { recursive: true });
    writeFileSync(join(testDir, "@scope", "pkg.ts"), "export const scoped = true;\n");
    git(["add", "@scope/pkg.ts"]);
    git(["commit", "-m", "feat: add scoped package file"]);
    scopedCommit = gitOutput(["rev-parse", "HEAD"]);
    addNote(scopedCommit, {
      v: 1,
      agent: "cursor",
      session_id: "33333333-4444-4555-8666-777777777777",
      timestamp: "2026-05-12T00:02:00.000Z",
      model: "cursor",
      interactions: [
        {
          prompt: "Add a scoped package fixture.",
          response: "I added @scope/pkg.ts.",
          files_touched: ["@scope/pkg.ts"],
        },
      ],
      files: [{ path: "@scope/pkg.ts", by_ai: true }],
      attribution: { ai_ratio: 100, method: "file" },
    });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("runs many public commands against a note-rich repository", () => {
    const githubBlobUrl = "https://github.com/wasabeef/AgentNote/blob/main/src/app.ts#L2";
    const fileUrl = `file://${join(testDir, "src", "app.ts")}#L2`;
    const vscodeUrl = `vscode://file${join(testDir, "src", "app.ts")}:2:1`;
    const cases: CliCase[] = [
      { args: ["version"], includes: /agent-note v/ },
      { args: ["--version"], includes: /agent-note v/ },
      { args: ["help"], includes: /agent-note why/ },
      { args: ["--help"], includes: /agent-note init/ },
      { args: [], includes: /usage:/ },
      { args: ["status"], includes: /Agent Note|tracking|configured|not configured/i },
      { args: ["show"], includes: /feat: add scoped package file|Add a scoped package fixture/ },
      { args: ["show", "HEAD"], includes: /feat: add scoped package file|@scope\/pkg\.ts/ },
      { args: ["show", scopedCommit], includes: /@scope\/pkg\.ts|cursor/ },
      { args: ["show", followupCommit], includes: /docs\/space file\.md|claude/ },
      { args: ["show", featureCommit], includes: /src\/app\.ts|codex/ },
      { args: ["show", baseCommit], includes: /session: none|no agent-note data/i },
      { args: ["log"], includes: /feat: add scoped package file|fix: mark app ready/ },
      { args: ["log", "1"], includes: /feat: add scoped package file/ },
      { args: ["log", "2"], includes: /fix: mark app ready|feat: add scoped/ },
      { args: ["log", "5"], includes: /chore: seed readme|feat: add app label/ },
      {
        args: ["session", "11111111-2222-4333-8444-555555555555"],
        includes: /feat: add app label|codex/,
      },
      {
        args: ["session", "22222222-3333-4444-8555-666666666666"],
        includes: /fix: mark app ready|claude/,
      },
      {
        args: ["session", "33333333-4444-4555-8666-777777777777"],
        includes: /feat: add scoped package file|cursor/,
      },
      {
        args: ["session", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
        includes: /no commits|not found/i,
      },
      { args: ["pr", "HEAD~3"], includes: /Agent Note|feat: add app label|fix: mark app ready/ },
      { args: ["pr", "HEAD~3", "--json"], includes: /"commits"|"ai_ratio"/ },
      { args: ["pr", "HEAD~3", "--prompt-detail", "compact"], includes: /Agent Note/ },
      { args: ["pr", "HEAD~3", "--prompt-detail", "full"], includes: /Agent Note/ },
      { args: ["pr", "HEAD~3", "--output", "comment"], includes: /Agent Note/ },
      { args: ["pr", "HEAD~3", "--output", "description"], includes: /Agent Note/ },
      {
        args: ["pr", "HEAD~2", "--head", "HEAD"],
        includes: /fix: mark app ready|feat: add scoped/,
      },
      {
        args: ["pr", "HEAD~1", "--head", "HEAD", "--json"],
        includes: /feat: add scoped package file/,
      },
      { args: ["why", "src/app.ts:2"], includes: /target: src\/app\.ts:2|Agent Note|label/ },
      { args: ["why", "src/app.ts:2-3"], includes: /target: src\/app\.ts:2-3|Agent Note/ },
      { args: ["why", "src/app.ts:2:1"], includes: /target: src\/app\.ts:2|Agent Note/ },
      { args: ["why", "src/app.ts#L2"], includes: /target: src\/app\.ts:2|Agent Note/ },
      { args: ["why", "src/app.ts#L2-L3"], includes: /target: src\/app\.ts:2-3|Agent Note/ },
      { args: ["why", "@src/app.ts#L2"], includes: /target: src\/app\.ts:2|Agent Note/ },
      {
        args: ["why", "docs/space file.md#L1"],
        includes: /target: docs\/space file\.md:1|Agent Note/,
      },
      { args: ["why", "@scope/pkg.ts:1"], includes: /target: @scope\/pkg\.ts:1|Agent Note/ },
      { args: ["why", "@@scope/pkg.ts:1"], includes: /target: @scope\/pkg\.ts:1|Agent Note/ },
      { args: ["why", githubBlobUrl], includes: /target: src\/app\.ts:2|Agent Note/ },
      { args: ["why", fileUrl], includes: /target: src\/app\.ts:2|Agent Note/ },
      { args: ["why", vscodeUrl], includes: /target: src\/app\.ts:2|Agent Note/ },
      { args: ["blame", "src/app.ts:3"], includes: /target: src\/app\.ts:3|Agent Note/ },
      { args: ["blame", "@scope/pkg.ts#L1"], includes: /target: @scope\/pkg\.ts:1|Agent Note/ },
      {
        args: ["why", "README.md:1"],
        includes: /agent note:\n {2}evidence: none|no Agent Note data/i,
      },
    ];

    assertUniqueCases("public", cases);
    for (const testCase of cases) {
      runCli(`public ${testCase.args.join(" ")}`, testCase);
    }

    const invalidCases: CliCase[] = [
      { args: ["unknown"], code: 1, includes: /unknown command|usage/i },
      { args: ["show", "HEAD~1"], code: 1, includes: /commit must be HEAD|usage/i },
      { args: ["log", "0"], code: 1, includes: /positive|invalid|usage/i },
      { args: ["log", "abc"], code: 1, includes: /invalid|usage/i },
      { args: ["why"], code: 1, includes: /usage|target/i },
      { args: ["why", "src/app.ts"], code: 1, includes: /usage|target/i },
      { args: ["why", "src/app.ts:5-1"], code: 1, includes: /usage|line|target/i },
      {
        args: ["pr", "HEAD~3", "--prompt-detail", "medium"],
        code: 1,
        includes: /prompt_detail|compact|full/i,
      },
      { args: ["session"], code: 1, includes: /usage|session/i },
      { args: ["init", "--agent", "unknown"], code: 1, includes: /unknown|agent/i },
    ];
    assertUniqueCases("invalid", invalidCases);
    for (const testCase of invalidCases) {
      runCli(`invalid ${testCase.args.join(" ")}`, testCase);
    }

    assert.ok(commandCount >= 50, `expected broad dist CLI coverage, got ${commandCount} commands`);
  });

  it("runs setup and cleanup commands through the built CLI", () => {
    for (const agent of ["claude", "codex", "cursor", "gemini"]) {
      const dir = mkdtempSync(join(tmpdir(), `agentnote-e2e-init-${agent}-`));
      try {
        gitIn(dir, ["init"]);
        gitIn(dir, ["config", "user.email", "e2e@example.com"]);
        gitIn(dir, ["config", "user.name", "Agent Note E2E"]);
        runCli(`init ${agent}`, {
          args: ["init", "--agent", agent, "--no-action"],
          cwd: dir,
          includes: /agent-note init|hooks added/i,
        });
        runCli(`status ${agent}`, {
          args: ["status"],
          cwd: dir,
          includes: /Agent Note|tracking|configured|active|inactive/i,
        });
        runCli(`deinit ${agent}`, {
          args: ["deinit", "--agent", agent],
          cwd: dir,
          includes: /agent-note deinit|removed|not configured/i,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function runCli(label: string, testCase: CliCase & { cwd?: string }) {
    commandCount++;
    const result = spawnSync(process.execPath, [cliPath, ...testCase.args], {
      cwd: testCase.cwd ?? testDir,
      env: { ...process.env, HOME: homeDir, XDG_CONFIG_HOME: join(testDir, ".xdg") },
      encoding: "utf-8",
    });
    const expectedCode = testCase.code ?? 0;
    assert.equal(
      result.status,
      expectedCode,
      `${label}: expected exit ${expectedCode}, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    if (testCase.includes) {
      assert.match(result.stdout + result.stderr, testCase.includes, label);
    }
  }

  function assertUniqueCases(label: string, cases: CliCase[]) {
    const keys = cases.map((testCase) => testCase.args.join("\0"));
    assert.equal(new Set(keys).size, keys.length, `${label} CLI cases must be unique`);
  }

  function git(args: string[]) {
    gitIn(testDir, args);
  }

  function gitOutput(args: string[]): string {
    return execFileSync("git", args, { cwd: testDir, encoding: "utf-8" }).trim();
  }

  function gitIn(cwd: string, args: string[]) {
    execFileSync("git", args, { cwd, encoding: "utf-8" });
  }

  function addNote(commitSha: string, entry: AgentnoteEntry) {
    execFileSync(
      "git",
      ["notes", "--ref=agentnote", "add", "-f", "-m", JSON.stringify(entry), commitSha],
      {
        cwd: testDir,
      },
    );
  }
});
