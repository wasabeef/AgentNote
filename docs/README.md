# Documentation Map

This directory is the maintainer-facing documentation for Agent Note. The public user guide lives in `website/`; this directory keeps implementation rules, architecture context, design notes, investigation history, and reusable assets close to the code.

## Start Here

- `engineering.md` — implementation guidelines for humans and AI coding agents.
- `architecture.md` — current system architecture and data flow.
- `knowledge/README.md` — focused design notes, investigation history, and archived research.

## Directory Layout

```text
docs/
├── README.md
├── engineering.md
├── architecture.md
├── assets/
└── knowledge/
    ├── README.md
    ├── prompt-context.md
    ├── prompt-selection.md
    ├── agent-skill.md
    ├── agent-support-policy.md
    ├── investigations.md
    ├── research/
    └── archive/
```

The published Agent Skill itself lives outside `docs/` at
`skills/agent-note/SKILL.md`; the rationale and maintenance notes live in
`knowledge/agent-skill.md`.

## Reading Order

1. For code changes, read `engineering.md` first.
2. For schema, storage, action, dashboard, or agent-adapter changes, read `architecture.md`.
3. For prompt rendering or prompt filtering changes, read the matching file under `knowledge/`.
4. For old decisions, regressions, and historical plans, use `knowledge/investigations.md` and `knowledge/archive/`.

## What Belongs Here

- Current implementation rules that should guide future code.
- Current architecture that must stay aligned with code.
- Design notes that explain non-obvious heuristics or storage decisions.
- Investigation history that helps prevent regressions.

## What Does Not Belong Here

- End-user onboarding. Put that in `website/` and the localized READMEs.
- Runtime instructions for a specific AI agent. Keep those in `AGENTS.md` / `CLAUDE.md`.
- Contributor workflow basics. Keep those in `CONTRIBUTING.md`.
- Temporary scratch notes. Move resolved material into `knowledge/investigations.md` or delete it.
