# Engineering Guidelines

This file defines implementation rules for this repository. The goal is to make
the decision criteria explicit enough for both humans and AI coding agents to
apply the same standards.

`AGENTS.md` and `CLAUDE.md` describe working behavior, `CONTRIBUTING.md`
describes contributor workflow, and this file describes code quality rules.

## How To Use This File

- Before implementing a change, check the constraints for the area you are touching.
- When a PR review has competing opinions, prefer this file as the local rule.
- If a rule needs to change, update this file in the same PR as the code change.
- Do not add temporary workarounds here. Only promote rules that should last.

## Core Principles

- Write source code, comments, test names, and CLI output in English.
- Prefer clarity over abstractions that hide the control flow.
- Keep structural changes separate from behavior changes. Renames, moves, and formatting must not be mixed with feature or bug-fix behavior.
- CI code such as GitHub Action and Dashboard workflows must leave enough logs for users to diagnose failures.
- Keep current-behavior documentation in `docs/architecture.md` and `docs/knowledge/`. Do not use archived plans as current rules.

## Constants

- Use named constants for magic numbers, event names, state names, branch names, directory names, Git refs, and GitHub Actions output names.
- If a value has meaning only inside one file, define it as a local constant near the top of that file.
- Use shared constants only when multiple files use the same value with the same meaning. If sharing would create heavy dependencies, duplicate a same-named local constant instead.
- Put regular expressions in `const` declarations or give them a nearby name that explains their intent. Add a short comment for complex regexes.
- When changing public API values, schema fields, or persistent storage values, update docs and tests in the same PR.

Good:

```js
const EVENT_PULL_REQUEST = "pull_request";
const GITHUB_PAGES_BRANCH = "gh-pages";
```

Avoid:

```js
if (eventName === "pull_request") {
  git(["fetch", "origin", "gh-pages"]);
}
```

## Generated Artifacts

- Keep `packages/pr-report/dist/index.js` tracked. It is the GitHub Action runtime bundle referenced by `action.yml`, so published Action users must not need a build step before the Action can start.
- Keep `packages/cli/dist/cli.js` tracked for v1.x. It is the npm `bin` target, the CLI smoke-test target, and the path pinned by repo-local git hook shims.
- Do not hand-edit generated bundles. Change source first, rebuild with the package build script, and commit the generated bundle only as the source change requires.
- `.agentnoteignore` excludes generated bundles from AI Ratio. It does not mean those files are untracked or unimportant release artifacts.
- Reconsider untracking `packages/cli/dist/cli.js` only after release, tests, and repo-local hook shims no longer depend on a checked-in bundle. Do not untrack `packages/pr-report/dist/index.js` without changing the Action runtime architecture.

## Comments

- Explain why code exists, not what an obvious assignment or function call does.
- Add TSDoc/JSDoc block comments to exported functions, workflow entry points, and complex decision functions.
- Prefer short English comments that still make sense when Agent Note surfaces them as `📝 Context`.
- Do not comment obvious assignments or direct function calls.
- Comment fallbacks, heuristics, fail-safe choices, persistence boundaries, and external service constraints.
- Comments become harmful when they drift from behavior, so update nearby comments whenever behavior changes.

Good:

```js
/**
 * Merge the current dashboard snapshot into the durable gh-pages note store.
 *
 * The snapshot may contain only one PR, so the merge removes stale notes for
 * affected PRs and leaves every unrelated PR note in place.
 */
```

Avoid:

```js
// Remove files.
rmSync(path, { force: true });
```

## Dashboard Workflow

- `packages/dashboard/workflow/*.mjs` runs directly in GitHub Actions, so environment variables, outputs, branches, and paths must be named constants.
- Treat `gh-pages/dashboard/notes/*.json` as the Dashboard durable store. PR builds are partial snapshots, so they must not delete unrelated PR notes.
- Pages artifact logic must stay inside the workspace. Dynamic paths or paths outside the workspace must fail closed and skip the unsafe operation.
- Dashboard note JSON limits and diff limits exist for Pages artifact size and UI rendering. Keep them as named constants and document the intent.

## Tests

- Even for refactors, run the unit tests for the affected area.
- If you touch Dashboard workflow code, verify the relevant `packages/dashboard` test/build path.
- If you touch PR Report rendering or Action inputs, verify the relevant `packages/pr-report` test/build path.
- If you touch CLI core or an agent adapter, verify `packages/cli` build, typecheck, lint, and tests.
- Prefer characterization tests for user-visible contracts: CLI output, PR body updates, hidden reviewer context, Dashboard note persistence, and attribution fallback boundaries.
- Do not inflate coverage by repeating the same scenario. Use unique command inputs or generated scenario matrices, and assert uniqueness when a smoke test is meant to represent broad coverage.
- Dist CLI smoke tests must execute the built `packages/cli/dist/cli.js` in temporary repositories with isolated `HOME` / config paths. They should not depend on the developer's live repository state.
- For heuristic or fallback logic, cover both the rescue path and the false-positive path. A fallback that records missing data must also prove it does not attribute unrelated human or read-only work.

## Commit Messages And Release Notes

Release notes are generated from commits by `git-cliff`. Treat every commit
subject as public copy unless the commit type is intentionally internal.

- Use `feat:`, `fix:`, or `perf:` when users should see the change in the next release note.
- Use `docs:`, `test:`, `refactor:`, `ci:`, `chore:`, or `build:` for internal work that should normally stay out of release notes.
- If an internal-looking commit has public impact, add a body line: `Release note: <one clear user-facing sentence>`.
- If a public-looking commit should be hidden, add `Release note: skip`.
- Do not put release-worthy wording only in a PR title or merge commit. Merge commits, version bumps, and generated bundle sync commits are excluded from release notes.
- Avoid vague subjects such as `address review notes`, `sync generated bundle`, `polish docs`, or `fix tests`. Name the visible outcome instead.
- Keep multi-commit PRs readable in the generated release note. Review-fix follow-up commits in a multi-commit PR should usually use `Release note: skip` unless they describe a distinct user-visible change.
- The release generator capitalizes the first character of each bullet as a safety net. Still write natural English yourself; this only fixes mechanical lower-case commit subjects.
- A PR title is not the release-note source, but it should still read like the top-level release summary for the PR. If the title would be a bad release bullet, improve it before opening or merging the PR.
- Before tagging, run `git-cliff --config .github/cliff.toml --latest --strip header`. If the output reads like an implementation log, rewrite commit subjects/bodies before cutting the release.

Good commit body shape:

```text
Why
The PR report showed absorbed external review prompts in compact mode.

User impact
Compact PR reports now focus on prompts that directly explain the current change.

Verification
- npm -w packages/cli test
- npm -w packages/pr-report test

Release note: Compact PR reports now hide absorbed external review prompts.
```

Use `Release note: skip` for commits like version bumps, generated bundles,
test-only coverage, local refactors without behavior changes, and docs-only
maintenance that does not change user-facing guidance.

For a PR with several implementation commits for the same behavior, prefer this
shape:

```text
fix(hooks): recover Codex commits in cmux sessions

Why
cmux can preserve CODEX_THREAD_ID while the repository-local active-session
pointer is stale.

User impact
Codex commits created from cmux are recorded again without attributing unrelated
read-only shell commands.

Verification
- npm -w packages/cli test

Release note: Codex commits made from cmux sessions are now recorded reliably without pulling in unrelated transcript history.
```

Follow-up review commits in that same PR should usually include:

```text
Release note: skip
```
