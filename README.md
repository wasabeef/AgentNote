# Agentnote

[![CI](https://img.shields.io/github/actions/workflow/status/wasabeef/agentnote/ci.yml?branch=main)](https://github.com/wasabeef/agentnote/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/@wasabeef/agentnote)](https://www.npmjs.com/package/@wasabeef/agentnote)

Remember why your code changed. Link Claude Code sessions to git commits.

## What It Does

Every time you use Claude Code to write code, agentnote captures:

- **Every prompt** you gave to Claude
- **Every AI response** Claude returned
- **Which files** were written by AI vs. human
- **AI authorship ratio** per commit

All of this is stored as [git notes](https://git-scm.com/docs/git-notes) and linked to your commits via a `Agentnote-Session` trailer, so you can always trace back to why a change was made.

## Quick Start

```bash
# Enable agentnote for your repo (commit .claude/settings.json to share with team)
npx @wasabeef/agentnote enable

# Just use git commit as normal — agentnote hooks handle everything automatically
git commit -m "feat: add auth middleware"

# See what happened
npx @wasabeef/agentnote show
```

## Installation

### npx (zero install)

```bash
npx @wasabeef/agentnote enable
```

### As a dev dependency (recommended for teams)

```bash
npm install --save-dev @wasabeef/agentnote
```

```jsonc
// package.json
{
  "scripts": {
    "agentnote": "agentnote"
  }
}
```

## Commands

| Command | Description |
| --- | --- |
| `agentnote enable` | Add hooks to `.claude/settings.json` (commit to share with team) |
| `agentnote disable` | Remove hooks from `.claude/settings.json` |
| `agentnote commit [args]` | git commit with session context (convenience, optional) |
| `agentnote show [commit]` | Show session details for a commit |
| `agentnote log [n]` | List recent commits with session info |
| `agentnote status` | Show current tracking state |

## Example Output

### `agentnote show`

```
commit:  ce941f7 feat: add JWT auth middleware
session: a1b2c3d4-5678-90ab-cdef-111122223333

ai:      60% [████████████░░░░░░░░]
files:   5 changed, 3 by AI

  CHANGELOG.md  👤
  src/middleware/auth.ts  🤖
  src/types/token.ts  🤖
  src/middleware/__tests__/auth.test.ts  🤖
  README.md  👤

prompts: 2

  1. Implement JWT auth middleware with refresh token rotation
     → I'll create the middleware with token verification and rotation...

  2. Add tests for expired token and invalid signature
     → Here are the test cases covering the edge cases...
```

### `agentnote log`

```
ce941f7 feat: add JWT auth middleware  [a1b2c3d4… | 🤖60% | 2p]
326a568 test: add auth tests          [a1b2c3d4… | 🤖100% | 1p]
ba091be fix: update dependencies
```

### `agentnote commit`

```
[main ce941f7] feat: add JWT auth middleware
 5 files changed, 42 insertions(+)
agentnote: 2 prompts, AI ratio 60%
```

## How It Works

1. `agentnote enable` registers Claude Code [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) in `.claude/settings.json` — commit this to share with your team
2. As you work, hooks automatically record prompts, AI responses, and file changes
3. When `git commit` runs (via Claude Code or `agentnote commit`), a `Agentnote-Session` trailer is injected and a structured entry is saved as a [git note](https://git-scm.com/docs/git-notes)
4. `agentnote show` reads the git note and displays the full context behind a commit

Session data is stored as git notes (`refs/notes/agentnote`). Nothing is sent to external services. No telemetry.

### Team sharing

```bash
# Push session data to remote
git push origin refs/notes/agentnote

# Fetch session data from team
git fetch origin refs/notes/agentnote:refs/notes/agentnote
```

## Requirements

- Node.js >= 20
- Git
- Claude Code

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT - see [LICENSE](LICENSE)
