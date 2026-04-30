# Contributing to Agent Note

Thank you for your interest in contributing to Agent Note! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Submitting Changes](#submitting-changes)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How to Contribute

### Types of Contributions

We welcome various types of contributions:

- **Bug Reports**: Help us identify and fix issues
- **Feature Requests**: Suggest new features or improvements
- **Code Contributions**: Bug fixes, new features, performance improvements
- **Documentation**: Improve or expand documentation
- **Testing**: Add or improve test coverage

### Before You Start

1. **Check existing issues**: Look for existing bug reports or feature requests
2. **Create an issue**: For new features or significant changes, create an issue first to discuss
3. **Fork the repository**: Create a personal fork to work on changes
4. **Create a branch**: Use descriptive branch names like `feature/session-export` or `fix/trailer-parsing`

## Development Setup

### Prerequisites

- **Node.js** >= 22.12.0 for repository development, docs, and Dashboard builds
- The published `agent-note` CLI package still supports Node.js >= 20
- **Git**
- **Claude Code** (for testing hooks integration)

### Initial Setup

```bash
# Clone your fork
git clone https://github.com/your-username/AgentNote.git
cd AgentNote

# Add upstream remote
git remote add upstream https://github.com/wasabeef/AgentNote.git

# Install CLI dependencies
cd packages/cli
npm install

# Build
npm run build

# Run tests
npm test

# Lint (Biome)
npm run lint

# Type check
npm run typecheck
```

### Useful Commands

All CLI commands run from `packages/cli/`:

```bash
cd packages/cli

# Run a specific command during development
npx tsx src/cli.ts help

# Run tests with coverage
npm run test:coverage

# Lint (Biome)
npm run lint

# Type check without emitting
npm run typecheck

# Build the bundle
npm run build

# Test the built CLI
node dist/cli.js version
```

## Project Structure

This is a monorepo with two packages:

```
packages/
├── cli/                           # agent-note — npm package
│   ├── src/
│   │   ├── cli.ts                 # Entry point and command routing
│   │   ├── git.ts                 # Git CLI wrapper (execFile-based, no libraries)
│   │   ├── paths.ts               # Path resolution for .git/agentnote/ and .claude/
│   │   ├── core/                  # Agent-agnostic logic
│   │   │   ├── entry.ts           # Build entry JSON, calc ai_ratio
│   │   │   ├── jsonl.ts           # JSONL read/append helpers
│   │   │   ├── record.ts          # Shared recordCommitEntry() for hook + commit
│   │   │   ├── rotate.ts          # Log rotation after commit
│   │   │   └── storage.ts         # Git notes read/write
│   │   ├── agents/                # One file per agent
│   │   │   ├── types.ts           # AgentAdapter interface
│   │   │   └── claude.ts          # Claude Code adapter
│   │   └── commands/              # User-facing, delegates to agents/ + core/
│   │       ├── init.ts
│   │       ├── hook.ts
│   │       ├── commit.ts
│   │       ├── session.ts
│   │       ├── show.ts
│   │       ├── log.ts
│   │       ├── pr.ts
│   │       └── status.ts
│   ├── package.json
│   └── tsconfig.json
│
└── action/                        # GitHub Action (Marketplace)
    ├── action.yml
    ├── src/index.ts
    ├── dist/index.js              # ncc-bundled (committed)
    └── package.json

action.yml                         # Root pointer → packages/pr-report/dist/index.js
```

### Key Design Decisions

- **Zero runtime dependencies for CLI**: Only devDependencies for build and test tooling
- **Git CLI only**: All git operations go through the `git` command, never through libraries
- **Claude Code hooks**: All data collection happens via Claude Code's hook system, never touching git hooks
- **Git notes for storage**: Entries stored as `refs/notes/agentnote`, not files. Pushable and shareable.
- **JSONL for append-heavy files**: Prompts and changes use JSONL for crash-safe append
- **Input validation**: Session IDs validated as UUID v4. Transcript paths restricted to `~/.claude/`.

### Data Flow

```
Claude Code hooks → agent-note hook (stdin JSON) → .git/agentnote/sessions/
git commit → PreToolUse injects --trailer → PostToolUse records entry to git notes
agent-note show/log → reads git notes --ref=agentnote
```

## Coding Standards

### General

- All source code, comments, and documentation must be in **English**
- Use `npm run lint` (`biome check`) for code style and formatting (run from `packages/cli/`)
- Use `npm run typecheck` (`tsc --noEmit`) to catch type errors (run from `packages/cli/`)
- Keep functions focused and short
- No runtime dependencies allowed for the CLI package

### TypeScript Style

- Use strict mode (enforced by tsconfig)
- Prefer `async/await` over raw promises
- Use explicit return types for exported functions
- Avoid `any` where possible; use it sparingly for JSON parsing

### Error Handling

- Never let agent-note errors break a git commit
- Use try/catch at command boundaries
- Return early for missing/invalid data instead of throwing

```typescript
// Good: graceful degradation
if (!existsSync(entryFile)) {
  console.log("entry: not found");
  return;
}

// Good: commit must succeed even if agent-note fails
try {
  await writeNote(commitSha, entry);
} catch (err: any) {
  console.error(`agent-note: warning: ${err.message}`);
}
```

### Commit Messages

Use conventional commit format:

```
type(scope): description
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`

Examples:

```
feat(hook): capture AI responses from transcript
fix(commit): handle missing session file gracefully
test(init): add legacy hook migration test
docs(readme): add example output section
```

## Testing Guidelines

### Running Tests

```bash
cd packages/cli

# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

### Test Structure

Tests live next to the source files they test:

```
packages/cli/src/
├── git.ts
├── git.test.ts               # Unit tests for git wrapper
└── commands/
    ├── init.ts
    ├── init.test.ts         # Integration tests for agent-note init
    ├── hook.ts
    └── hook.test.ts           # Tests for hook event handling
```

### Writing Tests

- Use `node:test` (built-in test runner) with `node:assert/strict`
- Each test creates its own temp git repo for isolation
- Clean up temp directories in `after()` hooks
- Test both success and failure paths
- Use UUID format for session IDs in tests (e.g., `a1b2c3d4-0001-0001-0001-000000000001`)

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";

describe("agent-note init", () => {
  let testDir: string;

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "agentnote-test-"));
    execSync("git init", { cwd: testDir });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("registers hooks in settings.json", () => {
    // test implementation
  });
});
```

### What to Test

- **Commands**: Each command gets integration tests that run the built CLI
- **Hook handling**: Test each event type with simulated JSON input
- **Edge cases**: Missing files, empty sessions, invalid JSON, non-UUID session IDs
- **Idempotency**: Running `init` twice should not duplicate hooks
- **Legacy support**: Upgrading from old hook format should work cleanly

## Submitting Changes

### Pull Request Process

1. Update your fork from upstream
2. Create a feature branch
3. Make your changes
4. Run the full check suite:
   ```bash
   cd packages/cli && npm run lint && npm run typecheck && npm run build && npm test
   ```
5. Push and create a pull request

### PR Checklist

- [ ] Code is in English (comments, docs, output)
- [ ] `npm run lint` passes with no errors (in `packages/cli/`)
- [ ] `npm run typecheck` passes with no errors (in `packages/cli/`)
- [ ] `npm test` passes with no failures (in `packages/cli/`)
- [ ] Tests added for new functionality
- [ ] No new runtime dependencies added to CLI
- [ ] Commit messages follow conventional format

### Review Process

- **Initial response**: Within a few days
- **Full review**: Within a week
- Address feedback in additional commits
- Once approved, maintainers will merge

## Getting Help

- **Issues**: For bug reports and feature requests
- **Discussions**: For questions and ideas
- **Pull Requests**: For code review discussions
