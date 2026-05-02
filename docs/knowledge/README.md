# Knowledge Base

This directory stores focused knowledge for Agent Note maintainers and AI coding agents. Keep the root of this directory limited to current design references. Historical plans live in `archive/`.

## Current References

- `../architecture.md` — canonical architecture reference.
- `prompt-context.md` — how `📝 Context` is selected and rendered.
- `prompt-selection.md` — how prompt evidence is stored, scored at render time, and filtered by `prompt_detail`.
- `agent-support-policy.md` — support-tier gates for non-Claude adapters.
- `investigations.md` — resolved investigations and regression notes.

## Research

- `research/agentnote-vs-entire.md` — comparison notes that explain product and architecture tradeoffs.

## Archive

- `archive/codex-support-plan.md`
- `archive/cursor-support-plan.md`
- `archive/gemini-support-plan.md`
- `archive/early-problem-framing.md`
- `archive/early-research.md`

Archived files are preserved for context. Do not treat them as current behavior unless a current reference links to a specific section and says it is still valid.

## Update Rules

- If code behavior changes, update the current reference first.
- If a bug investigation is resolved, add the outcome to `investigations.md`.
- If a plan becomes historical, move it to `archive/` rather than leaving it beside active design notes.
- Keep filenames short, lowercase, and purpose-oriented.
