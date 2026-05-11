import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAgentNoteHookCommand } from "./hook-command.js";

describe("hook command detection", () => {
  it("matches public and repo-local Agent Note hook commands for the requested agent", () => {
    assert.equal(
      isAgentNoteHookCommand("npx --yes agent-note hook --agent claude", "claude"),
      true,
    );
    assert.equal(
      isAgentNoteHookCommand("node packages/cli/dist/cli.js hook --agent codex", "codex"),
      true,
    );
    assert.equal(
      isAgentNoteHookCommand('node "./packages/cli/dist/cli.js" hook --agent=cursor', "cursor"),
      true,
    );
  });

  it("does not match agent names or hook binaries by substring", () => {
    assert.equal(
      isAgentNoteHookCommand("npx --yes agent-note hook --agent claude-extra", "claude"),
      false,
    );
    assert.equal(
      isAgentNoteHookCommand("node packages/cli/dist/other-cli.js hook --agent codex", "codex"),
      false,
    );
    assert.equal(
      isAgentNoteHookCommand("node packages/cli/dist/cli.js hook-check --agent codex", "codex"),
      false,
    );
    assert.equal(isAgentNoteHookCommand("echo agent-note hook --agent claude", "claude"), false);
    assert.equal(
      isAgentNoteHookCommand("echo npx --yes agent-note hook --agent claude", "claude"),
      false,
    );
  });

  it("allows missing legacy agent flags only for cleanup paths", () => {
    assert.equal(
      isAgentNoteHookCommand("npx --yes agent-note hook", "gemini", { allowMissingAgent: true }),
      true,
    );
    assert.equal(isAgentNoteHookCommand("npx --yes agent-note hook", "gemini"), false);
    assert.equal(
      isAgentNoteHookCommand("npx --yes agent-note hook --agent claude", "gemini", {
        allowMissingAgent: true,
      }),
      false,
    );
  });
});
