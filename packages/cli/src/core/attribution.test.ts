import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countLines, expandNewPositions, parseUnifiedHunks } from "./attribution.js";

describe("parseUnifiedHunks", () => {
  it("parses single hunk with explicit counts", () => {
    const hunks = parseUnifiedHunks("@@ -1,3 +1,5 @@ some context");
    assert.equal(hunks.length, 1);
    assert.deepEqual(hunks[0], { oldStart: 1, oldCount: 3, newStart: 1, newCount: 5 });
  });

  it("parses hunk with implicit count=1", () => {
    const hunks = parseUnifiedHunks("@@ -10 +12 @@");
    assert.equal(hunks.length, 1);
    assert.deepEqual(hunks[0], { oldStart: 10, oldCount: 1, newStart: 12, newCount: 1 });
  });

  it("parses multiple hunks from diff output", () => {
    const diff = `diff --git a/file b/file
index abc..def 100644
--- a/file
+++ b/file
@@ -1,2 +1,3 @@ header
+new line
@@ -10,0 +11,2 @@ other
+added1
+added2`;
    const hunks = parseUnifiedHunks(diff);
    assert.equal(hunks.length, 2);
    assert.deepEqual(hunks[0], { oldStart: 1, oldCount: 2, newStart: 1, newCount: 3 });
    assert.deepEqual(hunks[1], { oldStart: 10, oldCount: 0, newStart: 11, newCount: 2 });
  });

  it("returns empty array for non-diff input", () => {
    assert.deepEqual(parseUnifiedHunks("no hunks here"), []);
    assert.deepEqual(parseUnifiedHunks(""), []);
  });

  it("parses pure deletion hunk (newCount=0)", () => {
    const hunks = parseUnifiedHunks("@@ -5,3 +4,0 @@");
    assert.equal(hunks.length, 1);
    assert.deepEqual(hunks[0], { oldStart: 5, oldCount: 3, newStart: 4, newCount: 0 });
  });
});

describe("expandNewPositions", () => {
  it("expands single hunk to line positions", () => {
    const positions = expandNewPositions([{ oldStart: 0, oldCount: 0, newStart: 5, newCount: 3 }]);
    assert.deepEqual([...positions].sort(), [5, 6, 7]);
  });

  it("returns empty set for zero-count hunks", () => {
    const positions = expandNewPositions([{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 0 }]);
    assert.equal(positions.size, 0);
  });

  it("unions multiple hunks", () => {
    const positions = expandNewPositions([
      { oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 },
      { oldStart: 0, oldCount: 0, newStart: 10, newCount: 3 },
    ]);
    assert.deepEqual(
      [...positions].sort((a, b) => a - b),
      [1, 2, 10, 11, 12],
    );
  });
});

describe("countLines", () => {
  it("sums added and deleted across hunks", () => {
    const result = countLines([
      { oldStart: 1, oldCount: 3, newStart: 1, newCount: 5 },
      { oldStart: 10, oldCount: 2, newStart: 12, newCount: 0 },
    ]);
    assert.deepEqual(result, { added: 5, deleted: 5 });
  });

  it("returns zeros for empty hunks", () => {
    assert.deepEqual(countLines([]), { added: 0, deleted: 0 });
  });
});
