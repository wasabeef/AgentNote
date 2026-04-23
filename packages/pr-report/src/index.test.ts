import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	COMMENT_MARKER,
	DESCRIPTION_BEGIN,
	DESCRIPTION_END,
	inferDashboardUrl,
	resolvePrOutputMode,
	shouldRetryNotesFetch,
	upsertDescription,
} from "./github.js";

describe("resolvePrOutputMode", () => {
	it('returns "none" when pr_output is "none"', () => {
		assert.equal(resolvePrOutputMode("none"), "none");
	});

	it('returns "description" when pr_output is "description"', () => {
		assert.equal(resolvePrOutputMode("description"), "description");
	});

	it('returns "comment" when pr_output is "comment"', () => {
		assert.equal(resolvePrOutputMode("comment"), "comment");
	});

	it('defaults to "description" when pr_output is empty', () => {
		assert.equal(resolvePrOutputMode(""), "description");
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

describe("inferDashboardUrl", () => {
	it("infers the standard project Pages dashboard URL", () => {
		assert.equal(
			inferDashboardUrl("https://github.com/wasabeef/AgentNote"),
			"https://wasabeef.github.io/AgentNote/dashboard/",
		);
	});

	it("infers the user Pages dashboard URL for owner.github.io repos", () => {
		assert.equal(
			inferDashboardUrl("https://github.com/wasabeef/wasabeef.github.io"),
			"https://wasabeef.github.io/dashboard/",
		);
	});

	it("returns null for non-GitHub remotes", () => {
		assert.equal(inferDashboardUrl("https://gitlab.com/example/project"), null);
	});
});
