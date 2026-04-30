import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  extractJobBlock,
  hasPagesPublishStep,
  parseUploadPagesArtifactPath,
  resolvePagesTarget,
} from "./resolve-pages-target.mjs";

test("parseUploadPagesArtifactPath returns null when the workflow does not upload Pages", () => {
  assert.equal(
    parseUploadPagesArtifactPath(`name: CI
jobs:
  build:
    steps:
      - uses: actions/checkout@v6
`),
    null,
  );
});

test("parseUploadPagesArtifactPath reads the Pages artifact path", () => {
  assert.equal(
    parseUploadPagesArtifactPath(`name: Docs
jobs:
  build:
    steps:
      - run: npm run build
      - name: Upload site
        uses: actions/upload-pages-artifact@v5
        with:
          path: website/dist
`),
    "website/dist",
  );
});

test("parseUploadPagesArtifactPath uses the GitHub action default when path is omitted", () => {
  assert.equal(
    parseUploadPagesArtifactPath(`name: Docs
jobs:
  build:
    steps:
      - uses: actions/upload-pages-artifact@v5
`),
    "_site",
  );
});

test("resolvePagesTarget selects standalone mode without an external Pages artifact step", () => {
  const target = resolvePagesTarget({
    workspaceDir: "/repo",
    workflowText: "name: Agent Note Dashboard\n",
  });

  assert.equal(target.publishMode, "standalone");
  assert.equal(target.internalUpload, "true");
  assert.equal(target.canBuild, "true");
  assert.equal(target.pagesDir, join("/repo", ".agentnote-pages"));
});

test("resolvePagesTarget integrates into the existing Pages artifact path", () => {
  const target = resolvePagesTarget({
    workspaceDir: "/repo",
    jobId: "build",
    workflowText: `name: Docs
jobs:
  build:
    steps:
      - uses: actions/upload-pages-artifact@v5
        with:
          path: website/dist
`,
  });

  assert.equal(target.publishMode, "integrated");
  assert.equal(target.internalUpload, "false");
  assert.equal(target.canBuild, "true");
  assert.equal(target.pagesDir, join("/repo", "website", "dist"));
});

test("resolvePagesTarget blocks when the Pages artifact belongs to another job", () => {
  const target = resolvePagesTarget({
    workspaceDir: "/repo",
    jobId: "dashboard",
    workflowText: `name: Docs
jobs:
  dashboard:
    steps:
      - uses: wasabeef/AgentNote@v0
        with:
          dashboard: true
  build:
    steps:
      - uses: actions/upload-pages-artifact@v5
        with:
          path: website/dist
`,
  });

  assert.equal(target.publishMode, "blocked");
  assert.equal(target.internalUpload, "false");
  assert.equal(target.canBuild, "false");
  assert.equal(target.reason, "other-job");
});

test("resolvePagesTarget blocks standalone publish when another workflow owns Pages", () => {
  const target = resolvePagesTarget({
    workspaceDir: "/repo",
    jobId: "build",
    workflowText: `name: Agent Note Dashboard
jobs:
  build:
    steps:
      - uses: wasabeef/AgentNote@v0
        with:
          dashboard: true
`,
    otherWorkflowTexts: [`name: Docs
jobs:
  build:
    steps:
      - uses: actions/upload-pages-artifact@v5
        with:
          path: website/dist
  deploy:
    steps:
      - uses: actions/deploy-pages@v4
`],
  });

  assert.equal(target.publishMode, "blocked");
  assert.equal(target.internalUpload, "false");
  assert.equal(target.canBuild, "false");
  assert.equal(target.reason, "other-workflow");
});

test("resolvePagesTarget blocks standalone publish when the existing Pages path is dynamic", () => {
  const target = resolvePagesTarget({
    workspaceDir: "/repo",
    jobId: "build",
    workflowText: `name: Docs
jobs:
  build:
    steps:
      - uses: actions/upload-pages-artifact@v5
        with:
          path: \${{ steps.site.outputs.path }}
`,
  });

  assert.equal(target.publishMode, "blocked");
  assert.equal(target.internalUpload, "false");
  assert.equal(target.canBuild, "false");
  assert.equal(target.reason, "dynamic-path");
});

test("extractJobBlock returns the requested job body only", () => {
  const block = extractJobBlock(`name: Docs
jobs:
  build:
    steps:
      - run: npm run build
  deploy:
    steps:
      - uses: actions/deploy-pages@v4
`, "build");

  assert.ok(block?.includes("npm run build"));
  assert.ok(!block?.includes("deploy-pages"));
});

test("hasPagesPublishStep detects Pages upload and deploy actions", () => {
  assert.equal(hasPagesPublishStep("uses: actions/upload-pages-artifact@v5"), true);
  assert.equal(hasPagesPublishStep("uses: actions/deploy-pages@v4"), true);
  assert.equal(hasPagesPublishStep("uses: actions/checkout@v6"), false);
});
