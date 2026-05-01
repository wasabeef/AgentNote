import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const COMMENT_MARKER = "<!-- agentnote-pr-report -->";
export const DESCRIPTION_BEGIN = "<!-- agentnote-begin -->";
export const DESCRIPTION_END = "<!-- agentnote-end -->";

const execFileAsync = promisify(execFile);

/**
 * Resolve PR output mode from the action input.
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
 * Upsert the agentnote markdown section into a PR description body.
 * Replaces the existing section (begin/end markers) if present, appends if not.
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

export function inferDashboardUrl(
	repoUrl: string | null,
	prNumber?: number | string | null,
): string | null {
	if (!repoUrl) return null;

	const normalized = repoUrl.replace(/\.git$/, "");
	const match = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
	if (!match) return null;

	const [, owner, repo] = match;
	const pagesRoot = `https://${owner}.github.io`;
	const dashboardUrl =
		repo === `${owner}.github.io`
			? `${pagesRoot}/dashboard/`
			: `${pagesRoot}/${repo}/dashboard/`;
	return appendPrNumber(dashboardUrl, prNumber);
}

function appendPrNumber(
	dashboardUrl: string,
	prNumber?: number | string | null,
): string {
	if (prNumber == null || prNumber === "") return dashboardUrl;
	const normalized = Number(prNumber);
	if (!Number.isInteger(normalized) || normalized <= 0) return dashboardUrl;

	const url = new URL(dashboardUrl);
	url.searchParams.set("pr", String(normalized));
	return url.toString();
}

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

export async function updatePrDescription(
	prNumber: string,
	markdown: string,
): Promise<void> {
	const currentBody = await readPrBody(prNumber);
	const newBody = upsertDescription(currentBody, markdown);
	await execFileAsync("gh", ["pr", "edit", prNumber, "--body", newBody], {
		encoding: "utf-8",
	});
}

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
			{ encoding: "utf-8" },
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
				{ encoding: "utf-8" },
			);
			return;
		}
	} catch {
		// fall through to create
	}

	await execFileAsync("gh", ["pr", "comment", prNumber, "--body", body], {
		encoding: "utf-8",
	});
}

function wrapWithMarkers(content: string): string {
	return `${DESCRIPTION_BEGIN}\n${content}\n${DESCRIPTION_END}`;
}

async function readPrBody(prNumber: string): Promise<string> {
	const { stdout } = await execFileAsync(
		"gh",
		["pr", "view", prNumber, "--json", "body"],
		{ encoding: "utf-8" },
	);
	return JSON.parse(stdout).body ?? "";
}
