---
name: coderabbit-review
description: Fetch CodeRabbit review feedback for the current PR, classify actionable items, implement fixes, verify them, and resolve only addressed review threads.
---

# CodeRabbit Review Workflow

Use this skill when the task asks to address CodeRabbit comments, review CodeRabbit feedback, or resolve CodeRabbit threads.

## Fetch

Determine the pull request before fetching review feedback:

1. Use the PR number from the user when one is provided.
2. Otherwise run `gh pr view --json number,url` for the current branch.
3. If that fails, run `gh pr list --head "$(git branch --show-current)" --json number,url,state`.
4. If no PR can be identified, stop and report that the current branch has no open PR.

Fetch review threads with GraphQL, then keep only unresolved CodeRabbit-authored threads. Replace the variables with the current repository and PR:

```bash
gh api graphql \
  -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line startLine comments(first:50){nodes{id databaseId body url author{login}}}}}}}}' \
  -F owner=<owner> \
  -F repo=<repo> \
  -F number=<pr-number>
```

Fetch CodeRabbit summary comments when useful:

```bash
gh api 'repos/<owner>/<repo>/issues/<pr-number>/comments?per_page=100'
```

Filter both outputs to CodeRabbit authors. For review threads, keep threads where `isResolved` is `false` and at least one comment author is CodeRabbit; use the latest CodeRabbit-authored comment as the actionable text. Treat those unresolved review threads as the primary action list.

If `pageInfo.hasNextPage` is `true`, repeat the GraphQL query with `after: <endCursor>` until all review threads have been checked.

## Triage

- Treat unresolved review threads as the primary action list.
- Treat summary comments as context, not as automatic TODOs.
- Classify each thread as `fix`, `false-positive`, `already-fixed`, or `needs-user-decision`.
- Inspect the referenced file and surrounding code before deciding.
- Do not resolve a thread until the fix is present and verified.

## Fix

- Prefer the smallest source change that addresses the review.
- If the comment points at a generated file, update the source and regenerate the generated file.
- Keep unrelated refactors out of the fix unless they are required for safety.
- Preserve Agent Note behavior: commits must not fail because review automation failed.

## Verify

- Run the narrowest relevant test first.
- Run broader checks when behavior, generated files, docs, or public output changed.
- If no automated check is relevant, explain the manual verification.

## Resolve

Resolve fixed review threads with:

```bash
gh api graphql \
  -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}' \
  -F threadId=<review-thread-id>
```

Always run the resolve command for threads that are fixed and verified.

If a thread will not be changed, leave it unresolved and add a short rationale comment in English instead. Do not silently resolve rejected, deferred, or uncertain feedback.

Reply to an unresolved review comment without resolving it by using the latest CodeRabbit review comment `databaseId` from the GraphQL output:

```bash
gh api --method POST \
  repos/<owner>/<repo>/pulls/<pr-number>/comments/<comment-database-id>/replies \
  -f body='<short English rationale>'
```

Do not resolve issue comments or summary comments; only GitHub review threads can be resolved.

## Report

End with:

- Fixed threads
- Threads intentionally left unresolved
- Checks run
- Any remaining risk
