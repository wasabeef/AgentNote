---
title: "Introducing Agent Note: saving the why behind AI-assisted code in Git"
description: "Why AI-assisted code needs commit-level context, and how Agent Note uses Git notes and Pull Request reports to preserve it."
date: "2026-05-11"
tags: ["Agent Note", "AI", "Git", "Code Review", "Open Source"]
image: "https://raw.githubusercontent.com/wasabeef/AgentNote/main/docs/assets/hero.png"
---

Hi, I'm wasabeef.

I have been using coding agents such as Claude Code, Codex CLI, Cursor, and Gemini CLI regularly in daily development.

They no longer feel like experiments. They can already produce reviewable Pull Requests. But while reviewing AI-assisted changes, I kept running into the same problem.

**A diff tells you what changed. It does not tell you why it changed.**

That is already a problem with human-written commits when the commit message is weak. With AI-assisted commits, the missing context is even larger: the prompt, the response, the discussion that led to the implementation, the agent that touched each file, and the reason a particular path was chosen.

That is why I built [Agent Note](https://github.com/wasabeef/AgentNote).

![Agent Note — AI conversations saved to Git](https://raw.githubusercontent.com/wasabeef/AgentNote/main/docs/assets/hero.png)

This article focuses less on the exact usage and more on why this kind of record is needed, and how Agent Note keeps that context in Git.

## What is missing in AI-era code review

AI coding agents have become common in everyday development.

They write code quickly. They add tests. They update documentation. They can even open Pull Requests.

But review exposes a different problem.

The final diff does not show the background of the implementation.

- What request started the change?
- What assumptions did the AI make?
- Did the direction change halfway through?
- Is this a generated bundle, or source code someone intentionally edited?
- Which commits were mostly AI-assisted, and which were mostly human follow-up?

In human-to-human development, commit messages, Pull Request descriptions, and review comments have carried that context.

In AI-assisted development, prompts and responses also belong in the review context. Without them, reviewers lose the trail before review even starts.

Until now, the conversation with the AI often stayed inside the agent UI or a local transcript. Once the session ended, the team usually received only the commit and the Pull Request.

The reason behind the change disappears.

## AI review tools need context too

I also use AI review tools such as Copilot, CodeRabbit, Devin, and Greptile.

Their main inputs are usually the diff and the repository code.

That means AI can review AI-written code without seeing the prompt or intent that produced it.

When that happens, the review tends to stay near the surface of the diff.

To judge whether an implementation matches the intended change, a reviewer needs more than the final code. The reviewer needs to know what the author asked for, what the agent understood, and which parts of the repository were supposed to change.

Agent Note keeps that context in the Pull Request in a form AI review tools can read.

It renders a human-readable summary in the Pull Request body, and also embeds an `agentnote-reviewer-context` hidden comment. It is invisible in the rendered PR body, but AI review tools that read the raw Pull Request description can use it to understand changed areas, review focus, and author intent.

The reviewer gets more than the diff.

### Today

```text
git diff
Pull Request description

Prompt?       missing
Response?     missing
Why this way? reviewers have to infer it
```

### With Agent Note

```text
git diff
Pull Request description
refs/notes/agentnote
Dashboard

Prompt / Response / Context / AI Ratio stay connected to the commit
```

## What gets recorded

Agent Note saves the AI conversation and changed files for each commit.

Think of it as `git log` with the AI conversation behind the change attached to it.

It records four kinds of information.

| Data | What it helps you see |
|---|---|
| Prompt / Response | What was requested and how the AI answered |
| Files | Which files the agent touched |
| AI Ratio | A practical estimate of how much of the commit involved AI |
| Context | Extra context when the prompt alone is too short |

For example, a prompt like `yes, implement it` does not carry enough meaning when it appears alone in a Pull Request.

Agent Note does not try to inflate that prompt. Instead, when the surrounding commit evidence helps, it can attach a short `Context` note.

![Context shown in the Agent Note Dashboard](https://raw.githubusercontent.com/wasabeef/AgentNote/main/website/public/images/context-dashboard-example.png)

The point is not to say "this code is correct because AI wrote it" or "this code is risky because AI wrote it."

The point is to give reviewers better evidence.

## How it works

Agent Note is not a hosted service.

It adds a thin recording layer next to the normal Git workflow.

```text
You prompt your coding agent
        │
        ▼
Agent hooks save the conversation and session info
        │
        ▼
The agent edits files
        │
        ▼
Hooks or local transcripts record changed files
        │
        ▼
You run `git commit`
        │
        ▼
A Git hook links the session to the commit
        │
        ▼
Agent Note writes a Git note for that commit
        │
        ▼
`refs/notes/agentnote` is shared on `git push`
```

Temporary session data lives under `.git/agentnote/`.

The permanent record lives in `refs/notes/agentnote`.

Agent Note does not modify the commit diff or pollute the commit message. When you need the AI context behind a commit, you read the Git note.

## Why Git notes

The design constraint I cared about most was avoiding unnecessary workflow changes.

I did not want to replace `git commit`, and I did not want the core record to depend on a hosted service.

The context behind AI-assisted code should be a team asset, just like the commit itself. Keeping that context in Git felt natural.

Git notes let Agent Note attach structured data to a commit without changing the regular commit history.

That balance felt right.

- Use normal `git log` and Pull Requests most of the time
- Read Agent Note data only when you need the deeper context
- Share it with the team through `refs/notes/agentnote`
- Avoid requiring a hosted service

The design keeps AI development context close to Git instead of sending it somewhere else.

## How it fits with Spec-Driven Development

Spec-Driven Development makes the intent explicit before implementation.

That works well with AI coding agents. If the input is vague, the agent may still produce code quickly, but reviewers later have to guess why the implementation took that shape.

A spec alone does not preserve the implementation conversation. It does not show how the agent interpreted the task, what changed during the session, or which prompts ended up in each commit.

If the spec is the intent before implementation, Agent Note is the execution record after implementation.

Together, they let reviewers compare the implementation against the spec, and also inspect the AI conversation that produced the commit.

## How it relates to Entire

Agent Note is not the only project working on this problem.

[Entire](https://docs.entire.io/overview) also connects the context behind AI-assisted code changes to Git. Entire records prompts, transcripts, tool calls, changed files, and other session data as Checkpoints linked to commits. It is a broader system for agent development history, including rewind, resume, search, and a web UI.

Agent Note is intentionally narrower.

It focuses on commits and Pull Request review. The persistent record lives in Git notes under `refs/notes/agentnote`, and the main surfaces are the PR Report, Dashboard, hidden reviewer context for AI review tools, and `agent-note why`.

I do not see this as a matter of which approach is correct. The scope is different.

If you want full session Checkpoints, rewind, resume, and repository-wide search, a system like Entire makes sense. If you mainly want lightweight commit-level review context in Pull Requests, Agent Note is designed for that narrower workflow.

## PR Report and Dashboard

In Pull Requests, Agent Note renders a human-readable summary.

```md
## Agent Note

Total AI Ratio: ████████ 73%
Model: `claude-sonnet-4-20250514`

| Commit | AI Ratio | Prompts | Files |
|---|---|---|---|
| ce941f7 feat: add auth | ████░ 73% | 2 | auth.ts, token.ts |

Open Dashboard ↗
```

The PR Report is the entry point for review.

The Dashboard is for deeper reading.

In the Dashboard, you can inspect Prompt / Response, changed files, AI Ratio, and diffs by PR and by commit.

![Agent Note Dashboard preview](https://raw.githubusercontent.com/wasabeef/AgentNote/main/docs/assets/dashboard-preview.png)

The report answers "what should I look at first?" The Dashboard answers "what happened in this commit?"

## The idea behind `agent-note why`

Agent Note also includes `agent-note why`.

It starts from a target line, uses `git blame` to find the commit, then reads the Agent Note attached to that commit.

```bash
npx agent-note why README.md:111
```

It does not claim exact line-to-prompt attribution yet.

But even without a new schema, connecting an individual line to the commit conversation is useful. It shortens the path from "why is this line here?" to "what did we ask the agent to do in that commit?"

Eventually, I want to get closer to line-level explanations. The MVP is intentionally smaller: connect existing Git blame data with existing Git note data and make the available context easy to reach.

## Different agents expose different context

Agent Note supports multiple coding agents, but each agent exposes a different level of detail.

That is because every agent exposes hooks and transcripts differently.

Claude Code provides the richest signal today. Codex CLI, Cursor, and Gemini CLI are also supported, but Agent Note records only the prompt, response, changed files, and AI Ratio evidence that each agent can expose reliably.

I also do not want to overstate the evidence.

If Agent Note cannot know something reliably, it does not pretend to know it. AI Ratio is an estimate, not proof.

The latest support matrix is available in [Agent Support](https://wasabeef.github.io/AgentNote/agent-support/).

## Things to keep in mind

Agent Note records conversations with AI for the team.

That record should be handled carefully.

- Do not put secrets in prompts or responses
- When Git notes are pushed, the team can read the saved conversation
- AI Ratio is an estimate, not an automatic judgment of quality or responsibility
- Different agents expose different levels of detail
- Gemini CLI support is still Preview

Agent Note is closer to review context than to an audit verdict.

## Closing

The more we use AI coding agents, the less a diff alone is enough for code review.

Human commits have commit messages and Pull Request discussions. AI-assisted commits should also preserve prompts, responses, context, and AI Ratio.

Agent Note is an open source, Git-native way to do that.

- GitHub: <https://github.com/wasabeef/AgentNote>
- Documentation: <https://wasabeef.github.io/AgentNote/>
- npm: <https://www.npmjs.com/package/agent-note>

If you want AI-assisted code to remain understandable after the session is over, please give Agent Note a try.
