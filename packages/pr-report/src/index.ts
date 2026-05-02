import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync } from "child_process";
import {
	COMMENT_MARKER,
	hasDeploymentBranchProtection,
	resolvePrOutputMode,
	shouldRetryNotesFetch,
	upsertDescription,
} from "./github.js";
import { parsePromptDetail } from "../../cli/src/core/entry.js";
import { collectReport, renderMarkdown } from "./report.js";

type PrOutputMode = ReturnType<typeof resolvePrOutputMode>;

const AGENTNOTE_NOTES_REFSPEC = "refs/notes/agentnote:refs/notes/agentnote";
const DASHBOARD_PREVIEW_HELP_URL = "https://wasabeef.github.io/AgentNote/dashboard/#pr-previews";
const EVENT_PULL_REQUEST = "pull_request";
const GITHUB_PAGES_ENVIRONMENT = "github-pages";
const GITHUB_TOKEN_ENV = "GITHUB_TOKEN";
const MAX_NOTES_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_BASE_MS = 1000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch Agent Note git notes from the remote before collecting PR data.
 *
 * Notes can arrive slightly after the branch push, so callers may retry this
 * fetch to cover the race between branch publication and notes publication.
 */
function fetchAgentnoteNotes(): void {
	try {
		execSync(`git fetch origin ${AGENTNOTE_NOTES_REFSPEC}`, {
			stdio: "pipe",
		});
	} catch {
		core.info("No agent-note notes found on remote.");
	}
}

async function postPrReport(
	outputMode: PrOutputMode,
	markdown: string,
): Promise<void> {
	if (outputMode === "none") return;
	if (!markdown || !github.context.payload.pull_request) return;

	const token = process.env[GITHUB_TOKEN_ENV] || "";
	if (!token) {
		core.warning("No GitHub token available. Skipping PR report.");
		return;
	}

	const octokit = github.getOctokit(token);
	const { owner, repo } = github.context.repo;
	const issueNumber = github.context.payload.pull_request.number;

	if (outputMode === "description") {
		const { data: pr } = await octokit.rest.pulls.get({
			owner,
			repo,
			pull_number: issueNumber,
		});
		const existingBody = pr.body ?? "";
		const newBody = upsertDescription(existingBody, markdown);

		await octokit.rest.pulls.update({
			owner,
			repo,
			pull_number: issueNumber,
			body: newBody,
		});
		core.info("Agent Note report added to PR description.");
		return;
	}

	const body = `${COMMENT_MARKER}\n${markdown}`;
	const { data: comments } = await octokit.rest.issues.listComments({
		owner,
		repo,
		issue_number: issueNumber,
	});
	const existing = comments.find((comment) =>
		comment.body?.includes(COMMENT_MARKER),
	);

	if (existing) {
		await octokit.rest.issues.updateComment({
			owner,
			repo,
			comment_id: existing.id,
			body,
		});
	} else {
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: issueNumber,
			body,
		});
	}

	core.info("Agent Note report posted as PR comment.");
}

/**
 * Explain delayed Dashboard previews caused by Pages environment protection.
 *
 * The PR report only shows this explanation when the Dashboard URL exists and
 * GitHub reports branch protection on the Pages environment.
 */
async function inferDashboardPreviewHelpUrl(
	token: string,
	dashboardUrl: string | null,
): Promise<string | null> {
	if (!dashboardUrl) return null;
	if (github.context.eventName !== EVENT_PULL_REQUEST) return null;
	if (!token) return null;

	try {
		const octokit = github.getOctokit(token);
		const { owner, repo } = github.context.repo;
		const { data } = await octokit.request(
			"GET /repos/{owner}/{repo}/environments/{environment_name}",
			{
				owner,
				repo,
				environment_name: GITHUB_PAGES_ENVIRONMENT,
			},
		);
		const policy = (data as { deployment_branch_policy?: {
			protected_branches?: boolean;
			custom_branch_policies?: boolean;
		} | null }).deployment_branch_policy;
		if (hasDeploymentBranchProtection(policy)) {
			return DASHBOARD_PREVIEW_HELP_URL;
		}
	} catch {
		// Best-effort only. If the environment is unavailable or unreadable,
		// keep the report output minimal and skip the extra notice.
	}

	return null;
}

/**
 * Entry point for the GitHub Action.
 *
 * It fetches notes, collects the PR report, retries when the notes ref appears
 * stale, and finally writes the report to the configured PR surface.
 */
async function run(): Promise<void> {
	try {
		const base =
			core.getInput("base") ||
			`origin/${github.context.payload.pull_request?.base?.ref ?? "main"}`;
		const headSha = github.context.payload.pull_request?.head?.sha;
		const prNumber = github.context.payload.pull_request?.number ?? null;
		const prOutputMode = resolvePrOutputMode(core.getInput("pr_output"));
		const promptDetail = parsePromptDetail(core.getInput("prompt_detail"));
		const token = process.env[GITHUB_TOKEN_ENV] || "";

		let report: Awaited<ReturnType<typeof collectReport>> = null;

		for (let attempt = 1; attempt <= MAX_NOTES_FETCH_ATTEMPTS; attempt++) {
			// Fetch/retry covers the race between code push and refs/notes/agentnote push.
			fetchAgentnoteNotes();

			report = await collectReport(base, headSha, {
				dashboardPrNumber: prNumber,
			});
			if (!report) {
				core.info("No agent-note data found for this PR.");
				return;
			}

			if (!shouldRetryNotesFetch(report) || attempt === MAX_NOTES_FETCH_ATTEMPTS) {
				break;
			}

			core.info(
				`Agent Note data is not available yet (attempt ${attempt}/${MAX_NOTES_FETCH_ATTEMPTS}). Retrying...`,
			);
			await sleep(attempt * RETRY_DELAY_BASE_MS);
		}

		if (!report) {
			core.info("No agent-note data found for this PR.");
			return;
		}

		report.dashboard_preview_help_url = await inferDashboardPreviewHelpUrl(
			token,
			report.dashboard_url,
		);

		const json = JSON.stringify(report, null, 2);

		core.setOutput("overall_ai_ratio", String(report.overall_ai_ratio ?? 0));
		core.setOutput("overall_method", String(report.overall_method ?? "file"));
		core.setOutput("tracked_commits", String(report.tracked_commits ?? 0));
		core.setOutput("total_commits", String(report.total_commits ?? 0));
		core.setOutput("total_prompts", String(report.total_prompts ?? 0));
		core.setOutput("json", json);

		const markdown = renderMarkdown(report, { promptDetail });
		core.setOutput("markdown", markdown);

		await postPrReport(prOutputMode, markdown);
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error.message);
		}
	}
}

run();
