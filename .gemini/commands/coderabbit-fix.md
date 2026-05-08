---
description: Fetch CodeRabbit review comments, fix actionable items, verify changes, and resolve addressed threads.
argument-hint: [pr-number]
---

Use the repo-local CodeRabbit review skill.

1. Determine the PR first. Use the provided PR number when present; otherwise use the current branch via `gh pr view --json number,url`, with `gh pr list --head "$(git branch --show-current)" --json number,url,state` as a fallback.
2. Fetch review threads directly with `gh api graphql`; fetch issue comments with `gh api repos/{owner}/{repo}/issues/<number>/comments?per_page=100`.
3. Treat unresolved review threads as the primary action list.
4. Inspect each referenced file before editing.
5. Fix actionable issues with the smallest safe change.
6. Run relevant checks.
7. Resolve every CodeRabbit review thread that is fixed and verified. Do not resolve unfinished or uncertain items.
8. Report what changed, what was verified, and which threads remain.
