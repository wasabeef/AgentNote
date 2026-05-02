# Agent Note vs Entire

> Public comparison note. Updated from publicly available documentation checked on 2026-04-12.

This page is intentionally narrow. It compares documented product shape and workflow, not undocumented internals or subjective quality claims.

## Summary

Agent Note is a lightweight, Git-native tool focused on attaching AI session context to commits. It can optionally publish a static GitHub Pages dashboard backed by `git notes`, but it still does not center checkpoints or rewind / resume flows. Entire presents a broader checkpoint platform with dedicated checkpoint branches, rewind / resume workflows, and a hosted web application.

## Comparison Table

| Area | Agent Note | Entire |
| --- | --- | --- |
| Primary goal | Link commits to AI session context | Capture sessions as checkpoints with rewind / resume workflows |
| Git storage model | `git notes` plus local temp state under `.git/agentnote/` | `Entire-Checkpoint` trailers, local shadow branches, permanent metadata on `entire/checkpoints/v1` |
| Default commit flow | Repo-local git hooks keep normal `git commit` working | `entire enable` installs git hooks; checkpoints link to commits automatically |
| Web product | Optional static GitHub Pages dashboard backed by `git notes` | Hosted web application for repositories, checkpoints, and sessions |
| Resume / rewind UX | Not a core feature today | First-class CLI features (`resume`, `rewind`) |
| Current agents in public docs | Claude Code, Codex CLI, Cursor preview | Claude Code, Gemini CLI, OpenCode, Factory Droid |
| Cursor status | Preview; plain `git commit` works with generated git hooks, attribution comes from Cursor hooks / transcripts when available | Cursor is not listed in Entire quickstart docs checked for this note |

## Where Agent Note Is Strong

- Smaller Git footprint. Agent Note stores permanent data in `git notes` instead of introducing checkpoint branches.
- Local-first workflow. The CLI and stored metadata are usable without any hosted web surface, and the optional dashboard can be published from static files.
- Conservative Cursor design. Cursor support stays on documented hook / transcript paths and keeps git hooks as the primary commit integration path.
- Simple operator view. `agent-note status` shows active agent adapters, capture paths, git hook state, and commit tracking mode in one place.

## Where Entire Is Strong

- Broader product scope. Entire documents checkpoints, shadow branches, rewind, resume, doctor, and reset flows.
- Hosted browsing experience. Entire provides repository, checkpoint, and session views in the web application with product-managed state instead of a repo-owned static deploy.
- Richer checkpoint model. Entire documents token usage, nested sessions, and checkpoint metadata as first-class concepts.

## What We Should Not Claim

- Do not describe Entire as "over-engineered", "too much", or similar value judgments.
- Do not claim implementation details that are not stated in Entire's public docs.
- Do not present forum bug reports as permanent product behavior.
- Do not claim Agent Note is "better" in general. Keep comparisons tied to explicit tradeoffs such as Git footprint, scope, and workflow shape.

## Public Sources

- Entire Quickstart: https://docs.entire.io/quickstart
- Entire Core Concepts: https://docs.entire.io/core-concepts
- Entire CLI Commands: https://docs.entire.io/cli/commands
- Entire Web Overview: https://docs.entire.io/web/overview
- Entire Web Checkpoints: https://docs.entire.io/web/checkpoints
- Agent Note local docs: `README.md`, `docs/architecture.md`
