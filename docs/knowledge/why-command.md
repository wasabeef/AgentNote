# `agent-note why` Design Note

This note captures the design for the read-only `agent-note why` command and
the future schema direction for stronger line evidence.

## Goal

`agent-note why` should answer a question that `git blame` cannot answer:

> Which AI conversation explains this file or line?

The command should be honest about evidence strength. A line can belong to a
commit with Agent Note data even when Agent Note cannot prove that the line was
authored by AI.

## CLI Shape

Primary command:

```bash
agent-note why packages/cli/src/core/record.ts:291
agent-note why packages/cli/src/core/record.ts:291-310
agent-note why packages/cli/src/core/record.ts#L291
agent-note why packages/cli/src/core/record.ts#L291-L310
agent-note why packages/cli/src/core/record.ts#L291C5
agent-note why @packages/cli/src/core/record.ts#L291
agent-note why https://github.com/owner/repo/blob/main/packages/cli/src/core/record.ts#L291
agent-note why file:///workspace/repo/packages/cli/src/core/record.ts#L291
agent-note why vscode://file/workspace/repo/packages/cli/src/core/record.ts:291:5
```

Alias:

```bash
agent-note blame packages/cli/src/core/record.ts:291
```

Possible future options:

```bash
agent-note why path:line --full
agent-note why path:line --json
agent-note why path:line --no-response
```

## Output Model

Default output should prioritize the reason a user came for:

1. target file / line
2. blame commit
3. evidence level
4. prompt and context
5. response excerpt

The first version should use the current schema and stay conservative. It should
shorten the manual workflow:

```text
target line
  -> git blame
  -> blame commit
  -> git notes --ref=agentnote show <commit>
  -> related Agent Note interactions / files / files_touched
```

That alone is useful. Users no longer need to run `git blame`, inspect the git
note JSON, and manually connect prompts to files.

Representative output with the current schema:

```text
target: packages/cli/src/core/record.ts:291

blame:
  commit: 06cae8a refactor(repo): split pr report and dashboard logic
  author: wasabeef
  date:   2026-05-04

agent note:
  agent:       codex
  model:       gpt-5.4
  ai ratio:    82% [███████░]
  attribution: file

related prompts:
  1. evidence: file
     context: Based on the package split plan, separate PR Report and Dashboard responsibilities.
     prompt:  Yes, please proceed with that structure.
     response: Got it. I will proceed with that approach, starting by extracting the Dashboard into an independent package...
     file:    packages/cli/src/core/record.ts

why:
  evidence: file-level Agent Note data
  note:     exact line-to-prompt attribution is not stored yet
```

## Evidence Levels

`why` should never overstate certainty.

| Level | Meaning |
|---|---|
| `line` | Agent Note has line-range evidence for the target line. |
| `file` | The blame commit touched the target file and the note has file-level prompt evidence. |
| `commit` | The blame commit has Agent Note data, but the prompt cannot be strongly tied to the target file. |
| `none` | No Agent Note data exists for the blame commit. |

## Current Schema Limit

The current git note schema can support `commit` and `file` evidence without
changes:

- `git blame` finds the commit for `path:line`.
- `refs/notes/agentnote` stores the commit's prompts, responses, contexts, and
  `interactions[].files_touched`.
- If the target file is in `files_touched`, `why` can show file-level evidence.

The current schema cannot precisely answer "which prompt wrote this exact
line" because it does not persist final-file line ranges or line-to-interaction
links. Aggregate fields such as `attribution.lines` and
`interactions[].line_stats` store counts, not positions.

The MVP should therefore avoid claiming:

- this exact line was written by AI
- this exact line was written by a specific prompt
- this final-file line range came from a specific interaction

Even when `attribution.method` is `line`, current notes only store aggregate
line counts. The command can say line-level attribution was available for the
commit, but not that the target line itself was AI-authored.

## Implemented MVP

The first version is implemented without changing the note schema.

Rationale:

- It is read-only: no recording, hook, attribution, PR Report, Dashboard, or
  git note schema behavior changes.
- It has low regression risk for existing features.
- It already removes a painful manual workflow.
- It gives us real user feedback before adding persisted line-range data.

Current behavior:

1. Parse `path:line`, `path:start-end`, `path:line:column`, GitHub-style
   `path#Lline`, `path#Lstart-Lend`, `path#LlineCcol`, GitHub file URLs,
   `file://` URLs, `vscode:` file URLs, and leading `@` path mentions copied
   from AI Agent output.
2. Run `git blame --porcelain` for the target line or range.
3. Read the blame commit's Agent Note.
4. Prefer interactions whose `files_touched` contains the target path.
5. Fall back to the commit's visible prompts when no file-specific interaction
   exists.
6. Print `evidence: file`, `evidence: commit`, or `evidence: none`.
7. Mention that exact line-to-prompt attribution is not stored yet.

This keeps the first implementation honest and safe.

## Recommended Schema Direction Before Public Stability

Do not start here. This section is a future direction only.

Because Agent Note is still pre-1.0, it is acceptable to change the note schema
before public stability if real `why` usage proves that first-class `line`
evidence is worth the extra risk.

Recommended direction:

```ts
type AgentnoteEntry = {
  v: 2;
  interactions: Interaction[];
  files: FileEntry[];
  attribution: Attribution; // commit-level summary remains
};

type Interaction = {
  id: string;
  prompt: string;
  response: string | null;
  contexts?: InteractionContext[];
  files_touched?: string[];
};

type FileEntry = {
  path: string;
  by_ai: boolean;
  generated?: boolean;
  ai_ratio_excluded?: boolean;
  attribution?: {
    method: "line" | "file" | "none";
    lines?: {
      ai_added: number;
      total_added: number;
      deleted: number;
    };
    ranges?: FileAttributionRange[];
  };
};

type FileAttributionRange = {
  start: number;
  end: number;
  source: "ai" | "human" | "unknown";
  interaction_id?: string;
};
```

Design notes:

- Keep `attribution` at the commit level as the PR Report / Dashboard summary.
- Add file-level attribution detail under `files[].attribution`.
- Use stable `interactions[].id` instead of array indexes so render-time
  filtering or ordering changes do not break range references.
- Keep `ranges` optional. Agents that cannot prove line positions should omit
  it and fall back to `file` evidence.

## Agent Coverage

| Agent | Expected `why` support |
|---|---|
| Claude Code | `file` / `commit` in the MVP; best future candidate for `line` evidence because pre/post edit blobs are captured by hooks. |
| Codex CLI | `file` / `commit` in the MVP; possible future `line` evidence only when transcript patch data aligns with the final commit diff. |
| Cursor | `file` / `commit` in the MVP; possible future `line` evidence when edit counts and final file state match. |
| Gemini CLI | `file` / `commit` in the MVP. |

## Follow-up Order

1. Add `--json` for Dashboard and external tooling.
2. Use real project history to review whether the output is useful enough.
3. Decide whether to move to `v: 2` before public stability.
4. If `v: 2` is adopted, persist `files[].attribution.ranges` only when the
   agent has strong line-position evidence.
