import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import {
	COMMENT_MARKER,
	resolvePrOutputMode,
	shouldRetryNotesFetch,
	upsertDescription,
} from "./helpers.js";

type PrOutputMode = "description" | "comment" | "none";

interface DashboardPrEntry {
	number: number;
	title: string;
	commits: string[];
}

interface DashboardCommitEntry {
	sha: string;
	short_sha: string;
	message: string;
	date: string;
	author: string;
	agent: string | null;
	model: string | null;
	session_id: string | null;
	ai_ratio: number;
	lines_ai: number;
	lines_total: number;
	turns: number;
	note_url: string;
}

interface DashboardIndex {
	version: number;
	generated_at: string;
	repo: string;
	prs: DashboardPrEntry[];
	commits: DashboardCommitEntry[];
}

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

async function readDashboardIndex(indexPath: string): Promise<DashboardIndex | null> {
	if (!existsSync(indexPath)) return null;
	try {
		const raw = await readFile(indexPath, "utf-8");
		return JSON.parse(raw) as DashboardIndex;
	} catch {
		return null;
	}
}

function toDashboardCommitEntry(note: Record<string, unknown>, commitSha: string): DashboardCommitEntry {
	const commit = (note.commit ?? {}) as Record<string, unknown>;
	const attribution = (note.attribution ?? {}) as Record<string, unknown>;
	const lines = (attribution.lines ?? {}) as Record<string, unknown>;
	const interactions = Array.isArray(note.interactions) ? note.interactions : [];
	const shortSha =
		typeof commit.short_sha === "string" && commit.short_sha
			? commit.short_sha
			: commitSha.slice(0, 7);

	return {
		sha: typeof commit.sha === "string" && commit.sha ? commit.sha : commitSha,
		short_sha: shortSha,
		message:
			typeof commit.message === "string" && commit.message
				? commit.message
				: shortSha,
		date: typeof commit.date === "string" ? commit.date : "",
		author: typeof commit.author === "string" ? commit.author : "",
		agent: typeof note.agent === "string" ? note.agent : null,
		model: typeof note.model === "string" ? note.model : null,
		session_id: typeof note.session_id === "string" ? note.session_id : null,
		ai_ratio:
			typeof attribution.ai_ratio === "number" ? attribution.ai_ratio : 0,
		lines_ai: typeof lines.ai_added === "number" ? lines.ai_added : 0,
		lines_total:
			typeof lines.total_added === "number" ? lines.total_added : 0,
		turns: interactions.length,
		note_url: `./notes/${shortSha}.json`,
	};
}

function mergeDashboardIndex(
	existing: DashboardIndex | null,
	repoName: string,
	prEntry: DashboardPrEntry,
	commitEntries: DashboardCommitEntry[],
): DashboardIndex {
	const nextCommits = new Map<string, DashboardCommitEntry>();
	for (const commit of existing?.commits ?? []) {
		nextCommits.set(commit.sha, commit);
	}
	for (const commit of commitEntries) {
		nextCommits.set(commit.sha, commit);
	}

	const nextPrs = new Map<number, DashboardPrEntry>();
	for (const pr of existing?.prs ?? []) {
		nextPrs.set(pr.number, pr);
	}
	nextPrs.set(prEntry.number, prEntry);

	return {
		version: 1,
		generated_at: new Date().toISOString(),
		repo: repoName,
		prs: [...nextPrs.values()].sort((a, b) => b.number - a.number),
		commits: [...nextCommits.values()].sort((a, b) => {
			const dateCompare = b.date.localeCompare(a.date);
			if (dateCompare !== 0) return dateCompare;
			return b.short_sha.localeCompare(a.short_sha);
		}),
	};
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
	const indexPath = join(dashboardDir, "index.json");
	await mkdir(notesDir, { recursive: true });

	const repoName = `${github.context.repo.owner}/${github.context.repo.repo}`;
	const commitEntries: DashboardCommitEntry[] = [];
	const commits = Array.isArray(report.commits)
		? (report.commits as Array<Record<string, unknown>>)
		: [];

	for (const commit of commits) {
		const sha = typeof commit.sha === "string" ? commit.sha : "";
		if (!sha) continue;

		const note = readGitNote(sha);
		if (!note) continue;

		const entry = toDashboardCommitEntry(note, sha);
		await writeFile(
			join(notesDir, `${entry.short_sha}.json`),
			`${JSON.stringify(note, null, 2)}\n`,
		);
		commitEntries.push(entry);
	}

	const existing = await readDashboardIndex(indexPath);
	const merged = mergeDashboardIndex(existing, repoName, {
		number: pullRequest.number,
		title: pullRequest.title,
		commits: commitEntries.map((commit) => commit.short_sha),
	}, commitEntries);

	await writeFile(indexPath, `${JSON.stringify(merged, null, 2)}\n`);
	core.info(
		`Agent Note dashboard bundle updated at ${dashboardDir} (${commitEntries.length} commits).`,
	);
	return { dir: dashboardDir, commits: commitEntries.length };
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
		const cliCmd = resolveCliCommand();

		const prOutputMode = resolvePrOutputMode(
			core.getInput("pr_output"),
			core.getInput("output"),
			core.getInput("comment"),
		);
		const dashboardEnabled = isEnabled(core.getInput("dashboard"));
		const dashboardDirInput =
			core.getInput("dashboard_dir") || "packages/dashboard/public/view-demo";

		let json = "";
		let report: Record<string, unknown> | null = null;
		const maxAttempts = 3;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			fetchAgentnoteNotes();

			try {
				json = execSync(`${cliCmd} pr "${base}" --json`, {
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
			markdown = execSync(`${cliCmd} pr "${base}"`, {
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();
		} catch {
			markdown = "";
		}
		core.setOutput("markdown", markdown);

		let dashboardCommits = 0;
		let dashboardDir = "";
		if (dashboardEnabled) {
			const result = await writeDashboardBundle(report, dashboardDirInput);
			dashboardCommits = result.commits;
			dashboardDir = result.dir;
		}
		core.setOutput("dashboard_dir", dashboardDir);
		core.setOutput("dashboard_commits", String(dashboardCommits));

		await postPrReport(prOutputMode, markdown);
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error.message);
		}
	}
}

run();
