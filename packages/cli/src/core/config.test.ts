import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agentnote-config-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", async () => {
    const config = await loadConfig(testDir);
    assert.equal(config.pr.output, "description");
    assert.equal(config.pr.format, "chat");
  });

  it("reads agentnote.yml", async () => {
    writeFileSync(join(testDir, "agentnote.yml"), "pr:\n  output: comment\n  format: table\n");
    const config = await loadConfig(testDir);
    assert.equal(config.pr.output, "comment");
    assert.equal(config.pr.format, "table");
  });

  it("reads .agentnote.yml as fallback", async () => {
    writeFileSync(join(testDir, ".agentnote.yml"), "pr:\n  output: comment\n");
    const config = await loadConfig(testDir);
    assert.equal(config.pr.output, "comment");
    assert.equal(config.pr.format, "chat"); // default
  });

  it("prefers agentnote.yml over .agentnote.yml", async () => {
    writeFileSync(join(testDir, "agentnote.yml"), "pr:\n  output: description\n");
    writeFileSync(join(testDir, ".agentnote.yml"), "pr:\n  output: comment\n");
    const config = await loadConfig(testDir);
    assert.equal(config.pr.output, "description");
  });

  it("handles invalid YAML gracefully", async () => {
    writeFileSync(join(testDir, "agentnote.yml"), ": invalid yaml [[[");
    const config = await loadConfig(testDir);
    assert.equal(config.pr.output, "description"); // defaults
  });

  it("ignores unknown values and uses defaults", async () => {
    writeFileSync(
      join(testDir, "agentnote.yml"),
      "pr:\n  output: unknown_value\n  format: invalid\n",
    );
    const config = await loadConfig(testDir);
    assert.equal(config.pr.output, "description");
    assert.equal(config.pr.format, "chat");
  });

  it("handles comments in YAML", async () => {
    writeFileSync(
      join(testDir, "agentnote.yml"),
      "# config\npr:\n  output: comment # use comment mode\n  format: table\n",
    );
    const config = await loadConfig(testDir);
    assert.equal(config.pr.output, "comment");
    assert.equal(config.pr.format, "table");
  });

  it("handles partial config (only format)", async () => {
    writeFileSync(join(testDir, "agentnote.yml"), "pr:\n  format: table\n");
    const config = await loadConfig(testDir);
    assert.equal(config.pr.output, "description"); // default
    assert.equal(config.pr.format, "table");
  });
});
