import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

function ensureTrailingSlash(url: string): string {
	return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Resolve the public dashboard URL used in PR descriptions.
 * Only use an explicit input so we do not emit a broken link before the
 * dashboard has actually been deployed.
 */
export function resolveDashboardUrl(dashboardUrlInput: string): string {
	const explicit = dashboardUrlInput.trim();
	return explicit ? ensureTrailingSlash(explicit) : "";
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

function normalizeModelIconKey(model: string): "claude" | "cursor" | "gemini" | "codex" | null {
	const text = model.trim().toLowerCase();
	if (!text) return null;
	if (text.includes("claude") || text.includes("anthropic")) return "claude";
	if (text.includes("cursor")) return "cursor";
	if (text.includes("gemini")) return "gemini";
	if (
		text.includes("codex") ||
		text.includes("openai") ||
		text.includes("chatgpt") ||
		/\bgpt\b/.test(text)
	) {
		return "codex";
	}
	return null;
}

/**
 * Load a dashboard model icon and return it as a base64 data URL so PR
 * descriptions do not depend on the dashboard being deployed yet.
 */
export function resolveModelIconDataUrl(model: string): string {
	const key = normalizeModelIconKey(model);
	if (!key) return "";

	const iconPath = [
		resolve("packages/dashboard/public/model-icons", `${key}.png`),
		resolve("../dashboard/public/model-icons", `${key}.png`),
	].find((candidate) => existsSync(candidate));
	if (!iconPath) return "";

	return `data:image/png;base64,${readFileSync(iconPath).toString("base64")}`;
}

/**
 * Replace the plain Model line with an inline icon + model label.
 */
export function withModelIcon(
	markdown: string,
	model: string,
	iconDataUrl: string,
): string {
	if (!markdown.trim() || !model.trim() || !iconDataUrl.trim()) return markdown;

	const modelLine = `Model: \`${model}\``;
	const iconLine = `Model: <img src="${iconDataUrl}" alt="${model}" width="16" height="16"> \`${model}\``;
	return markdown.includes(modelLine)
		? markdown.replace(modelLine, iconLine)
		: markdown;
}
