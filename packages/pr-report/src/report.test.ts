import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMarkdown, type PrReport } from "./report.js";

const REVIEWER_CONTEXT_BEGIN = "<!-- agentnote-reviewer-context";
const REVIEWER_CONTEXT_END = "-->";

function baseReport(overrides: Partial<PrReport> = {}): PrReport {
  return {
    base: "main",
    head: "abc1234",
    repo_url: "https://github.com/example/project",
    dashboard_url: null,
    total_commits: 1,
    tracked_commits: 1,
    total_prompts: 1,
    total_files: 1,
    total_files_ai: 1,
    overall_ai_ratio: 100,
    overall_method: "file",
    model: "gpt-5.4",
    commits: [
      {
        sha: "abc123456789",
        short: "abc1234",
        message: "fix: preserve prompt context",
        session_id: "a1b2c3d4-aaaa-bbbb-cccc-000000000001",
        model: "gpt-5.4",
        ai_ratio: 100,
        attribution_method: "file",
        prompts_count: 1,
        files_total: 1,
        files_ai: 1,
        files: [{ path: "src/record.ts", by_ai: true }],
        interactions: [
          {
            context: "The previous response explains why src/record.ts needs this fix.",
            prompt: "Can this really improve the fix?",
            response: "I will keep the causal prompt and attach display-only context.",
          },
        ],
        attribution: {
          ai_ratio: 100,
          method: "file",
        },
      },
    ],
    ...overrides,
  };
}

function extractReviewerContext(markdown: string): string {
  const start = markdown.indexOf(REVIEWER_CONTEXT_BEGIN);
  const end = markdown.indexOf(REVIEWER_CONTEXT_END, start);
  assert.ok(start > -1, "reviewer context comment should exist");
  assert.ok(end > start, "reviewer context comment should be closed");
  return markdown.slice(start, end + REVIEWER_CONTEXT_END.length);
}

describe("renderMarkdown", () => {
  it("separates missing Agent Note data from a true zero AI ratio", () => {
    const missingReport = baseReport({
      tracked_commits: 0,
      total_prompts: 0,
      total_files: 0,
      total_files_ai: 0,
      overall_ai_ratio: 0,
      model: null,
      commits: [
        {
          sha: "def456789012",
          short: "def4567",
          message: "feat: human commit without note",
          session_id: null,
          model: null,
          ai_ratio: null,
          attribution_method: null,
          prompts_count: 0,
          files_total: 0,
          files_ai: 0,
          files: [],
          interactions: [],
          attribution: null,
        },
      ],
    });
    const trueZeroReport = baseReport({
      overall_ai_ratio: 0,
      commits: [
        {
          ...baseReport().commits[0],
          ai_ratio: 0,
          attribution: {
            ai_ratio: 0,
            method: "file",
          },
        },
      ],
    });

    const missingMarkdown = renderMarkdown(missingReport);
    const trueZeroMarkdown = renderMarkdown(trueZeroReport);

    assert.ok(missingMarkdown.includes("**Total AI Ratio:** —"));
    assert.ok(missingMarkdown.includes("**Agent Note data:** No tracked commits"));
    assert.ok(!missingMarkdown.includes("**Total AI Ratio:** ░░░░░░░░ 0%"));
    assert.ok(trueZeroMarkdown.includes("**Total AI Ratio:** ░░░░░░░░ 0%"));
    assert.ok(!trueZeroMarkdown.includes("No tracked commits"));
  });

  it("clamps malformed AI ratios while rendering progress bars", () => {
    const markdown = renderMarkdown(
      baseReport({
        overall_ai_ratio: 150,
        commits: [
          {
            ...baseReport().commits[0],
            ai_ratio: 150,
          },
        ],
      }),
    );

    assert.ok(markdown.includes("**Total AI Ratio:** ████████ 150%"));
    assert.ok(markdown.includes("| █████ 150% | 1 |"));
  });

  it("omits reviewer context when no commits have Agent Note data", () => {
    const markdown = renderMarkdown(
      baseReport({
        tracked_commits: 0,
        total_prompts: 0,
        commits: [
          {
            sha: "def456789012",
            short: "def4567",
            message: "chore: human-only commit",
            session_id: null,
            model: null,
            ai_ratio: null,
            attribution_method: null,
            prompts_count: 0,
            files_total: 0,
            files_ai: 0,
            files: [{ path: "src/human.ts", by_ai: false }],
            interactions: [],
            attribution: null,
          },
        ],
      }),
    );

    assert.ok(!markdown.includes(REVIEWER_CONTEXT_BEGIN));
    assert.ok(markdown.includes("**Agent Note data:** No tracked commits"));
  });

  it("renders hidden reviewer context before the commit table", () => {
    const base = baseReport();
    const markdown = renderMarkdown(
      baseReport({
        commits: [
          {
            ...base.commits[0],
            files: [{ path: "packages/cli/src/core/record.ts", by_ai: true }],
          },
        ],
      }),
    );

    const reviewerIndex = markdown.indexOf(REVIEWER_CONTEXT_BEGIN);
    const tableIndex = markdown.indexOf("| Commit | AI Ratio | Prompts | Files |");
    const reviewerContext = extractReviewerContext(markdown);

    assert.ok(reviewerIndex > -1, "reviewer context should be rendered");
    assert.ok(tableIndex > reviewerIndex, "commit table should appear after reviewer context");
    assert.ok(!markdown.includes("### Reviewer Context"));
    assert.ok(reviewerContext.includes("Generated from Agent Note data."));
    assert.ok(reviewerContext.includes("Changed areas:"));
    assert.ok(reviewerContext.includes("- Source: `packages/cli/src/core/record.ts`"));
    assert.ok(reviewerContext.includes("Review focus:"));
    assert.ok(reviewerContext.includes("changed source files and the prompt evidence"));
    assert.ok(reviewerContext.includes("Author intent signals:"));
    assert.ok(reviewerContext.includes("Commit: fix: preserve prompt context"));
    assert.ok(reviewerContext.includes("Prompt: Can this really improve the fix?"));
  });

  it("uses visible prompt detail when building reviewer intent signals", () => {
    const report = baseReport({
      total_prompts: 2,
      commits: [
        {
          ...baseReport().commits[0],
          prompts_count: 2,
          interactions: [
            {
              prompt: "continue",
              response: "Continuing.",
              selection: {
                schema: 1,
                source: "window",
                signals: ["between_non_excluded_prompts"],
              },
            },
            {
              prompt: "Update packages/pr-report/src/report.ts for reviewer context",
              response: "I will keep this in the PR description.",
              selection: {
                schema: 1,
                source: "primary",
                signals: ["primary_edit_turn"],
              },
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report, { promptDetail: "compact" });
    const reviewerContext = extractReviewerContext(markdown);

    assert.ok(reviewerContext.includes("Update packages/pr-report/src/report.ts"));
    assert.ok(!reviewerContext.includes("Prompt: continue"));
  });

  it("uses generic changed-area labels instead of repository-specific package names", () => {
    const markdown = renderMarkdown(
      baseReport({
        commits: [
          {
            ...baseReport().commits[0],
            files: [
              { path: ".github/workflows/ci.yml", by_ai: true },
              { path: "docs/guide.md", by_ai: true },
              { path: "packages/pr-report/src/report.ts", by_ai: true },
              { path: "package-lock.json", by_ai: true },
            ],
          },
        ],
      }),
    );
    const reviewerContext = extractReviewerContext(markdown);

    assert.ok(reviewerContext.includes("- Source: `packages/pr-report/src/report.ts`"));
    assert.ok(reviewerContext.includes("- Documentation: `docs/guide.md`"));
    assert.ok(reviewerContext.includes("- Workflows: `.github/workflows/ci.yml`"));
    assert.ok(reviewerContext.includes("- Dependencies: `package-lock.json`"));
    assert.ok(!reviewerContext.includes("PR Report:"));
    assert.ok(!reviewerContext.includes("CLI recording:"));
  });

  it("prioritizes primary intent over older window prompts", () => {
    const report = baseReport({
      total_commits: 2,
      total_prompts: 2,
      commits: [
        {
          ...baseReport().commits[0],
          sha: "old123456789",
          short: "old1234",
          message: "docs: record missing agent note follow-up",
          prompts_count: 1,
          interactions: [
            {
              prompt: "Should this repository adopt Nix?",
              response: "This is background discussion and should not drive reviewer context.",
              selection: {
                schema: 1,
                source: "window",
                signals: ["between_non_excluded_prompts"],
              },
            },
          ],
        },
        {
          ...baseReport().commits[0],
          sha: "new123456789",
          short: "new1234",
          message: "fix: hide reviewer context in PR body",
          prompts_count: 1,
          interactions: [
            {
              context:
                "Move Reviewer Context into a hidden PR body comment for AI review tools.",
              prompt: "Please hide Reviewer Context from the visible PR description.",
              response: "I will render it as a hidden Markdown comment.",
              selection: {
                schema: 1,
                source: "primary",
                signals: ["primary_edit_turn"],
              },
            },
          ],
        },
      ],
    });

    const reviewerContext = extractReviewerContext(renderMarkdown(report));

    assert.ok(reviewerContext.includes("Commit: docs: record missing agent note follow-up"));
    assert.ok(reviewerContext.includes("Commit: fix: hide reviewer context in PR body"));
    assert.ok(reviewerContext.includes("Context: Move Reviewer Context into a hidden PR body"));
    assert.ok(reviewerContext.includes("Prompt: Please hide Reviewer Context"));
    assert.ok(!reviewerContext.includes("Should this repository adopt Nix?"));
  });

  it("does not use untracked commit messages as reviewer intent signals", () => {
    const tracked = baseReport().commits[0];
    const report = baseReport({
      total_commits: 2,
      commits: [
        {
          sha: "def456789012",
          short: "def4567",
          message: "chore: unrelated human-only commit",
          session_id: null,
          model: null,
          ai_ratio: null,
          attribution_method: null,
          prompts_count: 0,
          files_total: 0,
          files_ai: 0,
          files: [{ path: "untracked-human-only.ts", by_ai: false }],
          interactions: [],
          attribution: null,
        },
        tracked,
      ],
    });

    const markdown = renderMarkdown(report);
    const reviewerContext = extractReviewerContext(markdown);

    assert.ok(!reviewerContext.includes("chore: unrelated human-only commit"));
    assert.ok(!reviewerContext.includes("untracked-human-only.ts"));
    assert.ok(reviewerContext.includes("Commit: fix: preserve prompt context"));
  });

  it("escapes reviewer intent snippets before rendering them as bullets", () => {
    const report = baseReport({
      commits: [
        {
          ...baseReport().commits[0],
          interactions: [
            {
              prompt: "Check <script>alert(1)</script> in reviewer context",
              response: null,
              selection: {
                schema: 1,
                source: "primary",
                signals: ["primary_edit_turn"],
              },
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report);
    const reviewerContext = extractReviewerContext(markdown);

    assert.ok(reviewerContext.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(!reviewerContext.includes("<script>alert(1)</script>"));
  });

  it("keeps reviewer context prompts from closing the hidden comment", () => {
    const report = baseReport({
      commits: [
        {
          ...baseReport().commits[0],
          interactions: [
            {
              prompt: "Keep --> inside reviewer context harmless",
              response: null,
              selection: {
                schema: 1,
                source: "primary",
                signals: ["primary_edit_turn"],
              },
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report);
    const reviewerContext = extractReviewerContext(markdown);

    assert.ok(reviewerContext.includes("Keep - -&gt; inside reviewer context harmless"));
    assert.equal(reviewerContext.slice(0, -REVIEWER_CONTEXT_END.length).includes("-->"), false);
  });

  it("keeps changed-area file paths from closing the hidden reviewer comment", () => {
    const report = baseReport({
      commits: [
        {
          ...baseReport().commits[0],
          files: [{ path: "src/keep-->`path`.ts", by_ai: true }],
        },
      ],
    });

    const reviewerContext = extractReviewerContext(renderMarkdown(report));

    assert.ok(reviewerContext.includes("src/keep- -&gt;\\`path\\`.ts"));
    assert.equal(reviewerContext.slice(0, -REVIEWER_CONTEXT_END.length).includes("-->"), false);
  });

  it("renders interaction context before the prompt", () => {
    const markdown = renderMarkdown(baseReport());

    const contextIndex = markdown.indexOf("**📝 Context**");
    const promptIndex = markdown.indexOf("**🧑 Prompt**");
    const responseIndex = markdown.indexOf("**🤖 Response**");

    assert.ok(contextIndex > -1, "context label should be rendered");
    assert.ok(promptIndex > contextIndex, "prompt should appear after context");
    assert.ok(responseIndex > promptIndex, "response should appear after prompt");
    assert.ok(markdown.includes("The previous response explains why src/record.ts needs this fix."));
    assert.ok(!markdown.includes("> **📝 Context**"), "context label should not be quoted");
    assert.ok(!markdown.includes("> **🧑 Prompt**"), "prompt label should not be quoted");
    assert.ok(!markdown.includes("> **🤖 Response**"), "response label should not be quoted");
  });

  it("renders contexts array in a single context block", () => {
    const report = baseReport({
      commits: [
        {
          ...baseReport().commits[0],
          interactions: [
            {
              contexts: [
                {
                  kind: "scope",
                  source: "current_response",
                  text: "I will update the Dashboard markdown renderer.",
                },
                {
                  kind: "reference",
                  source: "previous_response",
                  text: "The previous response pointed at src/record.ts.",
                },
              ],
              prompt: "continue",
              response: null,
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report);
    const contextLabels = markdown.match(/\*\*📝 Context\*\*/g) ?? [];
    const referenceIndex = markdown.indexOf("The previous response pointed at src/record.ts.");
    const scopeIndex = markdown.indexOf("I will update the Dashboard markdown renderer.");

    assert.equal(contextLabels.length, 1);
    assert.ok(referenceIndex > -1);
    assert.ok(scopeIndex > referenceIndex);
  });

  it("deduplicates legacy context and contexts with the same text", () => {
    const report = baseReport({
      commits: [
        {
          ...baseReport().commits[0],
          interactions: [
            {
              context: "same context",
              contexts: [
                {
                  kind: "scope",
                  source: "current_response",
                  text: "same context",
                },
              ],
              prompt: "continue",
              response: null,
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report);
    const promptDetails = markdown.slice(markdown.indexOf("<details>"));
    assert.equal(promptDetails.match(/same context/g)?.length, 1);
  });

  it("omits blank interaction context", () => {
    const report = baseReport({
      commits: [
        {
          ...baseReport().commits[0],
          interactions: [
            {
              context: "   ",
              prompt: "Apply it",
              response: null,
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report);

    assert.ok(!markdown.includes("**📝 Context**"));
    assert.ok(markdown.includes("**🧑 Prompt**"));
  });

  it("renders prompt-only bursts with the following response", () => {
    const report = baseReport({
      total_prompts: 2,
      commits: [
        {
          ...baseReport().commits[0],
          prompts_count: 2,
          interactions: [
            {
              prompt: "Please avoid keyword heuristics.",
              response: null,
            },
            {
              prompt: "This also applies to prompt-context.md.",
              response: "I will use structural anchors only.",
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report);

    assert.equal(markdown.match(/\*\*🧑 Prompt\*\*/g)?.length, 1);
    assert.equal(markdown.match(/\*\*🤖 Response\*\*/g)?.length, 1);
    assert.ok(markdown.includes("Please avoid keyword heuristics."));
    assert.ok(markdown.includes("This also applies to prompt-context.md."));
    assert.ok(markdown.includes("I will use structural anchors only."));
  });

  it("does not merge prompt-only interactions that carry selection metadata", () => {
    const report = baseReport({
      total_prompts: 2,
      commits: [
        {
          ...baseReport().commits[0],
          prompts_count: 2,
          interactions: [
            {
              prompt: "Please avoid keyword heuristics.",
              response: null,
              selection: {
                schema: 1,
                source: "window",
                signals: ["between_non_excluded_prompts"],
              },
            },
            {
              prompt: "This also applies to prompt-context.md.",
              response: "I will use structural anchors only.",
              selection: {
                schema: 1,
                source: "primary",
                signals: ["primary_edit_turn"],
              },
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report, { promptDetail: "full" });

    assert.equal(markdown.match(/\*\*🧑 Prompt\*\*/g)?.length, 2);
    assert.ok(markdown.includes("Please avoid keyword heuristics."));
    assert.ok(markdown.includes("This also applies to prompt-context.md."));
  });

  it("uses compact prompt detail by default", () => {
    const report = baseReport({
      total_prompts: 3,
      commits: [
        {
          ...baseReport().commits[0],
          prompts_count: 3,
          interactions: [
            {
              prompt: "Update packages/cli/src/core/record.ts",
              response: "I will update the scorer.",
              selection: {
                schema: 1,
                source: "window",
                signals: ["exact_commit_path"],
              },
            },
            {
              prompt: "README.md",
              response: "I will keep this as a context bridge.",
              selection: {
                schema: 1,
                source: "tail",
                signals: ["commit_file_basename"],
              },
            },
            {
              prompt: "continue",
              response: "Continuing.",
              selection: {
                schema: 1,
                source: "window",
                signals: ["between_non_excluded_prompts"],
              },
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report);

    assert.ok(markdown.includes("💬 Prompts & Responses (2 shown / 3 total)"));
    assert.ok(markdown.includes("Update packages/cli/src/core/record.ts"));
    assert.ok(markdown.includes("README.md"));
    assert.ok(!markdown.includes("Continuing."));
  });

  it("supports compact and full prompt detail presets", () => {
    const report = baseReport({
      total_prompts: 3,
      commits: [
        {
          ...baseReport().commits[0],
          prompts_count: 3,
          interactions: [
            {
              prompt: "Update packages/cli/src/core/record.ts",
              response: "I will update the scorer.",
              selection: {
                schema: 1,
                source: "window",
                signals: ["exact_commit_path"],
              },
            },
            {
              prompt: "README.md",
              response: "I will keep this as a context bridge.",
              selection: {
                schema: 1,
                source: "tail",
                signals: ["commit_file_basename"],
              },
            },
            {
              prompt: "continue",
              response: "Continuing.",
              selection: {
                schema: 1,
                source: "window",
                signals: ["between_non_excluded_prompts"],
              },
            },
          ],
        },
      ],
    });

    const compact = renderMarkdown(report, { promptDetail: "compact" });
    const full = renderMarkdown(report, { promptDetail: "full" });

    assert.ok(compact.includes("💬 Prompts & Responses (2 shown / 3 total)"));
    assert.ok(compact.includes("Update packages/cli/src/core/record.ts"));
    assert.ok(compact.includes("README.md"));
    assert.ok(!compact.includes("continue"));
    assert.ok(full.includes("💬 Prompts & Responses (3 total)"));
    assert.ok(full.includes("Update packages/cli/src/core/record.ts"));
    assert.ok(full.includes("README.md"));
    assert.ok(full.includes("continue"));
  });

  it("hides absorbed external PR review prompts only in compact output", () => {
    const externalPrompt = "https://github.com/wasabeef/AgentNote/pull/53 を5回はレビューして";
    const currentReviewPrompt = "review this change from three angles";
    const primaryPrompt = "Start the prompt-window follow-up";
    const report = baseReport({
      total_prompts: 3,
      commits: [
        {
          ...baseReport().commits[0],
          prompts_count: 3,
          interactions: [
            {
              prompt: currentReviewPrompt,
              response: "The current change touches packages/cli/src/core/entry.ts.",
              selection: {
                schema: 1,
                source: "window",
                signals: [
                  "response_exact_commit_path",
                  "response_basename_or_identifier",
                  "substantive_prompt_shape",
                  "between_non_excluded_prompts",
                ],
              },
            },
            {
              prompt: externalPrompt,
              response: "The follow-up should extract packages/cli/src/core/prompt-window.ts.",
              selection: {
                schema: 1,
                source: "window",
                signals: [
                  "response_exact_commit_path",
                  "response_basename_or_identifier",
                  "substantive_prompt_shape",
                  "between_non_excluded_prompts",
                ],
              },
            },
            {
              prompt: primaryPrompt,
              response: "I will extract the prompt window policy.",
              files_touched: ["packages/cli/src/core/prompt-window.ts"],
              selection: {
                schema: 1,
                source: "primary",
                signals: ["primary_edit_turn"],
              },
            },
          ],
        },
      ],
    });

    const compact = renderMarkdown(report, { promptDetail: "compact" });
    const full = renderMarkdown(report, { promptDetail: "full" });

    assert.ok(compact.includes("💬 Prompts & Responses (2 shown / 3 total)"));
    assert.ok(compact.includes(currentReviewPrompt));
    assert.ok(!compact.includes(externalPrompt));
    assert.ok(compact.includes(primaryPrompt));
    assert.ok(full.includes("💬 Prompts & Responses (3 total)"));
    assert.ok(full.includes(externalPrompt));
  });

  it("keeps a prompt detail summary when the current preset hides every prompt", () => {
    const report = baseReport({
      total_prompts: 1,
      commits: [
        {
          ...baseReport().commits[0],
          prompts_count: 1,
          interactions: [
            {
              prompt: "continue",
              response: "Continuing.",
              selection: {
                schema: 1,
                source: "window",
                signals: ["between_non_excluded_prompts"],
              },
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report, { promptDetail: "compact" });

    assert.ok(markdown.includes("💬 Prompts & Responses (0 shown / 1 total)"));
    assert.ok(markdown.includes("No prompts are shown"));
    assert.ok(!markdown.includes("Continuing."));
  });

  it("does not truncate long context text in the middle", () => {
    const reference = "Reference context " + "alpha ".repeat(55);
    const scope = "Scope context " + "beta ".repeat(55);
    const report = baseReport({
      commits: [
        {
          ...baseReport().commits[0],
          interactions: [
            {
              contexts: [
                {
                  kind: "reference",
                  source: "previous_response",
                  text: reference,
                },
                {
                  kind: "scope",
                  source: "current_response",
                  text: scope,
                },
              ],
              prompt: "continue",
              response: "Done.",
            },
          ],
        },
      ],
    });

    const markdown = renderMarkdown(report);
    const contextStart = markdown.indexOf("**📝 Context**");
    const promptStart = markdown.indexOf("**🧑 Prompt**");
    const contextBlock = markdown.slice(contextStart, promptStart);

    assert.ok(contextBlock.length > 600, "fixture should exceed the old response limit");
    assert.ok(contextBlock.includes(reference.trim()));
    assert.ok(contextBlock.includes(scope.trim()));
    assert.ok(!contextBlock.includes("…"));
  });
});
