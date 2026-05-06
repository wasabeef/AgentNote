import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Hidden marker used to find and update the managed PR comment. */
export const COMMENT_MARKER = "<!-- agentnote-pr-report -->";
/** Hidden marker that starts the managed PR description section. */
export const DESCRIPTION_BEGIN = "<!-- agentnote-begin -->";
/** Hidden marker that ends the managed PR description section. */
export const DESCRIPTION_END = "<!-- agentnote-end -->";

const GITHUB_REPOSITORY_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/;
const PR_QUERY_PARAM = "pr";
const TEXT_ENCODING = "utf-8";

const execFileAsync = promisify(execFile);

/**
 * Resolve the PR report output mode from action input.
 *
 * Unknown values intentionally fall back to `description` so a misconfigured
 * workflow still produces the primary PR report instead of silently doing
 * nothing.
 */
export function resolvePrOutputMode(
	prOutputInput: string,
): "description" | "comment" | "none" {
	if (
		prOutputInput === "description" ||
		prOutputInput === "comment" ||
		prOutputInput === "none"
	) {
		return prOutputInput;
	}
	return "description";
}

/**
 * Upsert the Agent Note markdown section into a PR description body.
 *
 * The begin/end markers make the update idempotent: existing reports are
 * replaced in place, while user-written PR description text is preserved.
 */
export function upsertDescription(
	existingBody: string,
	markdown: string,
): string {
	const section = `${DESCRIPTION_BEGIN}\n${markdown}\n${DESCRIPTION_END}`;

	if (existingBody.includes(DESCRIPTION_BEGIN)) {
		const before = existingBody.slice(
			0,
			existingBody.indexOf(DESCRIPTION_BEGIN),
		);
		const after = existingBody.includes(DESCRIPTION_END)
			? existingBody.slice(
					existingBody.indexOf(DESCRIPTION_END) + DESCRIPTION_END.length,
				)
			: "";
		return `${before.trimEnd()}\n\n${section}${after}`;
	}

	return `${existingBody.trimEnd()}\n\n${section}`;
}

/**
 * Retry notes fetch only when the PR clearly has commits but none of them
 * resolved to Agent Note data yet. This is the common signature of a notes
 * push race right after branch publication.
 */
export function shouldRetryNotesFetch(report: {
	total_commits?: number;
	tracked_commits?: number;
}): boolean {
	return (report.total_commits ?? 0) > 0 && (report.tracked_commits ?? 0) === 0;
}

/**
 * Infer the public Dashboard URL from a GitHub remote URL.
 *
 * The PR number is appended only for PR reports so the general dashboard route
 * can remain a team-level entry point without forced `?pr=` redirects.
 */
export function inferDashboardUrl(
	repoUrl: string | null,
	prNumber?: number | string | null,
): string | null {
	if (!repoUrl) return null;

	const normalized = repoUrl.replace(/\.git$/, "");
	const match = normalized.match(GITHUB_REPOSITORY_URL_PATTERN);
	if (!match) return null;

	const [, owner, repo] = match;
	const pagesRoot = `https://${owner}.github.io`;
	const dashboardUrl =
		repo === `${owner}.github.io`
			? `${pagesRoot}/dashboard/`
			: `${pagesRoot}/${repo}/dashboard/`;
	return appendPrNumber(dashboardUrl, prNumber);
}

/**
 * Add a PR query parameter to a Dashboard URL when the caller has a valid PR.
 *
 * Invalid values are ignored so non-PR runs still link to the team-level
 * Dashboard home instead of producing broken URLs.
 */
function appendPrNumber(
	dashboardUrl: string,
	prNumber?: number | string | null,
): string {
	if (prNumber == null || prNumber === "") return dashboardUrl;
	const normalized = Number(prNumber);
	if (!Number.isInteger(normalized) || normalized <= 0) return dashboardUrl;

	const url = new URL(dashboardUrl);
	url.searchParams.set(PR_QUERY_PARAM, String(normalized));
	return url.toString();
}

/**
 * Detect whether the GitHub Pages environment restricts deploy branches.
 *
 * When protection is enabled, PR previews may wait for approval or merge, so
 * the PR report can explain why the Dashboard link is not live yet.
 */
export function hasDeploymentBranchProtection(
	policy:
		| {
				protected_branches?: boolean;
				custom_branch_policies?: boolean;
		  }
		| null
		| undefined,
): boolean {
	return Boolean(
		policy &&
			(policy.protected_branches === true ||
				policy.custom_branch_policies === true),
	);
}

/** Update a PR description with the current Agent Note report. */
export async function updatePrDescription(
	prNumber: string,
	markdown: string,
): Promise<void> {
	const currentBody = await readPrBody(prNumber);
	const newBody = upsertDescription(currentBody, markdown);
	await execFileAsync("gh", ["pr", "edit", prNumber, "--body", newBody], {
		encoding: TEXT_ENCODING,
	});
}

/** Create or update the single managed Agent Note PR comment. */
export async function postPrComment(
	prNumber: string,
	content: string,
): Promise<void> {
	const body = `${COMMENT_MARKER}\n${content}`;

	try {
		const { stdout } = await execFileAsync(
			"gh",
			[
				"pr",
				"view",
				prNumber,
				"--json",
				"comments",
				"--jq",
				`.comments[] | select(.body | contains("${COMMENT_MARKER}")) | .id`,
			],
			{ encoding: TEXT_ENCODING },
		);
		const commentId = stdout.trim().split("\n")[0];
		if (commentId) {
			await execFileAsync(
				"gh",
				[
					"api",
					"-X",
					"PATCH",
					`/repos/{owner}/{repo}/issues/comments/${commentId}`,
					"-f",
					`body=${body}`,
				],
				{ encoding: TEXT_ENCODING },
			);
			return;
		}
	} catch {
		// fall through to create
	}

	await execFileAsync("gh", ["pr", "comment", prNumber, "--body", body], {
		encoding: TEXT_ENCODING,
	});
}

/** Wrap generated markdown in description markers for idempotent replacement. */
function wrapWithMarkers(content: string): string {
	return `${DESCRIPTION_BEGIN}\n${content}\n${DESCRIPTION_END}`;
}

/** Read only the PR body through the GitHub CLI fallback path. */
async function readPrBody(prNumber: string): Promise<string> {
	const { stdout } = await execFileAsync(
		"gh",
		["pr", "view", prNumber, "--json", "body"],
		{ encoding: TEXT_ENCODING },
	);
	return JSON.parse(stdout).body ?? "";
}
