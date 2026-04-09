# Output Improvement Plan

## Goal

1. Project-level config file (`agentnote.yml`) for output customization
2. Improved PR report format (header, file tables, prompt filtering, model display)
3. Default output to PR description (not comment)

## Config File

### Schema

```yaml
# agentnote.yml
pr:
  output: description    # description | comment (default: description)
  format: chat           # chat | table (default: chat)
```

### Location

`agentnote.yml` at repo root. Fallback: `.agentnote.yml`. First match wins.

### Separation of concerns

| File | Purpose |
|---|---|
| `.claude/settings.json` | Hook config (data collection) — read by Claude Code |
| `agentnote.yml` | Output config (display, PR) — read by CLI + Action |

## Output Format Improvements

### Header

```
## 🤖 Agent Note
**AI ratio: 73%** · 45/75 lines · 4/5 commits tracked · 8 prompts · claude-sonnet-4-20250514
```

- Remove "Session Transcript" / "AI Session Report" subtitle
- Dot-separated metadata for scannability
- Include line counts, model name
- "AI ratio" not "Overall AI ratio"

### Commit summary (details tag)

```
<code>ce941f7</code> feat: add JWT auth middleware — 73% (45/75 lines) · 3 files
```

- Remove bar chart from summary line (cleaner)
- Remove emoji counts (detail is inside)
- Add line counts

### File display

Before (bullet list):
```
- `src/auth.ts` 🤖
- `CHANGELOG.md` 👤
```

After (table):
```
| File | Attribution |
|---|---|
| `src/middleware/auth.ts` | 🤖 AI |
| `CHANGELOG.md` | 👤 Human |
```

### Table format: Lines column

```
| Commit | AI Ratio | Lines | Prompts | Files |
```

### Prompt filtering

- Truncate to first meaningful line (120 chars)
- Filter skill-generated expansions (prompts starting with `## Commit`, `## Plan`, etc.) — show the user's original input only
- Response truncation: 800 chars (chat), 500 chars (table)

### Model in header

Show model from note's `model` field. Omit if null.

## Implementation

### Config loader (`core/config.ts`)

```typescript
interface AgentnoteConfig {
  pr: {
    output: "comment" | "description";
    format: "chat" | "table";
  };
}

const DEFAULTS: AgentnoteConfig = {
  pr: { output: "description", format: "chat" },
};
```

- Find `agentnote.yml` / `.agentnote.yml`
- Parse YAML (bundled `yaml` as devDep, included in esbuild bundle)
- Merge with defaults
- CLI flags override config

### Rendering changes (`commands/pr.ts`)

1. **New header format** — dot-separated, includes lines + model
2. **Chat format** — file table inside details, no bar chart in summary
3. **Table format** — add Lines column
4. **Prompt filtering** — strip skill expansions, truncate
5. **Output routing** — description (upsert via markers) or comment (existing)

### Action changes

- Read `agentnote.yml` from repo root
- New inputs: `output`, `format` (override config)
- Default output: `description` (currently `comment`)
- Backward compatible: `comment: "true"` still works

## Task Breakdown

```
#A config.ts (loader + types)
 ├→ #B pr.ts rendering improvements
 ├→ #C pr.ts output routing (description/comment)
 ├→ #D action (config + new inputs)
 └→ #E tests + docs
```

### #A: Config loader

**Files**: `core/config.ts` (new)
**Effort**: S

- `AgentnoteConfig` interface + defaults
- `loadConfig(repoRoot)`: find yml, parse, merge defaults
- Add `yaml` devDependency

### #B: PR rendering improvements

**Files**: `commands/pr.ts`
**Effort**: M

- New header format (dot-separated, model, lines)
- Chat format: file table, cleaner summary line
- Table format: add Lines column
- Prompt filtering (skill expansion detection, truncation)
- Both `renderMarkdown()` and `renderChat()` updated

### #C: PR output routing

**Files**: `commands/pr.ts`
**Effort**: S

- Load config → `pr.output`
- `--output` CLI flag override
- Route to `upsertInDescription()` (description) or comment (existing)

### #D: Action integration

**Files**: `packages/action/src/index.ts`, `action.yml`
**Effort**: M

- Read `agentnote.yml` from checkout root
- New inputs: `output`, `format`
- Default `output: description`
- Route report accordingly
- Rebuild with ncc

### #E: Tests + docs

**Files**: `config.test.ts`, `pr.test.ts`, `README.md`
**Effort**: S

- Config loading tests
- Prompt filtering tests
- README: add agentnote.yml section
