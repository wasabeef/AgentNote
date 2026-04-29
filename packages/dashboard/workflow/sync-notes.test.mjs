import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DIFF_TOTAL_LINES,
  parseDiffFiles,
} from "./sync-notes.mjs";

test("parseDiffFiles keeps binary-only files as visible placeholders", () => {
  const files = parseDiffFiles(`diff --git a/assets/logo.png b/assets/logo.png
index 1234567..89abcde 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
diff --git a/assets/icon.png b/assets/icon.png
index 1234567..89abcde 100644
GIT binary patch
literal 0
`);

  assert.equal(files.length, 2);
  assert.equal(files[0].path, "assets/logo.png");
  assert.equal(files[0].binary, true);
  assert.equal(files[0].truncated, true);
  assert.deepEqual(files[0].lines, []);
  assert.equal(files[1].path, "assets/icon.png");
  assert.equal(files[1].binary, true);
  assert.equal(files[1].truncated, true);
  assert.deepEqual(files[1].lines, []);
});

test("parseDiffFiles keeps files that appear after the total diff limit", () => {
  const makeFile = (path, count) => `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -0,0 +1,${count} @@
${Array.from({ length: count }, (_, index) => `+${path} line ${index}`).join("\n")}
`;
  const rawDiff =
    makeFile("src/large-a.ts", 800) +
    makeFile("src/large-b.ts", 800) +
    makeFile("src/large-c.ts", 800) +
    makeFile("src/large-d.ts", 800) +
    `diff --git a/src/after-limit.ts b/src/after-limit.ts
--- a/src/after-limit.ts
+++ b/src/after-limit.ts
@@ -0,0 +1 @@
+after
`;
  assert.ok(
    rawDiff.split("\n").length > MAX_DIFF_TOTAL_LINES,
    "fixture should exceed the total diff limit",
  );

  const files = parseDiffFiles(rawDiff);

  const afterLimit = files.find((file) => file.path === "src/after-limit.ts");
  assert.ok(afterLimit, "file after total diff limit should not be dropped");
  assert.equal(afterLimit.truncated, true);
  assert.deepEqual(afterLimit.lines, []);
});
