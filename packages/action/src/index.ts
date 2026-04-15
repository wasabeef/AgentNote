import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { COMMENT_MARKER, DESCRIPTION_BEGIN, DESCRIPTION_END, resolveOutputMode, upsertDescription } from "./helpers.js";

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
  return "npx --yes agentnote";
}

async function run(): Promise<void> {
  try {
    const base =
      core.getInput("base") ||
      `origin/${github.context.payload.pull_request?.base?.ref ?? "main"}`;
    const cliCmd = resolveCliCommand();

    // Resolve output mode from action inputs.
    const outputInput = core.getInput("output");
    const commentInput = core.getInput("comment");
    const outputMode = resolveOutputMode(outputInput, commentInput);

    // Fetch agentnote notes.
    try {
      execSync("git fetch origin refs/notes/agentnote:refs/notes/agentnote", { stdio: "pipe" });
    } catch {
      core.info("No agentnote notes found on remote.");
    }

    // Generate JSON report.
    let json: string;
    try {
      json = execSync(`${cliCmd} pr "${base}" --json`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      core.info("No agentnote data found for this PR.");
      return;
    }

    if (!json || json === "{}") {
      core.info("No agentnote data found for this PR.");
      return;
    }

    const report = JSON.parse(json);

    // Set outputs.
    core.setOutput("overall_ai_ratio", String(report.overall_ai_ratio ?? 0));
    core.setOutput("overall_method", String(report.overall_method ?? "file"));
    core.setOutput("tracked_commits", String(report.tracked_commits ?? 0));
    core.setOutput("total_commits", String(report.total_commits ?? 0));
    core.setOutput("total_prompts", String(report.total_prompts ?? 0));
    core.setOutput("json", json);

    // Generate markdown report.
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

    // Skip posting if comment=false (legacy opt-out).
    if (commentInput === "false") return;
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
      // Upsert into PR description.
      const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: issueNumber });
      const existingBody = pr.body ?? "";
      const newBody = upsertDescription(existingBody, markdown);

      await octokit.rest.pulls.update({ owner, repo, pull_number: issueNumber, body: newBody });
      core.info("Agentnote report added to PR description.");
    } else {
      // Post/update PR comment.
      const marker = "<!-- agentnote-pr-report -->";
      const body = `${marker}\n${markdown}`;

      const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
      });

      const existing = comments.find((c) => c.body?.includes(marker));

      if (existing) {
        await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
      } else {
        await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
      }

      core.info("Agentnote report posted as PR comment.");
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
