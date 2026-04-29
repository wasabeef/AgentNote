import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommitContextSignature,
  type CommitContextSignature,
  extractCodeIdentifiers,
  selectInteractionContext,
} from "./interaction-context.js";

function signature(overrides: Partial<CommitContextSignature> = {}): CommitContextSignature {
  return {
    changedFiles: ["packages/cli/src/core/record.ts"],
    changedFileBasenames: ["record.ts"],
    codeIdentifiers: new Set(["isQuotedPromptHistory", "PROMPT_WINDOW_LIMIT"]),
    commitSubjectTokens: ["preserve", "primary", "rows"],
    ...overrides,
  };
}

describe("extractCodeIdentifiers", () => {
  it("extracts code-like identifiers without splitting them into prose words", () => {
    const identifiers = extractCodeIdentifiers(`
      +const isQuotedPromptHistory = true;
      +const prompt_window_limit = 2;
      +const PROMPT_WINDOW_LIMIT = 2;
      +const prompt = "generic";
    `);

    assert.equal(identifiers.has("isQuotedPromptHistory"), true);
    assert.equal(identifiers.has("prompt_window_limit"), true);
    assert.equal(identifiers.has("PROMPT_WINDOW_LIMIT"), true);
    assert.equal(identifiers.has("prompt"), false);
    assert.equal(identifiers.has("History"), false);
  });

  it("does not treat common all-caps acronyms as code identifiers", () => {
    const identifiers = extractCodeIdentifiers(`
      +const payload = JSON.parse(input);
      +const output = toYAML(payload);
      +// TODO: handle HTTP metadata.
    `);

    assert.equal(identifiers.has("JSON"), false);
    assert.equal(identifiers.has("YAML"), false);
    assert.equal(identifiers.has("TODO"), false);
    assert.equal(identifiers.has("HTTP"), false);
    assert.equal(identifiers.has("toYAML"), true);
  });
});

describe("selectInteractionContext", () => {
  it("attaches context when the previous response has a changed-file path anchor", () => {
    const context = selectInteractionContext(
      {
        prompt: "本当にこの修正で改善できるのか",
        previousResponse:
          "原因は packages/cli/src/core/record.ts の window trimming です。\n\n" +
          "This second paragraph is unrelated.",
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(context, "原因は packages/cli/src/core/record.ts の window trimming です。");
  });

  it("attaches context when the previous response has a code identifier anchor", () => {
    const context = selectInteractionContext(
      {
        prompt: "does this approach still hold?",
        previousResponse: "The failure comes from isQuotedPromptHistory removing a primary row.",
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(context, "The failure comes from isQuotedPromptHistory removing a primary row.");
  });

  it("does not attach context when the previous response has no commit-file or code-symbol anchor", () => {
    const context = selectInteractionContext(
      {
        prompt: "もう一度、色々なパターンのデータ作って",
        previousResponse:
          "I checked older prompt revival, synthetic transcript, split commits, and shell-only edits.",
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(context, undefined);
  });

  it("does not attach context from commit subject words alone", () => {
    const context = selectInteractionContext(
      {
        prompt: "continue",
        previousResponse: "This should preserve primary rows in the prompt window.",
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(context, undefined);
  });

  it("does not attach context from common acronym matches alone", () => {
    const context = selectInteractionContext(
      {
        prompt: "continue",
        previousResponse: "The JSON payload needs a little more care before we proceed.",
        previousTurnSelected: false,
      },
      signature({
        changedFiles: ["src/parser.ts"],
        changedFileBasenames: ["parser.ts"],
        codeIdentifiers: new Set(["toYAML"]),
      }),
    );

    assert.equal(context, undefined);
  });

  it("does not attach context based only on short go-ahead wording", () => {
    for (const prompt of ["yes, do it", "はい、お願いします", "继续", "sí, hazlo"]) {
      const context = selectInteractionContext(
        {
          prompt,
          previousResponse: "Ready to continue with the next implementation step.",
          previousTurnSelected: false,
        },
        signature(),
      );
      assert.equal(context, undefined, prompt);
    }
  });

  it("does not attach context when the current prompt already has a strong anchor", () => {
    const context = selectInteractionContext(
      {
        prompt: "fix packages/cli/src/core/record.ts",
        previousResponse:
          "packages/cli/src/core/record.ts contains the relevant prompt-window code.",
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(context, undefined);
  });

  it("does not attach context when the previous turn is already selected", () => {
    const context = selectInteractionContext(
      {
        prompt: "this still feels risky",
        previousResponse:
          "The isQuotedPromptHistory change is already selected as the previous interaction.",
        previousTurnSelected: true,
      },
      signature(),
    );

    assert.equal(context, undefined);
  });

  it("returns undefined when previousResponse is null", () => {
    const context = selectInteractionContext(
      {
        prompt: "continue",
        previousResponse: null,
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(context, undefined);
  });

  it("drops operational-noise paragraphs", () => {
    const context = selectInteractionContext(
      {
        prompt: "continue",
        previousResponse:
          "working tree is clean after touching record.ts\n\n" +
          "record.ts still contains the relevant selector behavior.",
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(context, "record.ts still contains the relevant selector behavior.");
  });

  it("does not emit broken code fences", () => {
    const context = selectInteractionContext(
      {
        prompt: "continue",
        previousResponse:
          "```ts\nconst value = isQuotedPromptHistory(prompt);\n\n" +
          "No other paragraph has an anchor.",
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(context, undefined);
  });

  it("does not expose local filesystem paths", () => {
    const context = selectInteractionContext(
      {
        prompt: "continue",
        previousResponse: "The issue is in /Users/example/project/packages/cli/src/core/record.ts.",
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(context, undefined);
  });

  it("prefers exact file path hits over basename and code identifier hits", () => {
    const context = selectInteractionContext(
      {
        prompt: "continue",
        previousResponse:
          "The function isQuotedPromptHistory is related.\n\n" +
          "The basename record.ts is more concrete.\n\n" +
          "The exact path packages/cli/src/core/record.ts is the best anchor.",
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(
      context,
      "The basename record.ts is more concrete.\n\n" +
        "The exact path packages/cli/src/core/record.ts is the best anchor.",
    );
  });

  it("uses commit subject tokens only as a tie-breaker", () => {
    const context = selectInteractionContext(
      {
        prompt: "continue",
        previousResponse:
          "record.ts has the generic selector details.\n\n" +
          "record.ts should preserve primary rows while selecting context.\n\n" +
          "record.ts has another generic paragraph.",
        previousTurnSelected: false,
      },
      signature(),
    );

    assert.equal(
      context,
      "record.ts has the generic selector details.\n\n" +
        "record.ts should preserve primary rows while selecting context.",
    );
    assert.equal(context.includes("another generic paragraph"), false);
  });

  it("builds a signature without exposing raw diff text to the selector", () => {
    const built = buildCommitContextSignature({
      changedFiles: ["packages/cli/src/core/record.ts"],
      diffText: "+const isQuotedPromptHistory = true;\n+const PROMPT_WINDOW_LIMIT = 2;\n",
      commitSubject: "preserve primary prompt rows",
    });

    assert.deepEqual(built.changedFiles, ["packages/cli/src/core/record.ts"]);
    assert.deepEqual(built.changedFileBasenames, ["record.ts"]);
    assert.equal(built.codeIdentifiers.has("isQuotedPromptHistory"), true);
    assert.equal(built.codeIdentifiers.has("PROMPT_WINDOW_LIMIT"), true);
    assert.deepEqual(built.commitSubjectTokens, ["preserve", "primary", "rows"]);
    assert.equal("diffText" in built, false);
  });
});
