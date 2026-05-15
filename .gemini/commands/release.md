---
description: Prepare or publish an Agent Note release with the repo-local release command.
argument-hint: <version> [--push|--dry-run]
---

# Agent Note Release

Use the repo-local `agentnote-release` skill.

1. Use the provided version argument, accepting `x.y.z` or `vx.y.z`.
2. For an actual release, switch to `main`, pull, and ensure unrelated dirty files are not present.
3. Run `npm run release -- <version> --dry-run --allow-non-main --allow-dirty --skip-checks` for a rehearsal, `npm run release -- <version>` for local preparation, or `npm run release -- <version> --push` when the user explicitly wants to publish.
4. Verify the release workflow, GitHub Release, and both npm packages after pushing.
5. Report the commands run and final release status.
