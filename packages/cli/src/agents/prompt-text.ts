const SYSTEM_PROMPT_PREFIXES = ["<task-notification", "<system-reminder", "<teammate-message"];
const LEADING_ENVIRONMENT_CONTEXT_RE =
  /^\s*<environment_context(?:\s[^>]*)?>[\s\S]*?<\/environment_context>\s*/i;
const LEADING_SELF_CLOSING_ENVIRONMENT_CONTEXT_RE = /^\s*<environment_context(?:\s[^>]*)?\/>\s*/i;

/** True when the prompt is a standalone system-injected message, not user intent. */
function isSystemInjectedPrompt(prompt: string): boolean {
  for (const prefix of SYSTEM_PROMPT_PREFIXES) {
    if (prompt.startsWith(prefix)) {
      const next = prompt[prefix.length];
      if (next === ">" || next === " " || next === "\n" || next === undefined) {
        return true;
      }
    }
  }
  return false;
}

/** Strip leading runtime metadata blocks while preserving the user's actual prompt. */
function stripLeadingEnvironmentContext(prompt: string): string {
  let next = prompt;
  while (true) {
    const stripped = next
      .replace(LEADING_SELF_CLOSING_ENVIRONMENT_CONTEXT_RE, "")
      .replace(LEADING_ENVIRONMENT_CONTEXT_RE, "");
    if (stripped === next) return next;
    next = stripped;
  }
}

/** Normalize agent-supplied user text before it becomes durable Agent Note data. */
export function normalizeUserPromptText(prompt: string | null | undefined): string | null {
  const trimmed = prompt?.trim();
  if (!trimmed) return null;

  const withoutRuntimeMetadata = stripLeadingEnvironmentContext(trimmed).trim();
  if (!withoutRuntimeMetadata || isSystemInjectedPrompt(withoutRuntimeMetadata)) return null;

  return withoutRuntimeMetadata;
}
