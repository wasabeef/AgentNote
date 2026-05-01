import { postPrComment, updatePrDescription } from "agent-note-pr-report/github";
import { collectReport, detectBaseBranch, renderMarkdown } from "agent-note-pr-report/report";
import { parsePromptDetail } from "../core/entry.js";

export async function pr(args: string[]): Promise<void> {
  const isJson = args.includes("--json");
  const outputIdx = args.indexOf("--output");
  const updateIdx = args.indexOf("--update");
  const headIdx = args.indexOf("--head");
  const promptDetailIdx = args.indexOf("--prompt-detail");
  const prNumber = updateIdx !== -1 ? args[updateIdx + 1] : null;
  const headRef = headIdx !== -1 ? args[headIdx + 1] : "HEAD";
  if (promptDetailIdx !== -1 && !args[promptDetailIdx + 1]) {
    console.error("error: --prompt-detail requires compact or full");
    process.exit(1);
  }
  const promptDetail =
    promptDetailIdx !== -1 ? parsePromptDetail(args[promptDetailIdx + 1]) : parsePromptDetail(null);
  const positional = args.filter(
    (arg, index) =>
      !arg.startsWith("--") &&
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

  const outputMode = outputIdx !== -1 ? args[outputIdx + 1] : "description";
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
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const rendered = renderMarkdown(report, { promptDetail });
  if (!prNumber) {
    console.log(rendered);
    return;
  }

  if (outputMode === "description") {
    await updatePrDescription(prNumber, rendered);
    console.log(`agent-note: PR #${prNumber} description updated`);
    return;
  }

  await postPrComment(prNumber, rendered);
  console.log(`agent-note: PR #${prNumber} comment posted`);
}
