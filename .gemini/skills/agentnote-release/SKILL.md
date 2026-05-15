---
name: agentnote-release
description: Prepare and publish Agent Note releases with the repo-local release command, including version bump validation, release note preview, tag creation, workflow monitoring, and npm/GitHub verification.
---

# Agent Note Release Workflow

Use this skill when the task asks to release Agent Note, bump a version, cut a tag, publish npm packages, or verify a release.

## Prepare

1. Confirm the target version from the user request, accepting either `x.y.z` or `vx.y.z`.
2. Switch to `main` and pull the latest changes before an actual release.
3. Check the working tree. Do not release with unrelated dirty files.
4. If the user only wants a rehearsal, use `--dry-run`; do not create commits or tags.

## Release

Prefer the repo-local command:

```bash
npm run release -- <version> --push
```

Without `--push`, the command prepares the local version-bump commit and annotated tag but does not publish them:

```bash
npm run release -- <version>
```

The command updates package metadata, runs the CLI build/typecheck/lint/test checks, previews the next release notes with `git-cliff --unreleased --tag`, creates the dedicated `chore: bump version to <version>` commit, and creates the annotated `v<version>` tag.

## Guardrails

- Do not manually push a release tag before the package version bump commit is on `main`.
- Do not use `--push` until the release note preview is acceptable.
- If release notes look like an implementation log, fix commit subjects or `Release note:` bodies before tagging.
- If the command fails after a local commit or tag, inspect the repository state before retrying; do not create duplicate tags.
- Keep release plumbing commits hidden with `Release note: skip`.

## Verify

After pushing a release tag:

1. Watch the release workflow until completion.
2. Verify the GitHub Release exists for `v<version>`.
3. Verify npm publishes both `agent-note@<version>` and `@wasabeef/agentnote@<version>`.
4. If release notes need copy edits after publication, update the GitHub Release body directly and keep the source commit guidance for future releases.

## Report

End with:

- Version released or prepared
- Commands run
- Workflow status
- GitHub Release URL
- npm package versions confirmed
