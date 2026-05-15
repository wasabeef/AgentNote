---
name: agentnote-release
description: Prepare and publish Agent Note releases with the repo-local Markdown workflow, including version bump validation, release note preview, tag creation, workflow monitoring, and npm/GitHub verification.
---

# Agent Note Release Workflow

Use this skill when the task asks to release Agent Note, bump a version, cut a tag, publish npm packages, or verify a release.

## Prepare

1. Confirm the target version from the user request, accepting either `x.y.z` or `vx.y.z`. Use `x.y.z` for package metadata and `vx.y.z` for the git tag.
2. Switch to `main` and pull the latest changes before an actual release.
3. Check the working tree. Do not release with unrelated dirty files.
4. If the user only wants a rehearsal or passes `--dry-run`, do not edit files, commit, tag, or push; only inspect state, run safe checks when useful, and preview the release notes.

## Release

Follow these steps instead of relying on a release script:

1. Update `packages/cli/package.json` to `x.y.z`.
2. Update `package-lock.json` so `packages["packages/cli"].version` is also `x.y.z`.
3. Run `npm -w packages/cli run build`.
4. Run `npm -w packages/cli run typecheck`.
5. Run `npm -w packages/cli run lint`.
6. Run `npm -w packages/cli test`.
7. Preview release notes with `git-cliff --config .github/cliff.toml --unreleased --tag vx.y.z --strip header`.
8. Stage `packages/cli/package.json`, `package-lock.json`, and the rebuilt `packages/cli/dist/cli.js`.
9. Commit only those release files as `chore: bump version to x.y.z` with `Release note: skip`.
10. Create the annotated tag with `git tag -a vx.y.z -m vx.y.z`.
11. Push `main` and `vx.y.z` only when ready to publish.

## Guardrails

- Do not manually push a release tag before the package version bump commit is on `main`.
- If release notes look like an implementation log, fix commit subjects or `Release note:` bodies before tagging.
- If any step fails after a local commit or tag, inspect the repository state before retrying; do not create duplicate tags.
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
