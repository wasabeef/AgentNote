import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMarkdown, type PrReport } from "./report.js";

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

describe("renderMarkdown", () => {
  it("renders interaction context before the prompt", () => {
    const markdown = renderMarkdown(baseReport());

    const contextIndex = markdown.indexOf("**📝 Context**");
    const promptIndex = markdown.indexOf("**🧑 Prompt**");
    const responseIndex = markdown.indexOf("**🤖 Response**");

    assert.ok(contextIndex > -1, "context label should be rendered");
    assert.ok(promptIndex > contextIndex, "prompt should appear after context");
    assert.ok(responseIndex > promptIndex, "response should appear after prompt");
    assert.ok(markdown.includes("The previous response explains why src/record.ts needs this fix."));
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
    assert.equal(markdown.match(/same context/g)?.length, 1);
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
});
