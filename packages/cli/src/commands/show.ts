import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getAgent, hasAgent } from "../agents/index.js";
import { AGENT_NAMES } from "../agents/types.js";
import {
  BAR_WIDTH_FULL,
  SESSIONS_DIR,
  TRAILER_KEY,
  TRUNCATE_PROMPT,
  TRUNCATE_RESPONSE_SHOW,
} from "../core/constants.js";
import { readSessionAgent, readSessionTranscriptPath } from "../core/session.js";
import { readNote } from "../core/storage.js";
import { git } from "../git.js";
import { agentnoteDir } from "../paths.js";
import { normalizeEntry } from "./normalize.js";

const DEFAULT_COMMIT_REF = "HEAD";
const COMMIT_REF_PATTERN = /^(HEAD|[0-9a-f]{7,40})$/i;
const BYTES_PER_KILOBYTE = 1024;
const PERCENT_DENOMINATOR = 100;

/** Print the Agent Note details attached to one commit. */
export async function show(commitRef?: string): Promise<void> {
  if (commitRef && !COMMIT_REF_PATTERN.test(commitRef)) {
    console.error("usage: agent-note show [commit]");
    console.error("commit must be HEAD or a 7-40 character commit SHA");
    process.exit(1);
  }

  const ref = commitRef ?? DEFAULT_COMMIT_REF;

  const commitInfo = await git(["log", "-1", "--format=%h %s", ref]);
  const commitSha = await git(["log", "-1", "--format=%H", ref]);

  console.log(`commit:  ${commitInfo}`);

  const raw = await readNote(commitSha);
  const trailerSessionId = (
    await git(["log", "-1", `--format=%(trailers:key=${TRAILER_KEY},valueonly)`, ref])
  ).trim();

  if (!raw && !trailerSessionId) {
    console.log("session: none (no agent-note data)");
    return;
  }

  if (!raw) {
    console.log(`session: ${trailerSessionId}`);
    console.log("entry:   no agent-note note found for this commit");
    return;
  }

  const entry = normalizeEntry(raw);
  const sessionId = trailerSessionId || entry.session_id;
  if (!sessionId) {
    console.log("session: none (no agent-note data)");
    return;
  }

  console.log(`session: ${sessionId}`);

  console.log();
  const ratioBar = renderRatioBar(entry.attribution.ai_ratio);
  const lineDetail =
    entry.attribution.method === "line" && entry.attribution.lines
      ? ` (${entry.attribution.lines.ai_added}/${entry.attribution.lines.total_added} lines)`
      : "";
  console.log(`ai:      ${entry.attribution.ai_ratio}%${lineDetail} ${ratioBar}`);

  if (entry.model) {
    console.log(`model:   ${entry.model}`);
  }
  if (entry.agent) {
    console.log(`agent:   ${entry.agent}`);
  }

  const aiCount = entry.files.filter((f) => f.by_ai).length;
  console.log(`files:   ${entry.files.length} changed, ${aiCount} by AI`);

  if (entry.files.length > 0) {
    console.log();
    for (const file of entry.files) {
      const marker = file.by_ai ? "  🤖" : "  👤";
      console.log(`  ${file.path}${marker}`);
    }
  }

  if (entry.interactions.length > 0) {
    console.log();
    console.log(`prompts: ${entry.interactions.length}`);

    for (let i = 0; i < entry.interactions.length; i++) {
      const interaction = entry.interactions[i];
      console.log();
      console.log(`  ${i + 1}. ${truncateLines(interaction.prompt, TRUNCATE_PROMPT)}`);
      if (interaction.response) {
        console.log(`     → ${truncateLines(interaction.response, TRUNCATE_RESPONSE_SHOW)}`);
      }
      if (interaction.files_touched && interaction.files_touched.length > 0) {
        for (const file of interaction.files_touched) {
          console.log(`     📄 ${file}`);
        }
      }
    }
  }

  // Show transcript location only if available locally.
  const sessionDir = join(await agentnoteDir(), SESSIONS_DIR, sessionId);
  const sessionAgent = (await readSessionAgent(sessionDir)) ?? entry.agent ?? AGENT_NAMES.claude;
  const adapter = hasAgent(sessionAgent) ? getAgent(sessionAgent) : getAgent(AGENT_NAMES.claude);
  const transcriptPath =
    (await readSessionTranscriptPath(sessionDir)) ?? adapter.findTranscript(sessionId);
  if (transcriptPath) {
    console.log();
    const stats = await stat(transcriptPath);
    const sizeKb = (stats.size / BYTES_PER_KILOBYTE).toFixed(1);
    console.log(`transcript: ${transcriptPath} (${sizeKb} KB)`);
  }
}

function renderRatioBar(ratio: number): string {
  const width = BAR_WIDTH_FULL;
  const filled = Math.round((ratio / PERCENT_DENOMINATOR) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

function truncateLines(text: string, maxLen: number): string {
  const firstLine = text.split("\n")[0];
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, maxLen)}…`;
}
