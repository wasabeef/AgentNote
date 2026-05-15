---
description: Prepare or publish an Agent Note release with the repo-local Markdown workflow.
argument-hint: <version> [--push|--dry-run]
---

# Agent Note Release

Use the repo-local `agentnote-release` skill.

1. Use the provided version argument, accepting `x.y.z` or `vx.y.z`.
2. For an actual release, switch to `main`, pull, and ensure unrelated dirty files are not present.
3. Normalize the version: package metadata uses `x.y.z`; the git tag is always `vx.y.z`.
4. Follow the skill's manual release steps: update package metadata, rebuild, run checks, preview with `git-cliff --config .github/cliff.toml --unreleased --tag vx.y.z --strip header`, commit, tag, and push only when publishing.
5. Verify the release workflow, GitHub Release, and both npm packages after pushing.
6. Report the commands run and final release status.
