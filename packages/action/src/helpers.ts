export const COMMENT_MARKER = "<!-- agentnote-pr-report -->";
export const DESCRIPTION_BEGIN = "<!-- agentnote-begin -->";
export const DESCRIPTION_END = "<!-- agentnote-end -->";

/**
 * Resolve the legacy PR output mode from action inputs.
 */
export function resolveOutputMode(
	outputInput: string,
	commentInput: string,
): "description" | "comment" | "none" {
	if (outputInput === "description" || outputInput === "comment") {
		return outputInput;
	}
	if (commentInput === "false") {
		return "none";
	}
	return "description"; // default
}

/**
 * Resolve PR output mode from modern and legacy action inputs.
 * `comment=false` remains a hard opt-out for backward compatibility.
 * Otherwise `pr_output` takes precedence, then `output`.
 */
export function resolvePrOutputMode(
	prOutputInput: string,
	outputInput: string,
	commentInput: string,
): "description" | "comment" | "none" {
	if (commentInput === "false") {
		return "none";
	}
	if (
		prOutputInput === "description" ||
		prOutputInput === "comment" ||
		prOutputInput === "none"
	) {
		return prOutputInput;
	}
	return resolveOutputMode(outputInput, commentInput);
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
