import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeUserPromptText } from "./prompt-text.js";

describe("normalizeUserPromptText", () => {
  it("strips leading environment metadata and keeps the user prompt", () => {
    const prompt = normalizeUserPromptText(
      [
        "<environment_context>",
        "  <current_date>2026-05-15</current_date>",
        "  <timezone>Asia/Tokyo</timezone>",
        "</environment_context>",
        "",
        "Fix the PR report output.",
      ].join("\n"),
    );

    assert.equal(prompt, "Fix the PR report output.");
  });

  it("drops metadata-only environment context prompts", () => {
    const prompt = normalizeUserPromptText(
      "<environment_context>\n<timezone>Asia/Tokyo</timezone>\n</environment_context>",
    );

    assert.equal(prompt, null);
  });

  it("strips leading self-closing environment metadata and keeps the user prompt", () => {
    const prompt = normalizeUserPromptText(
      '<environment_context timezone="Asia/Tokyo" />\nFix the PR report output.',
    );

    assert.equal(prompt, "Fix the PR report output.");
  });

  it("drops system-injected prompts after leading environment metadata", () => {
    const prompt = normalizeUserPromptText(
      [
        "<environment_context>",
        "<timezone>Asia/Tokyo</timezone>",
        "</environment_context>",
        "<system-reminder>Keep going.</system-reminder>",
      ].join("\n"),
    );

    assert.equal(prompt, null);
  });

  it("drops self-closing and mixed-case system-injected prompts", () => {
    assert.equal(normalizeUserPromptText("<system-reminder/>"), null);
    assert.equal(normalizeUserPromptText('<Task-Notification reason="sync" />'), null);
  });

  it("does not drop user text that follows a system-looking tag", () => {
    const prompt = normalizeUserPromptText(
      "<system-reminder>Internal context.</system-reminder>\nPlease fix the report.",
    );

    assert.equal(
      prompt,
      "<system-reminder>Internal context.</system-reminder>\nPlease fix the report.",
    );
  });

  it("does not strip environment_context text in the middle of a real prompt", () => {
    const prompt = normalizeUserPromptText(
      "Explain why <environment_context> appears in the PR report.",
    );

    assert.equal(prompt, "Explain why <environment_context> appears in the PR report.");
  });

  it("does not drop prompts that only mention system tag names", () => {
    const prompt = normalizeUserPromptText("Please inspect the <system-reminder> parser.");

    assert.equal(prompt, "Please inspect the <system-reminder> parser.");
  });
});
