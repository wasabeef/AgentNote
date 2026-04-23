import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { resolve } from "path";
import {
	buildPrReportCommand,
	COMMENT_MARKER,
	resolvePrOutputMode,
	shouldRetryNotesFetch,
	upsertDescription,
} from "./helpers.js";

type PrOutputMode = "description" | "comment" | "none";

/**
 * Resolve the agentnote CLI command.
 * Prefers the local monorepo build (no version skew), falls back to npx.
 */
function resolveCliCommand(): string {
	try {
		const localCli = resolve("packages/cli/dist/cli.js");
		if (existsSync(localCli)) {
			return `node ${localCli}`;
		}
	} catch {
		// ignore
	}
	return "npx --yes agent-note";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchAgentnoteNotes(): void {
	try {
		execSync("git fetch origin refs/notes/agentnote:refs/notes/agentnote", {
			stdio: "pipe",
		});
	} catch {
		core.info("No agent-note notes found on remote.");
	}
}

function isEnabled(value: string): boolean {
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

async function postPrReport(
	outputMode: PrOutputMode,
	markdown: string,
): Promise<void> {
	if (outputMode === "none") return;
	if (!markdown || !github.context.payload.pull_request) return;

	const token = process.env.GITHUB_TOKEN || "";
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

async function run(): Promise<void> {
	try {
		const base =
			core.getInput("base") ||
			`origin/${github.context.payload.pull_request?.base?.ref ?? "main"}`;
		const headSha = github.context.payload.pull_request?.head?.sha;
		const cliCmd = resolveCliCommand();

		const prOutputMode = resolvePrOutputMode(core.getInput("pr_output"));

		let json = "";
		let report: Record<string, unknown> | null = null;
		const maxAttempts = 3;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			fetchAgentnoteNotes();

			try {
				json = execSync(buildPrReportCommand(cliCmd, base, headSha, { json: true }), {
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
				}).trim();
			} catch {
				core.info("No agent-note data found for this PR.");
				return;
			}

			if (!json || json === "{}") {
				core.info("No agent-note data found for this PR.");
				return;
			}

			report = JSON.parse(json) as Record<string, unknown>;
			if (!shouldRetryNotesFetch(report) || attempt === maxAttempts) {
				break;
			}

			core.info(
				`Agent Note data is not available yet (attempt ${attempt}/${maxAttempts}). Retrying...`,
			);
			await sleep(attempt * 1000);
		}

		if (!report) {
			core.info("No agent-note data found for this PR.");
			return;
		}

		core.setOutput("overall_ai_ratio", String(report.overall_ai_ratio ?? 0));
		core.setOutput("overall_method", String(report.overall_method ?? "file"));
		core.setOutput("tracked_commits", String(report.tracked_commits ?? 0));
		core.setOutput("total_commits", String(report.total_commits ?? 0));
		core.setOutput("total_prompts", String(report.total_prompts ?? 0));
		core.setOutput("json", json);

		let markdown = "";
		try {
			markdown = execSync(buildPrReportCommand(cliCmd, base, headSha), {
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();
		} catch {
			markdown = "";
		}
		// Keep PR descriptions text-only for now.
		// The action runs against consumer repositories, so there is no stable
		// public image URL we can rely on for model icons until those assets are
		// published from a public host.
		const reportModel =
			typeof report.model === "string" ? report.model.trim() : "";
		void reportModel;

		core.setOutput("markdown", markdown);

		await postPrReport(prOutputMode, markdown);
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error.message);
		}
	}
}

run();
