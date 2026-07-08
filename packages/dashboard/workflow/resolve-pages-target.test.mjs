import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  derivePagesPaths,
  extractJobBlock,
  hasPagesPublishStep,
  parseUploadPagesArtifactPath,
  resolvePagesBaseUrl,
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

test("derivePagesPaths uses a Pages URL served at the domain root", () => {
  assert.deepEqual(
    derivePagesPaths({
      pagesBaseUrl: "https://improved-guacamole-abc123.pages.github.io/",
      repository: "acme/apps",
    }),
    {
      site: "https://improved-guacamole-abc123.pages.github.io",
      base: "/dashboard",
    },
  );
});

test("derivePagesPaths uses a Pages URL with a project path", () => {
  assert.deepEqual(
    derivePagesPaths({
      pagesBaseUrl: "https://acme.github.io/apps/",
      repository: "acme/apps",
    }),
    { site: "https://acme.github.io", base: "/apps/dashboard" },
  );
});

test("derivePagesPaths falls back to the repository layout without a Pages URL", () => {
  assert.deepEqual(derivePagesPaths({ repository: "wasabeef/AgentNote" }), {
    site: "https://wasabeef.github.io",
    base: "/AgentNote/dashboard",
  });
  assert.deepEqual(derivePagesPaths({ repository: "wasabeef/wasabeef.github.io" }), {
    site: "https://wasabeef.github.io",
    base: "/dashboard",
  });
});

test("derivePagesPaths falls back when the Pages URL is invalid", () => {
  assert.deepEqual(
    derivePagesPaths({ pagesBaseUrl: "not a url", repository: "acme/apps" }),
    { site: "https://acme.github.io", base: "/apps/dashboard" },
  );
});

test("resolvePagesBaseUrl prefers a valid explicit override", async () => {
  const result = await resolvePagesBaseUrl({
    override: "https://pages.example.com/site/",
    repository: "acme/apps",
    token: "token",
    fetcher: () => {
      throw new Error("fetch must not run when the override is valid");
    },
  });
  assert.equal(result, "https://pages.example.com/site/");
});

test("resolvePagesBaseUrl resolves html_url from the Pages API", async () => {
  const requests = [];
  const result = await resolvePagesBaseUrl({
    override: "",
    repository: "acme/apps",
    token: "token",
    apiUrl: "https://api.example.com",
    fetcher: async (url, options) => {
      requests.push({ url, authorization: options.headers.authorization });
      return {
        ok: true,
        json: async () => ({ html_url: "https://improved-guacamole-abc123.pages.github.io/" }),
      };
    },
  });
  assert.equal(result, "https://improved-guacamole-abc123.pages.github.io/");
  assert.deepEqual(requests, [
    { url: "https://api.example.com/repos/acme/apps/pages", authorization: "Bearer token" },
  ]);
});

test("resolvePagesBaseUrl ignores an invalid override and falls back to the API", async () => {
  const result = await resolvePagesBaseUrl({
    override: "not a url",
    repository: "acme/apps",
    token: "token",
    fetcher: async () => ({
      ok: true,
      json: async () => ({ html_url: "https://acme.github.io/apps/" }),
    }),
  });
  assert.equal(result, "https://acme.github.io/apps/");
});

test("resolvePagesBaseUrl returns null when the API is unavailable", async () => {
  assert.equal(
    await resolvePagesBaseUrl({
      override: "",
      repository: "acme/apps",
      token: "token",
      fetcher: async () => ({ ok: false, json: async () => ({}) }),
    }),
    null,
  );
  assert.equal(
    await resolvePagesBaseUrl({
      override: "",
      repository: "acme/apps",
      token: "token",
      fetcher: async () => {
        throw new Error("network unreachable");
      },
    }),
    null,
  );
});

test("resolvePagesBaseUrl returns null without a repository or token", async () => {
  const fetcher = () => {
    throw new Error("fetch must not run without credentials");
  };
  assert.equal(
    await resolvePagesBaseUrl({ override: "", repository: "", token: "token", fetcher }),
    null,
  );
  assert.equal(
    await resolvePagesBaseUrl({ override: "", repository: "acme/apps", token: "", fetcher }),
    null,
  );
});
