import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync } from "node:child_process";

const COMMENT_MARKER = "<!-- agentnote-pr-report -->";

async function run(): Promise<void> {
  try {
    const base = core.getInput("base") || `origin/${github.context.payload.pull_request?.base?.ref ?? "main"}`;
    const shouldComment = core.getInput("comment") !== "false";

    // Fetch agentnote notes.
    try {
      execSync("git fetch origin refs/notes/agentnote:refs/notes/agentnote", { stdio: "pipe" });
    } catch {
      core.info("No agentnote notes found on remote.");
    }

    // Generate JSON report.
    let json: string;
    try {
      json = execSync(`npx --yes @wasabeef/agentnote pr "${base}" --json`, {
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
    core.setOutput("tracked_commits", String(report.tracked_commits ?? 0));
    core.setOutput("total_commits", String(report.total_commits ?? 0));
    core.setOutput("total_prompts", String(report.total_prompts ?? 0));
    core.setOutput("json", json);

    // Generate markdown report.
    let markdown = "";
    try {
      markdown = execSync(`npx --yes @wasabeef/agentnote pr "${base}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      markdown = "";
    }
    core.setOutput("markdown", markdown);

    // Post or update PR comment.
    if (shouldComment && markdown && github.context.payload.pull_request) {
      const token = core.getInput("token") || process.env.GITHUB_TOKEN || "";
      if (!token) {
        core.warning("No GitHub token available. Skipping PR comment.");
        return;
      }

      const octokit = github.getOctokit(token);
      const { owner, repo } = github.context.repo;
      const issueNumber = github.context.payload.pull_request.number;

      const body = `${COMMENT_MARKER}\n${markdown}`;

      const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
      });

      const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));

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

      core.info("Agentnote report posted to PR.");
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
