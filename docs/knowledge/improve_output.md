# Output Improvement Plan

## Goal

Project-level configuration file (`agentnote.yml`) for customizing PR report output. Committed to repo, shared with team.

## Config File

### Location

**`agentnote.yml`** at repo root. Lookup: `agentnote.yml` → `.agentnote.yml`. First match wins.

### Separation of concerns

| File | Purpose | Who reads |
|---|---|---|
| `.claude/settings.json` | Hook configuration (data collection) | Claude Code runtime |
| `agentnote.yml` | Output configuration (PR report) | CLI + Action |

### Schema

```yaml
# agentnote.yml
pr:
  output: description    # description | comment (default: comment)
  format: chat           # chat | table (default: chat)
```

That's it. Two settings.

### Defaults (no config file)

```yaml
pr:
  output: comment
  format: chat
```

Current behavior. No config file needed to keep existing behavior.

## Features

### `pr.output` — Report destination

| Value | Behavior |
|---|---|
| `comment` | Post/update PR comment (current default, idempotent via `<!-- agentnote-pr-report -->` marker) |
| `description` | Upsert into PR description body (between `<!-- agentnote-begin/end -->` markers, already implemented in `pr.ts`) |

CLI: `agentnote pr --output description --update 42`
Action: reads config. `with.output` input overrides.

### `pr.format` — Report format

| Value | Description |
|---|---|
| `chat` | Collapsible prompt/response per commit (current default) |
| `table` | Summary table with AI%, prompts, files |

CLI: `agentnote pr --format chat|table`
Action: reads config. `with.format` input overrides.

## Config Loading

### Implementation

```typescript
// packages/cli/src/core/config.ts (new file)

interface AgentnoteConfig {
  pr: {
    output: "comment" | "description";
    format: "chat" | "table";
  };
}

const DEFAULTS: AgentnoteConfig = {
  pr: { output: "comment", format: "chat" },
};

async function loadConfig(repoRoot: string): Promise<AgentnoteConfig>
```

### YAML parsing

Zero runtime dependencies constraint. Options:
1. **Bundled `yaml` package** — added as devDependency, bundled by esbuild into dist. No runtime dep in distributed package.
2. **Support only JSON** (`agentnote.json`) — no parser needed but less ergonomic.
3. **Minimal hand-rolled parser** — our schema is 2 flat keys, trivially parseable.

**Recommendation**: Option 1 (bundled yaml). Schema may grow later. Proper YAML support avoids future migration.

## GitHub Action Changes

### New inputs

```yaml
inputs:
  base:
    description: "Base branch"
    default: ""
  comment:
    description: "Post as PR comment (legacy)"
    default: "true"
  output:
    description: "Report destination: comment or description"
    default: ""
  format:
    description: "Report format: chat or table"
    default: ""
```

### Precedence

1. Action `with:` inputs (highest)
2. `agentnote.yml` config
3. Defaults (lowest)

### Backward compatibility

- `comment: "true"` (existing) → `output: comment`
- `comment: "false"` → no report posted
- New `output` input overrides `comment` if specified

## Task Dependency Graph

```
#A config.ts (loader + types + defaults)
 ├→ #B pr.ts (read config, apply output/format)
 ├→ #C action (read config, new inputs)
 └→ #D tests + docs
```

## Task Breakdown

### #A: Config loader

**Files**: `core/config.ts` (new)
**Effort**: S

- `AgentnoteConfig` interface
- `loadConfig(repoRoot)`: find yml/json, parse, merge defaults
- Add `yaml` devDependency (bundled by esbuild)

### #B: PR command integration

**Files**: `commands/pr.ts`
**Effort**: M

- Load config at start of `pr()`
- `--output` flag → route to description or comment
- `--format` flag → select renderer
- Config values as defaults, CLI flags override

### #C: GitHub Action

**Files**: `packages/action/src/index.ts`, `action.yml`
**Effort**: M

- Read `agentnote.yml` from repo root
- New inputs: `output`, `format`
- Route report to description/comment based on config + inputs
- Backward compatible `comment` input

### #D: Tests + docs

**Files**: `core/config.test.ts`, `README.md`, `DESIGN.md`
**Effort**: S

- Config loading tests (file lookup, parse, defaults)
- README: add agentnote.yml section
- DESIGN.md: config file documentation
