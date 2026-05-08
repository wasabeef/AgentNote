import { postPrComment, updatePrDescription } from "agent-note-pr-report/github";
import { collectReport, detectBaseBranch, renderMarkdown } from "agent-note-pr-report/report";
import { parsePromptDetail } from "../core/entry.js";

const DEFAULT_HEAD_REF = "HEAD";
const JSON_INDENT_SPACES = 2;
const PR_FLAG_PREFIX = "--";
const PR_FLAG_HEAD = "--head";
const PR_FLAG_JSON = "--json";
const PR_FLAG_OUTPUT = "--output";
const PR_FLAG_PROMPT_DETAIL = "--prompt-detail";
const PR_FLAG_UPDATE = "--update";
const PR_OUTPUT_DESCRIPTION = "description";

/** Preview or update the Agent Note PR Report for a branch range. */
export async function pr(args: string[]): Promise<void> {
  const isJson = args.includes(PR_FLAG_JSON);
  const outputIdx = args.indexOf(PR_FLAG_OUTPUT);
  const updateIdx = args.indexOf(PR_FLAG_UPDATE);
  const headIdx = args.indexOf(PR_FLAG_HEAD);
  const promptDetailIdx = args.indexOf(PR_FLAG_PROMPT_DETAIL);
  const prNumber = updateIdx !== -1 ? args[updateIdx + 1] : null;
  const headRef = headIdx !== -1 ? args[headIdx + 1] : DEFAULT_HEAD_REF;
  if (promptDetailIdx !== -1 && !args[promptDetailIdx + 1]) {
    console.error("error: --prompt-detail requires compact or full");
    process.exit(1);
  }
  const promptDetail =
    promptDetailIdx !== -1 ? parsePromptDetail(args[promptDetailIdx + 1]) : parsePromptDetail(null);
  const positional = args.filter(
    (arg, index) =>
      !arg.startsWith(PR_FLAG_PREFIX) &&
      (outputIdx === -1 || index !== outputIdx + 1) &&
      (updateIdx === -1 || index !== updateIdx + 1) &&
      (headIdx === -1 || index !== headIdx + 1) &&
      (promptDetailIdx === -1 || index !== promptDetailIdx + 1),
  );
  const base = positional[0] ?? (await detectBaseBranch());

  if (!base) {
    console.error("error: could not detect base branch. pass it as argument: agent-note pr <base>");
    process.exit(1);
  }

  const outputMode = outputIdx !== -1 ? args[outputIdx + 1] : PR_OUTPUT_DESCRIPTION;
  const report = await collectReport(base, headRef, { dashboardPrNumber: prNumber });

  if (!report) {
    if (isJson) {
      console.log(JSON.stringify({ error: "no commits found" }));
    } else {
      console.log(`no commits found between HEAD and ${base}`);
    }
    return;
  }

  if (isJson) {
    console.log(JSON.stringify(report, null, JSON_INDENT_SPACES));
    return;
  }

  const rendered = renderMarkdown(report, { promptDetail });
  if (!prNumber) {
    console.log(rendered);
    return;
  }

  if (outputMode === PR_OUTPUT_DESCRIPTION) {
    await updatePrDescription(prNumber, rendered);
    console.log(`agent-note: PR #${prNumber} description updated`);
    return;
  }

  await postPrComment(prNumber, rendered);
  console.log(`agent-note: PR #${prNumber} comment posted`);
}
