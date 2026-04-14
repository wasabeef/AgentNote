export const COMMENT_MARKER = "<!-- agentnote-pr-report -->";
export const DESCRIPTION_BEGIN = "<!-- agentnote-begin -->";
export const DESCRIPTION_END = "<!-- agentnote-end -->";

/**
 * Resolve the output mode from action inputs.
 * Explicit `output` input takes precedence; legacy `comment=false` maps to description.
 */
export function resolveOutputMode(
  outputInput: string,
  commentInput: string,
): "description" | "comment" {
  if (outputInput === "description" || outputInput === "comment") {
    return outputInput;
  }
  if (commentInput === "false") {
    return "description";
  }
  return "description"; // default
}

/**
 * Upsert the agentnote markdown section into a PR description body.
 * Replaces the existing section (begin/end markers) if present, appends if not.
 */
export function upsertDescription(existingBody: string, markdown: string): string {
  const section = `${DESCRIPTION_BEGIN}\n${markdown}\n${DESCRIPTION_END}`;

  if (existingBody.includes(DESCRIPTION_BEGIN)) {
    const before = existingBody.slice(0, existingBody.indexOf(DESCRIPTION_BEGIN));
    const after = existingBody.includes(DESCRIPTION_END)
      ? existingBody.slice(existingBody.indexOf(DESCRIPTION_END) + DESCRIPTION_END.length)
      : "";
    return `${before.trimEnd()}\n\n${section}${after}`;
  }

  return `${existingBody.trimEnd()}\n\n${section}`;
}
