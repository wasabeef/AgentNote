import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	buildPrReportCommand,
	COMMENT_MARKER,
	DESCRIPTION_BEGIN,
	DESCRIPTION_END,
	resolvePrOutputMode,
	resolveOutputMode,
	shouldRetryNotesFetch,
	upsertDescription,
} from "./helpers.js";

describe("resolveOutputMode", () => {
	it('returns "description" when output is "description"', () => {
		assert.equal(resolveOutputMode("description", ""), "description");
	});

	it('returns "comment" when output is "comment"', () => {
		assert.equal(resolveOutputMode("comment", ""), "comment");
	});

	it('returns "none" when output is unset and comment is "false"', () => {
		assert.equal(resolveOutputMode("", "false"), "none");
	});

	it('returns "description" by default when both inputs are empty', () => {
		assert.equal(resolveOutputMode("", ""), "description");
	});

	it("ignores comment input when output is explicitly set", () => {
		assert.equal(resolveOutputMode("comment", "false"), "comment");
	});
});

describe("resolvePrOutputMode", () => {
	it('returns "none" when pr_output is "none"', () => {
		assert.equal(resolvePrOutputMode("none", "", ""), "none");
	});

	it('prefers "pr_output" over legacy "output"', () => {
		assert.equal(resolvePrOutputMode("description", "comment", ""), "description");
	});

	it('treats "comment=false" as a hard opt-out even when outputs are set', () => {
		assert.equal(resolvePrOutputMode("description", "", "false"), "none");
		assert.equal(resolvePrOutputMode("", "comment", "false"), "none");
	});

	it("falls back to legacy inputs when pr_output is unset", () => {
		assert.equal(resolvePrOutputMode("", "comment", ""), "comment");
		assert.equal(resolvePrOutputMode("", "", "false"), "none");
	});
});

describe("upsertDescription — append when no existing section", () => {
	it("appends section to empty body", () => {
		const result = upsertDescription("", "## AI Report");
		assert.ok(result.includes(DESCRIPTION_BEGIN));
		assert.ok(result.includes(DESCRIPTION_END));
		assert.ok(result.includes("## AI Report"));
	});

	it("appends section after existing content", () => {
		const existing = "This is the PR description.";
		const result = upsertDescription(existing, "## AI Report");
		assert.ok(result.startsWith("This is the PR description."));
		assert.ok(result.includes(DESCRIPTION_BEGIN));
		assert.ok(result.includes("## AI Report"));
		assert.ok(result.includes(DESCRIPTION_END));
	});
});

describe("upsertDescription — replace when section already present", () => {
	it("replaces existing section content", () => {
		const existing = `Some intro\n\n${DESCRIPTION_BEGIN}\nold content\n${DESCRIPTION_END}\n\nSome outro`;
		const result = upsertDescription(existing, "new content");
		assert.ok(result.includes("new content"));
		assert.ok(!result.includes("old content"));
		assert.ok(result.includes("Some outro"));
	});

	it("preserves text before existing section", () => {
		const existing = `Intro text\n\n${DESCRIPTION_BEGIN}\nold\n${DESCRIPTION_END}`;
		const result = upsertDescription(existing, "new");
		assert.ok(result.startsWith("Intro text"));
	});

	it("handles missing end marker gracefully", () => {
		const existing = `Intro\n\n${DESCRIPTION_BEGIN}\norphaned content`;
		const result = upsertDescription(existing, "new content");
		assert.ok(result.includes("new content"));
		assert.ok(result.includes(DESCRIPTION_END));
	});
});

describe("constants", () => {
	it("COMMENT_MARKER is the expected string", () => {
		assert.equal(COMMENT_MARKER, "<!-- agentnote-pr-report -->");
	});

	it("DESCRIPTION_BEGIN is the expected string", () => {
		assert.equal(DESCRIPTION_BEGIN, "<!-- agentnote-begin -->");
	});

	it("DESCRIPTION_END is the expected string", () => {
		assert.equal(DESCRIPTION_END, "<!-- agentnote-end -->");
	});
});

describe("shouldRetryNotesFetch", () => {
	it("returns true when commits exist but none are tracked", () => {
		assert.equal(
			shouldRetryNotesFetch({ total_commits: 2, tracked_commits: 0 }),
			true,
		);
	});

	it("returns false when at least one commit is already tracked", () => {
		assert.equal(
			shouldRetryNotesFetch({ total_commits: 2, tracked_commits: 1 }),
			false,
		);
	});

	it("returns false when there are no commits in scope", () => {
		assert.equal(
			shouldRetryNotesFetch({ total_commits: 0, tracked_commits: 0 }),
			false,
		);
	});
});

describe("buildPrReportCommand", () => {
	it("uses the explicit PR head sha when available", () => {
		assert.equal(
			buildPrReportCommand(
				"node packages/cli/dist/cli.js",
				"origin/main",
				"abc1234",
				{ json: true },
			),
			'node packages/cli/dist/cli.js pr "origin/main" --head "abc1234" --json',
		);
	});

	it("uses the explicit PR head sha for markdown output too", () => {
		assert.equal(
			buildPrReportCommand(
				"node packages/cli/dist/cli.js",
				"origin/main",
				"abc1234",
			),
			'node packages/cli/dist/cli.js pr "origin/main" --head "abc1234"',
		);
	});

	it("falls back to HEAD when no head sha is provided", () => {
		assert.equal(
			buildPrReportCommand("node packages/cli/dist/cli.js", "origin/main", undefined, {
				json: true,
			}),
			'node packages/cli/dist/cli.js pr "origin/main" --json',
		);
	});
});
