export const COMMENT_MARKER = "<!-- agentnote-pr-report -->";
export const DESCRIPTION_BEGIN = "<!-- agentnote-begin -->";
export const DESCRIPTION_END = "<!-- agentnote-end -->";

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

/**
 * Build the CLI command used to collect a PR report.
 * When GitHub provides the real PR head SHA, prefer it over the synthetic
 * merge commit checked out by pull_request workflows.
 */
export function buildPrReportCommand(
	cliCmd: string,
	base: string,
	headSha?: string,
	options?: { json?: boolean },
): string {
	const headArg = headSha ? ` --head "${headSha}"` : "";
	const jsonArg = options?.json ? " --json" : "";
	return `${cliCmd} pr "${base}"${headArg}${jsonArg}`;
}

function ensureTrailingSlash(url: string): string {
	return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Infer the public dashboard URL from the repository name using the standard
 * GitHub Pages project-site convention.
 */
export function inferDashboardUrl(repository: string): string {
	const trimmed = repository.trim();
	if (!trimmed.includes("/")) return "";

	const [owner, repo] = trimmed.split("/", 2);
	if (!owner || !repo) return "";

	if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
		return `https://${owner}.github.io/dashboard/`;
	}

	return `https://${owner}.github.io/${repo}/dashboard/`;
}

/**
 * Insert a dashboard link near the top of the rendered PR report.
 */
export function withDashboardLink(markdown: string, dashboardUrl: string): string {
	if (!markdown.trim()) return markdown;

	const linkLine = `🔎 [Open dashboard](${ensureTrailingSlash(dashboardUrl)})`;
	const lines = markdown.split("\n");
	const headingIndex = lines.findIndex((line) => line.startsWith("## "));

	if (headingIndex === -1) {
		return `${linkLine}\n\n${markdown}`;
	}

	let insertIndex = headingIndex + 1;
	if (lines[insertIndex] === "") {
		insertIndex += 1;
	}

	lines.splice(insertIndex, 0, linkLine, "");
	return lines.join("\n");
}
