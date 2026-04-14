import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { appendJsonl, readJsonlEntries, readJsonlField } from "./jsonl.js";

describe("readJsonlField", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "agentnote-jsonl-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a specific field from each line and deduplicates", async () => {
    const file = join(dir, "field.jsonl");
    await appendJsonl(file, { prompt: "hello" });
    await appendJsonl(file, { prompt: "world" });
    await appendJsonl(file, { prompt: "hello" }); // duplicate
    const values = await readJsonlField(file, "prompt");
    assert.deepEqual(values, ["hello", "world"]);
  });

  it("returns empty array for nonexistent file", async () => {
    const values = await readJsonlField(join(dir, "does-not-exist.jsonl"), "prompt");
    assert.deepEqual(values, []);
  });

  it("skips malformed lines", async () => {
    const { writeFile } = await import("node:fs/promises");
    const file = join(dir, "malformed-field.jsonl");
    await writeFile(file, '{"prompt":"ok"}\nnot-json\n{"prompt":"also-ok"}\n');
    const values = await readJsonlField(file, "prompt");
    assert.deepEqual(values, ["ok", "also-ok"]);
  });

  it("skips lines where the field is missing", async () => {
    const file = join(dir, "missing-field.jsonl");
    await appendJsonl(file, { other: "x" });
    await appendJsonl(file, { prompt: "found" });
    const values = await readJsonlField(file, "prompt");
    assert.deepEqual(values, ["found"]);
  });
});

describe("readJsonlEntries", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "agentnote-jsonl-entries-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads all entries as full objects", async () => {
    const file = join(dir, "entries.jsonl");
    await appendJsonl(file, { a: 1 });
    await appendJsonl(file, { b: 2 });
    const entries = await readJsonlEntries(file);
    assert.deepEqual(entries, [{ a: 1 }, { b: 2 }]);
  });

  it("returns empty array for nonexistent file", async () => {
    const entries = await readJsonlEntries(join(dir, "does-not-exist.jsonl"));
    assert.deepEqual(entries, []);
  });

  it("skips malformed lines", async () => {
    const { writeFile } = await import("node:fs/promises");
    const file = join(dir, "malformed-entries.jsonl");
    await writeFile(file, '{"a":1}\nbad-json\n{"b":2}\n');
    const entries = await readJsonlEntries(file);
    assert.deepEqual(entries, [{ a: 1 }, { b: 2 }]);
  });
});

describe("appendJsonl", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "agentnote-jsonl-append-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends data to an existing file", async () => {
    const file = join(dir, "append.jsonl");
    await appendJsonl(file, { first: true });
    await appendJsonl(file, { second: true });
    const entries = await readJsonlEntries(file);
    assert.deepEqual(entries, [{ first: true }, { second: true }]);
  });

  it("creates a new file if it does not exist", async () => {
    const file = join(dir, "new-file.jsonl");
    await appendJsonl(file, { created: true });
    const entries = await readJsonlEntries(file);
    assert.deepEqual(entries, [{ created: true }]);
  });

  it("writes valid JSON per line", async () => {
    const { readFile } = await import("node:fs/promises");
    const file = join(dir, "valid-json.jsonl");
    await appendJsonl(file, { key: "value", num: 42 });
    const content = await readFile(file, "utf-8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), { key: "value", num: 42 });
  });
});
