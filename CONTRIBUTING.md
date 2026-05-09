# Contributing to Agent Note

Thank you for helping improve Agent Note. This guide explains how to set up the
repository, where the main pieces live, and what we expect before a pull request
is ready for review.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you agree to keep discussions respectful and constructive.

## Ways to Contribute

- Report bugs with a minimal reproduction and the agent you were using.
- Suggest improvements to the CLI, PR Report, Dashboard, or documentation.
- Add tests for agent adapters and edge cases around git hooks.
- Improve translations without changing technical meaning.
- Help keep generated bundles, workflows, and release notes accurate.

For larger changes, open an issue first so we can agree on scope before you
spend time on implementation.

## Development Setup

### Prerequisites

- Node.js 22.12.0 or later for repository development, docs, and Dashboard
  builds.
- Git.
- At least one supported coding agent if you are testing hook integration:
  Claude Code, Codex CLI, Cursor, or Gemini CLI.

The published `agent-note` CLI package supports Node.js 20 or later.

### Initial Setup

```bash
git clone https://github.com/your-username/AgentNote.git
cd AgentNote
git remote add upstream https://github.com/wasabeef/AgentNote.git

npm ci
cd packages/cli
npm run build
npm test
```

Most CLI checks run from `packages/cli/`:

```bash
cd packages/cli
npm run build
npm run typecheck
npm run lint
npm test
```

Website and Dashboard checks run from their own package directories:

```bash
npm run build --prefix website
npm run build --prefix packages/dashboard
```

## Repository Structure

```text
packages/
├── cli/          # agent-note CLI package
├── pr-report/    # PR Description renderer and root GitHub Action bundle
└── dashboard/    # Dashboard viewer and Dashboard workflow helpers

website/          # Astro Starlight documentation site
docs/             # Maintainer docs and design notes
action.yml        # Marketplace action entrypoint
```

Useful maintainer references:

- [docs/README.md](docs/README.md): maintainer documentation map.
- [docs/architecture.md](docs/architecture.md): data flow and storage model.
- [docs/engineering.md](docs/engineering.md): coding rules for contributors
  and AI agents.
- [docs/knowledge/](docs/knowledge/): prompt selection, context, and
  investigation history.

## Architecture Notes

Agent Note has two runtime paths:

- The CLI path handles user commands such as `init`, `status`, `show`, `log`,
  `pr`, `commit`, and `record`.
- The hook path receives JSON events from supported coding agents and records
  local session data under `.git/agentnote/`.

`agent-note init` installs repository-local git hooks and agent hook
configuration. The git hooks connect normal `git commit` and `git push` to
`refs/notes/agentnote` so the recorded note follows the branch.

The high-level flow is:

```text
Agent hook event
  -> agent-note hook
  -> .git/agentnote/sessions/<id>/*.jsonl
  -> git commit
  -> agent-note record
  -> refs/notes/agentnote
  -> PR Report / Dashboard
```

## Coding Standards

- Source code, comments, test names, and CLI output are written in English.
- End-user docs can be localized; keep technical terms consistent across
  languages.
- Keep functions small and explicit. Prefer early returns over deep nesting.
- Avoid magic numbers and hard-coded strings. Use named constants or documented
  local constants.
- Do not add runtime dependencies to the CLI package.
- All git operations must go through the Git CLI wrapper in `packages/cli/src/`.
- Agent Note must never make `git commit` fail because recording failed.

Separate structural and behavioral changes when possible:

- Structural changes move, rename, format, or reorganize code without behavior
  changes.
- Behavioral changes add, fix, or remove behavior and should include tests.

## Testing Guidelines

Tests live next to the source files they cover and use `node:test` with
`node:assert/strict`.

Before opening a pull request, run:

```bash
cd packages/cli
npm run build
npm run typecheck
npm run lint
npm test
```

Run package-specific checks when touching those areas:

```bash
cd /path/to/AgentNote
npm test --workspace packages/pr-report
npm run build --workspace packages/pr-report
npm run build --prefix packages/dashboard
npm run build --prefix website
```

Add or update tests for:

- Agent hook event parsing.
- Git hook behavior.
- Prompt selection and AI Ratio calculations.
- PR Report rendering.
- Dashboard data and rendering behavior.
- Security-sensitive path or shell handling.

## Commit Messages

Use Conventional Commits:

```text
type(scope): description
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `ci`,
`build`, `chore`.

Examples:

```text
feat(report): add reviewer context
fix(record): keep shell-only Codex prompts
docs(readme): clarify dashboard setup
test(init): cover existing hook chaining
```

Release notes are generated from commit messages. User-facing `feat:`,
`fix:`, and `perf:` commits are included by default. Internal commits are hidden
unless their body contains:

```text
Release note: <public summary>
```

Use `Release note: skip` when a public-looking commit should stay out of the
release notes.

## Pull Request Checklist

- [ ] The change is scoped and easy to review.
- [ ] Source code, comments, tests, and CLI output are in English.
- [ ] Local checks pass for the packages touched.
- [ ] New behavior has tests.
- [ ] Documentation, README files, and website pages are updated when behavior
      changes.
- [ ] Generated bundles are rebuilt when their source changes.
- [ ] No new CLI runtime dependency was added.
- [ ] Commit messages follow the release-note rules above.

## Getting Help

- Use GitHub Issues for bugs and feature requests.
- Use Pull Request comments for implementation review.
- Use GitHub Security Advisories for security reports.
