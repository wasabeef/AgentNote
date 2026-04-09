# Output Format Samples (Improved)

> Temporary file for reviewing output formats. Delete after review.

---

## Format: `chat` (default)

レビュアーが「このコミットでなぜこの変更をしたか」を理解するための会話形式。

---

## 🤖 Agent Note

**AI ratio: 73%** · 45/75 lines · 4/5 commits tracked · 8 prompts · claude-sonnet-4-20250514

<details>
<summary><code>ce941f7</code> feat: add JWT auth middleware — 73% (45/75 lines) · 3 files</summary>

**🧑 Prompt**
> Implement JWT auth middleware with refresh token rotation

**🤖 Response**
> I'll create the middleware with token verification and automatic rotation. The implementation uses RS256 for signing...

**🧑 Prompt**
> Add error handling for malformed tokens

**🤖 Response**
> I'll add try-catch blocks around the token parsing...

| File | Attribution |
|---|---|
| `src/middleware/auth.ts` | 🤖 AI |
| `src/types/token.ts` | 🤖 AI |
| `CHANGELOG.md` | 👤 Human |

</details>

<details>
<summary><code>326a568</code> test: add auth edge case tests — 100% (32/32 lines) · 1 file</summary>

**🧑 Prompt**
> Add tests for expired token and invalid signature

**🤖 Response**
> Here are the test cases covering the edge cases...

| File | Attribution |
|---|---|
| `src/middleware/__tests__/auth.test.ts` | 🤖 AI |

</details>

<details>
<summary><code>ba091be</code> fix: update dependencies — no tracking data</summary>

*No agentnote data for this commit.*

</details>

<details>
<summary><code>f12ab34</code> docs: update README — 100% (18/18 lines) · 1 file</summary>

**🧑 Prompt**
> Update the README with the new auth middleware usage

**🤖 Response**
> I'll add a section documenting the JWT middleware configuration...

| File | Attribution |
|---|---|
| `README.md` | 🤖 AI |

</details>

---

## Format: `table`

大量コミットの PR 向け。概要を素早く把握。

---

## 🤖 Agent Note

**AI ratio: 73%** · 45/75 lines · 4/5 commits tracked · 8 prompts · claude-sonnet-4-20250514

| Commit | AI Ratio | Lines | Prompts | Files |
|---|---|---|---|---|
| `ce941f7` feat: add JWT auth middleware | 73% | 45/75 | 2 | auth.ts 🤖 token.ts 🤖 CHANGELOG.md 👤 |
| `326a568` test: add auth edge case tests | 100% | 32/32 | 1 | auth.test.ts 🤖 |
| `ba091be` fix: update dependencies | — | — | — | — |
| `f12ab34` docs: update README | 100% | 18/18 | 1 | README.md 🤖 |

<details>
<summary>💬 Prompts & Responses (8 total)</summary>

### `ce941f7` feat: add JWT auth middleware

> **Prompt:** Implement JWT auth middleware with refresh token rotation
>
> **Response:** I'll create the middleware with token verification and automatic rotation...

> **Prompt:** Add error handling for malformed tokens
>
> **Response:** I'll add try-catch blocks around the token parsing...

### `326a568` test: add auth edge case tests

> **Prompt:** Add tests for expired token and invalid signature
>
> **Response:** Here are the test cases covering the edge cases...

### `f12ab34` docs: update README

> **Prompt:** Update the README with the new auth middleware usage
>
> **Response:** I'll add a section documenting the JWT middleware configuration...

</details>

---

## Improvements from Current

### 1. Unified header

Before:
```
## 🤖 Agent Note — Session Transcript
**Overall AI ratio: 73%** (4/5 commits tracked, 8 prompts)
```

After:
```
## 🤖 Agent Note
**AI ratio: 73%** · 45/75 lines · 4/5 commits tracked · 8 prompts · claude-sonnet-4-20250514
```

Changes:
- Remove "Session Transcript" / "AI Session Report" subtitle — redundant
- Add line counts to header
- Add model name
- Dot-separated for scannability
- Remove "Overall" — just "AI ratio"

### 2. Commit summary line

Before:
```
<code>ce941f7</code> feat: add JWT auth middleware — AI 73% ████░ · 3 files (2 🤖 1 👤)
```

After:
```
<code>ce941f7</code> feat: add JWT auth middleware — 73% (45/75 lines) · 3 files
```

Changes:
- Remove "AI" prefix — context is obvious
- Add line counts
- Remove emoji counts in summary (detail is inside)
- Remove bar chart from summary (cleaner)

### 3. File table inside details

Before:
```
**Files:**
- `src/auth.ts` 🤖
- `CHANGELOG.md` 👤
```

After:
```
| File | Attribution |
|---|---|
| `src/middleware/auth.ts` | 🤖 AI |
| `CHANGELOG.md` | 👤 Human |
```

Changes:
- Table format — cleaner, more structured
- Full path (not just basename)
- Explicit "AI" / "Human" label next to emoji

### 4. Table format: add Lines column

Before:
```
| Commit | AI | Prompts | Files |
```

After:
```
| Commit | AI Ratio | Lines | Prompts | Files |
```

### 5. Prompt display

Before: Full prompt text (including skill expansions like `/commit` → 500 lines of markdown)

After: First meaningful line only (truncated at 120 chars). Skill-generated prompts (`## Commit`, `## Plan`) are filtered or condensed to the user's original input.

### 6. No suppression messaging

Removed: "High AI ratio — consider extra review"
AI ratio is informational context, not a quality gate.

## PR Description vs Comment

### Description mode (default)

Inserted between `<!-- agentnote-begin -->` and `<!-- agentnote-end -->` markers in the PR body. Benefits:
- Always visible without scrolling
- Survives comment deletions
- Part of the PR record

### Comment mode

Posted as a separate PR comment with `<!-- agentnote-pr-report -->` marker. Benefits:
- Doesn't modify PR description
- Can be collapsed/hidden
- Timestamped separately
