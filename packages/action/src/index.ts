import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import {
	buildPrReportCommand,
	COMMENT_MARKER,
	resolveModelIconUrl,
	resolveDashboardUrl,
	resolvePrOutputMode,
	shouldRetryNotesFetch,
	upsertDescription,
	withDashboardLink,
	withModelIcon,
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

function readGitNote(commitSha: string): Record<string, unknown> | null {
	try {
		const raw = execSync(`git notes --ref=agentnote show "${commitSha}"`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (!raw) return null;
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function withDashboardMetadata(
	note: Record<string, unknown>,
	commitSha: string,
	pullRequest: { number: number; title: string },
): Record<string, unknown> {
	const commit = (note.commit ?? {}) as Record<string, unknown>;
	const shortSha =
		typeof commit.short_sha === "string" && commit.short_sha
			? commit.short_sha
			: commitSha.slice(0, 7);

	return {
		...note,
		commit: {
			...commit,
			sha: typeof commit.sha === "string" && commit.sha ? commit.sha : commitSha,
			short_sha: shortSha,
		},
		pull_request: {
			number: pullRequest.number,
			title: pullRequest.title,
		},
	};
}

async function removeDashboardNotesForPr(
	notesDir: string,
	prNumber: number,
): Promise<void> {
	if (!existsSync(notesDir)) return;

	for (const name of await readdir(notesDir)) {
		if (!name.endsWith(".json")) continue;
		const path = join(notesDir, name);

		try {
			const note = JSON.parse(
				await readFile(path, "utf-8"),
			) as Record<string, unknown>;
			const pullRequest = (note.pull_request ?? {}) as Record<string, unknown>;
			if (pullRequest.number === prNumber) {
				await rm(path, { force: true });
			}
		} catch {
			// Ignore malformed dashboard files and leave them untouched.
		}
	}
}

async function writeDashboardBundle(
	report: Record<string, unknown>,
	dashboardDirInput: string,
): Promise<{ dir: string; commits: number }> {
	const pullRequest = github.context.payload.pull_request;
	if (!pullRequest) {
		core.info("No pull request context available. Skipping dashboard bundle.");
		return { dir: resolve(dashboardDirInput), commits: 0 };
	}

	const dashboardDir = resolve(dashboardDirInput);
	const notesDir = join(dashboardDir, "notes");
	await mkdir(notesDir, { recursive: true });
	await removeDashboardNotesForPr(notesDir, pullRequest.number);

	let writtenCommits = 0;
	const commits = Array.isArray(report.commits)
		? (report.commits as Array<Record<string, unknown>>)
		: [];

	for (const commit of commits) {
		const sha = typeof commit.sha === "string" ? commit.sha : "";
		if (!sha) continue;

		const note = readGitNote(sha);
		if (!note) continue;

		const dashboardNote = withDashboardMetadata(note, sha, {
			number: pullRequest.number,
			title: pullRequest.title,
		});
		const commitInfo = (dashboardNote.commit ?? {}) as Record<string, unknown>;
		const shortSha =
			typeof commitInfo.short_sha === "string" && commitInfo.short_sha
				? commitInfo.short_sha
				: sha.slice(0, 7);
		await writeFile(
			join(notesDir, `${shortSha}.json`),
			`${JSON.stringify(dashboardNote, null, 2)}\n`,
		);
		writtenCommits += 1;
	}

	core.info(
		`Agent Note dashboard notes updated at ${notesDir} (${writtenCommits} commits).`,
	);
	return { dir: dashboardDir, commits: writtenCommits };
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

		const prOutputMode = resolvePrOutputMode(
			core.getInput("pr_output"),
			core.getInput("output"),
			core.getInput("comment"),
		);
		const dashboardEnabled = isEnabled(core.getInput("dashboard"));
		const dashboardDirInput =
			core.getInput("dashboard_dir") || "packages/dashboard/public";
		const dashboardUrlInput = core.getInput("dashboard_url");

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
		const reportModel =
			typeof report.model === "string" ? report.model.trim() : "";
		if (reportModel) {
			const iconRef = headSha || github.context.sha;
			markdown = withModelIcon(
				markdown,
				reportModel,
				resolveModelIconUrl(
					reportModel,
					`${github.context.repo.owner}/${github.context.repo.repo}`,
					iconRef,
				),
			);
		}

		let dashboardCommits = 0;
		let dashboardDir = "";
		let dashboardUrl = "";
		if (dashboardEnabled) {
			const result = await writeDashboardBundle(report, dashboardDirInput);
			dashboardCommits = result.commits;
			dashboardDir = result.dir;
			if (dashboardCommits > 0 && dashboardUrlInput.trim()) {
				dashboardUrl = resolveDashboardUrl(dashboardUrlInput);
			}
		}
		if (dashboardUrl) {
			markdown = withDashboardLink(markdown, dashboardUrl);
		}
		core.setOutput("markdown", markdown);
		core.setOutput("dashboard_dir", dashboardDir);
		core.setOutput("dashboard_commits", String(dashboardCommits));
		core.setOutput("dashboard_url", dashboardUrl);

		await postPrReport(prOutputMode, markdown);
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error.message);
		}
	}
}

run();
