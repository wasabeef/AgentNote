import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  extractJobBlock,
  hasPagesPublishStep,
  parseUploadPagesArtifactPath,
  resolvePagesTarget,
  resolveWorkflowPath,
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

test("parseUploadPagesArtifactPath reads quoted paths and skips comments in the with block", () => {
  assert.equal(
    parseUploadPagesArtifactPath(`name: Docs
jobs:
  build:
    steps:
      - uses: actions/upload-pages-artifact@v5
        with:
          # GitHub Pages site output
          path: 'website/dist'
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

test("resolvePagesTarget falls back to whole-workflow scan when jobId is empty", () => {
  const target = resolvePagesTarget({
    workspaceDir: "/repo",
    jobId: "",
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
  assert.equal(target.pagesDir, join("/repo", "website", "dist"));
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
      - uses: wasabeef/AgentNote@v1
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
      - uses: wasabeef/AgentNote@v1
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

test("resolvePagesTarget blocks Pages artifact paths outside the workspace", () => {
  const relativeEscape = resolvePagesTarget({
    workspaceDir: "/repo",
    jobId: "build",
    workflowText: `name: Docs
jobs:
  build:
    steps:
      - uses: actions/upload-pages-artifact@v5
        with:
          path: ../outside
`,
  });
  const absoluteEscape = resolvePagesTarget({
    workspaceDir: "/repo",
    jobId: "build",
    workflowText: `name: Docs
jobs:
  build:
    steps:
      - uses: actions/upload-pages-artifact@v5
        with:
          path: /tmp/site
`,
  });

  assert.equal(relativeEscape.publishMode, "blocked");
  assert.equal(relativeEscape.reason, "outside-workspace");
  assert.equal(absoluteEscape.publishMode, "blocked");
  assert.equal(absoluteEscape.reason, "outside-workspace");
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

test("extractJobBlock supports quoted job ids", () => {
  const block = extractJobBlock(`name: Docs
jobs:
  'build-site':
    steps:
      - run: npm run build
  deploy:
    steps:
      - uses: actions/deploy-pages@v4
`, "build-site");

  assert.ok(block?.includes("npm run build"));
  assert.ok(!block?.includes("deploy-pages"));
});

test("hasPagesPublishStep detects Pages upload and deploy actions", () => {
  assert.equal(hasPagesPublishStep("uses: actions/upload-pages-artifact@v5"), true);
  assert.equal(hasPagesPublishStep("uses: actions/deploy-pages@v4"), true);
  assert.equal(hasPagesPublishStep("uses: actions/checkout@v6"), false);
});

test("resolveWorkflowPath resolves only workflow files in the caller repository", () => {
  assert.equal(
    resolveWorkflowPath({
      repositoryName: "wasabeef/AgentNote",
      workflowReference: "wasabeef/AgentNote/.github/workflows/docs.yml@refs/heads/main",
      workspaceDir: "/repo",
    }),
    join("/repo", ".github", "workflows", "docs.yml"),
  );
  assert.equal(
    resolveWorkflowPath({
      repositoryName: "wasabeef/AgentNote",
      workflowReference: "",
      workspaceDir: "/repo",
    }),
    null,
  );
  assert.equal(
    resolveWorkflowPath({
      repositoryName: "wasabeef/AgentNote",
      workflowReference: "other/AgentNote/.github/workflows/docs.yml@refs/heads/main",
      workspaceDir: "/repo",
    }),
    null,
  );
  assert.equal(
    resolveWorkflowPath({
      repositoryName: "wasabeef/AgentNote",
      workflowReference: "wasabeef/AgentNote/scripts/docs.yml@refs/heads/main",
      workspaceDir: "/repo",
    }),
    null,
  );
});
