import type { InteractionContext } from "./entry.js";

export type ContextCandidate = {
  prompt: string;
  previousResponse: string | null;
  previousTurnSelected: boolean;
};

export type ScopeContextCandidate = {
  prompt: string;
  response: string | null;
};

export type CommitContextSignature = {
  changedFiles: string[];
  changedFileBasenames: string[];
  codeIdentifiers: Set<string>;
  commitSubjectTokens: string[];
};

const MAX_CONTEXT_CHARS = 900;
const MAX_SCOPE_PROMPT_CHARS = 120;
const MAX_SCOPE_LINES = 10;
const MAX_SCOPE_SENTENCES = 4;
const MIN_SCOPE_SCORE = 2;
const GENERIC_TOKENS = new Set([
  "agent",
  "agentnote",
  "add",
  "added",
  "adds",
  "build",
  "case",
  "change",
  "commit",
  "context",
  "diff",
  "file",
  "files",
  "fix",
  "html",
  "http",
  "https",
  "implement",
  "implemented",
  "implements",
  "json",
  "note",
  "prompt",
  "record",
  "remove",
  "removed",
  "removes",
  "response",
  "test",
  "tests",
  "todo",
  "turn",
  "update",
  "updated",
  "updates",
  "utf8",
  "yaml",
]);

const CAMEL_OR_PASCAL_IDENTIFIER = /\b[A-Za-z_$]*[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*\b/g;
const SNAKE_IDENTIFIER = /\b[a-z][a-z0-9]*_[a-z][a-z0-9_]*[a-z0-9]\b/g;
const ALL_CAPS_IDENTIFIER = /\b[A-Z][A-Z0-9_]{2,}\b/g;
const ISSUE_OR_PR_REFERENCE = /\b(?:PR|Issue|GH)[\s#-]*\d+\b|#\d+\b/iu;
const MARKDOWN_FILE_REFERENCE =
  /(?:^|[\s("'`])(?:\.{0,2}\/)?[A-Za-z0-9_.-]+\/[^\s"'`]+\.[A-Za-z0-9]{1,8}\b/;

type ParagraphScore = {
  paragraph: string;
  index: number;
  exactPathHits: number;
  basenameHits: number;
  codeIdentifierHits: number;
  subjectTokenHits: number;
};

type ScopeScore = {
  context: RankedInteractionContext;
  fileHits: number;
  codeIdentifierHits: number;
  scopedTitleHits: number;
  issueScopedTitleHits: number;
  markdownIssueHits: number;
  subjectTokenHits: number;
  issueRefHits: number;
  index: number;
};

export type RankedInteractionContext = InteractionContext & {
  rank: number;
};

export function buildCommitContextSignature(opts: {
  changedFiles: string[];
  diffText: string;
  commitSubject: string;
}): CommitContextSignature {
  return {
    changedFiles: unique(opts.changedFiles.map((file) => normalizePath(file))),
    changedFileBasenames: unique(
      opts.changedFiles.map((file) => basename(normalizePath(file))).filter(Boolean),
    ),
    codeIdentifiers: extractCodeIdentifiers(opts.diffText),
    commitSubjectTokens: tokenizeSubject(opts.commitSubject),
  };
}

export function extractCodeIdentifiers(diffText: string): Set<string> {
  const identifiers = new Set<string>();
  for (const pattern of [CAMEL_OR_PASCAL_IDENTIFIER, SNAKE_IDENTIFIER, ALL_CAPS_IDENTIFIER]) {
    for (const match of diffText.matchAll(pattern)) {
      const identifier = match[0];
      if (isGenericIdentifier(identifier)) continue;
      identifiers.add(identifier);
    }
  }
  return identifiers;
}

export function selectInteractionContext(
  candidate: ContextCandidate,
  signature: CommitContextSignature,
): string | undefined {
  if (candidate.previousTurnSelected) return undefined;
  if (!candidate.previousResponse) return undefined;
  if (hasStrongAnchor(candidate.prompt, signature)) return undefined;

  const scored = splitParagraphs(candidate.previousResponse)
    .filter((paragraph) => !isRejectedParagraph(paragraph))
    .map((paragraph, index) => scoreParagraph(paragraph, index, signature))
    .filter((score) => hasStrongParagraphAnchor(score))
    .sort(compareParagraphScores);

  if (scored.length === 0) return undefined;

  const maxChars = Math.min(MAX_CONTEXT_CHARS, candidate.previousResponse.length);
  const selected = scored.slice(0, 2).sort((a, b) => a.index - b.index);
  const output: string[] = [];
  let length = 0;

  for (const item of selected) {
    const nextLength = length + item.paragraph.length + (output.length > 0 ? 2 : 0);
    if (nextLength > maxChars) continue;
    output.push(item.paragraph);
    length = nextLength;
  }

  return output.length > 0 ? output.join("\n\n") : undefined;
}

export function toReferenceContext(
  context: string | undefined,
): RankedInteractionContext | undefined {
  const text = context?.trim();
  if (!text) return undefined;
  return {
    kind: "reference",
    source: "previous_response",
    text,
    rank: 3,
  };
}

export function selectInteractionScopeContext(
  candidate: ScopeContextCandidate,
  signature: CommitContextSignature,
): RankedInteractionContext | undefined {
  if (!candidate.response) return undefined;
  if (!isShortPrompt(candidate.prompt)) return undefined;
  if (hasStrongAnchor(candidate.prompt, signature)) return undefined;

  const sentences = splitScopeSentences(candidate.response)
    .map((sentence, index) => ({ sentence, index }))
    .filter(({ sentence }) => !isRejectedParagraph(sentence));

  const scored = sentences
    .map(({ sentence, index }) => scoreScopeSentence(sentence, index, signature))
    .filter((score) => isValidScopeScore(score))
    .sort(compareScopeScores);

  return scored[0]?.context;
}

export function composeInteractionContexts(
  contexts: Array<RankedInteractionContext | undefined>,
  maxChars = MAX_CONTEXT_CHARS,
): InteractionContext[] {
  const uniqueContexts = dedupeContexts(
    contexts.filter((context): context is RankedInteractionContext => context !== undefined),
  );
  if (uniqueContexts.length === 0) return [];

  const fullLength = contextBlockLength(uniqueContexts);
  if (fullLength <= maxChars) return sortContextsForDisplay(uniqueContexts).map(stripRank);

  const selected: RankedInteractionContext[] = [];
  for (const context of [...uniqueContexts].sort(compareContextRanks)) {
    if (context.text.length > maxChars) continue;
    const next = [...selected, context];
    if (contextBlockLength(next) <= maxChars) {
      selected.push(context);
    }
  }

  return sortContextsForDisplay(selected).map(stripRank);
}

function scoreParagraph(
  paragraph: string,
  index: number,
  signature: CommitContextSignature,
): ParagraphScore {
  return {
    paragraph,
    index,
    exactPathHits: countLiteralHits(paragraph, signature.changedFiles),
    basenameHits: countLiteralHits(paragraph, signature.changedFileBasenames),
    codeIdentifierHits: countIdentifierHits(paragraph, signature.codeIdentifiers),
    subjectTokenHits: countSubjectTokenHits(paragraph, signature.commitSubjectTokens),
  };
}

function compareParagraphScores(a: ParagraphScore, b: ParagraphScore): number {
  return (
    b.exactPathHits - a.exactPathHits ||
    b.basenameHits - a.basenameHits ||
    b.codeIdentifierHits - a.codeIdentifierHits ||
    b.subjectTokenHits - a.subjectTokenHits ||
    a.index - b.index
  );
}

function hasStrongParagraphAnchor(score: ParagraphScore): boolean {
  return score.exactPathHits > 0 || score.basenameHits > 0 || score.codeIdentifierHits > 0;
}

function hasStrongAnchor(text: string, signature: CommitContextSignature): boolean {
  return (
    countLiteralHits(text, signature.changedFiles) > 0 ||
    countLiteralHits(text, signature.changedFileBasenames) > 0 ||
    countIdentifierHits(text, signature.codeIdentifiers) > 0
  );
}

function isShortPrompt(prompt: string): boolean {
  const lines = prompt
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return prompt.trim().length <= MAX_SCOPE_PROMPT_CHARS && lines.length <= 3;
}

function splitScopeSentences(response: string): string[] {
  const lines = response
    .split("\n")
    .map((line) => stripListOrQuoteMarker(line.trim()))
    .filter(Boolean)
    .slice(0, MAX_SCOPE_LINES);
  const text = lines.join(" ");
  const sentences: string[] = [];
  let current = "";
  let inBacktick = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    current += char;
    if (char === "`") {
      inBacktick = !inBacktick;
      continue;
    }
    if (inBacktick) continue;
    if (isSentenceBoundary(text, index)) {
      const sentence = current.trim();
      if (sentence) sentences.push(sentence);
      current = "";
    }
  }

  const rest = current.trim();
  if (rest) sentences.push(rest);

  const leadingSentences = sentences.slice(0, MAX_SCOPE_SENTENCES);
  const windows: string[] = [];
  for (let index = 0; index < leadingSentences.length; index++) {
    windows.push(leadingSentences[index]);
    const next = leadingSentences[index + 1];
    if (next) windows.push(`${leadingSentences[index]} ${next}`);
  }
  return windows;
}

function stripListOrQuoteMarker(line: string): string {
  return line
    .replace(/^>\s*/, "")
    .replace(/^(?:[-*]|\d+[.)])\s+/, "")
    .trim();
}

function isSentenceBoundary(text: string, index: number): boolean {
  const char = text[index];
  if (char === "。" || char === "！" || char === "？") return true;
  if (char !== "." && char !== "!" && char !== "?") return false;
  const next = text[index + 1] ?? "";
  if (next && !/\s/.test(next)) return false;
  if (char === "." && isLikelyFileOrDomainDot(text, index)) return false;
  return true;
}

function isLikelyFileOrDomainDot(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 32), index);
  const after = text.slice(index + 1, index + 16);
  return /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(`${before}.${after}`) && /\w/.test(after);
}

function scoreScopeSentence(
  sentence: string,
  index: number,
  signature: CommitContextSignature,
): ScopeScore {
  const fileHits =
    countLiteralHits(sentence, signature.changedFiles) +
    countLiteralHits(sentence, signature.changedFileBasenames);
  const codeIdentifierHits = countIdentifierHits(sentence, signature.codeIdentifiers);
  const subjectTokenHits = countSubjectTokenHits(sentence, signature.commitSubjectTokens);
  const issueRefHits = ISSUE_OR_PR_REFERENCE.test(sentence) ? 1 : 0;
  const scopedTitleHits = subjectTokenHits >= 2 ? 1 : 0;
  const issueScopedTitleHits = issueRefHits > 0 && subjectTokenHits > 0 ? 1 : 0;
  const markdownIssueHits = issueRefHits > 0 && MARKDOWN_FILE_REFERENCE.test(sentence) ? 1 : 0;
  const structuralScore =
    codeIdentifierHits * 2 +
    scopedTitleHits * 2 +
    issueScopedTitleHits * 2 +
    markdownIssueHits * 2 +
    fileHits;

  return {
    context: {
      kind: "scope",
      source: "current_response",
      text: sentence,
      rank: structuralScore,
    },
    fileHits,
    codeIdentifierHits,
    scopedTitleHits,
    issueScopedTitleHits,
    markdownIssueHits,
    subjectTokenHits,
    issueRefHits,
    index,
  };
}

function isValidScopeScore(score: ScopeScore): boolean {
  if (score.context.rank < MIN_SCOPE_SCORE) return false;
  const hasScopedTitle = score.scopedTitleHits > 0 || score.issueScopedTitleHits > 0;
  const hasIssueCodeScope = score.issueRefHits > 0 && score.codeIdentifierHits > 0;
  const hasCodeSubjectScope = score.codeIdentifierHits > 0 && score.subjectTokenHits > 0;
  if (score.fileHits > 0) {
    return score.codeIdentifierHits > 0 || hasScopedTitle || score.markdownIssueHits > 0;
  }
  return hasScopedTitle || score.markdownIssueHits > 0 || hasIssueCodeScope || hasCodeSubjectScope;
}

function compareScopeScores(a: ScopeScore, b: ScopeScore): number {
  return (
    b.context.rank - a.context.rank ||
    b.issueScopedTitleHits - a.issueScopedTitleHits ||
    b.markdownIssueHits - a.markdownIssueHits ||
    b.codeIdentifierHits - a.codeIdentifierHits ||
    b.scopedTitleHits - a.scopedTitleHits ||
    a.index - b.index
  );
}

function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let inFence = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      if (current.length > 0) {
        paragraphs.push(current.join("\n").trim());
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) paragraphs.push(current.join("\n").trim());
  return paragraphs.filter((paragraph) => paragraph.length > 0);
}

function isRejectedParagraph(paragraph: string): boolean {
  return (
    hasBrokenCodeFence(paragraph) ||
    isIntroOnlyParagraph(paragraph) ||
    isOperationalNoise(paragraph) ||
    hasLocalAbsolutePath(paragraph)
  );
}

function hasBrokenCodeFence(paragraph: string): boolean {
  return (paragraph.match(/```/g) ?? []).length % 2 !== 0;
}

function isIntroOnlyParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  return /^#{1,6}\s+\S/.test(trimmed) || /[:：]\s*$/.test(trimmed);
}

function isOperationalNoise(paragraph: string): boolean {
  const lower = paragraph.toLowerCase();
  return (
    lower.includes("working tree") ||
    lower.includes("ready for review") ||
    (/\bci\b/.test(lower) && /\b(pass|passed|green|failed|failure)\b/.test(lower)) ||
    lower.includes("git diff --check")
  );
}

function hasLocalAbsolutePath(paragraph: string): boolean {
  return /(?:^|[\s("'`])(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(paragraph);
}

function countLiteralHits(text: string, literals: string[]): number {
  let count = 0;
  for (const literal of literals) {
    if (!literal) continue;
    if (containsLiteral(text, literal)) count += 1;
  }
  return count;
}

function containsLiteral(text: string, literal: string): boolean {
  const escaped = escapeRegExp(literal);
  const pattern = new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}($|[^A-Za-z0-9_/-])`, "i");
  return pattern.test(text);
}

function countIdentifierHits(text: string, identifiers: Set<string>): number {
  let count = 0;
  for (const identifier of identifiers) {
    if (containsIdentifier(text, identifier)) count += 1;
  }
  return count;
}

function containsIdentifier(text: string, identifier: string): boolean {
  const escaped = escapeRegExp(identifier);
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

function countSubjectTokenHits(text: string, tokens: string[]): number {
  const textTokens = new Set(tokenizeSubject(text));
  return tokens.filter((token) => textTokens.has(token)).length;
}

function tokenizeSubject(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token));
  return unique(tokens);
}

function isGenericIdentifier(identifier: string): boolean {
  return GENERIC_TOKENS.has(identifier.toLowerCase());
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeContexts(contexts: RankedInteractionContext[]): RankedInteractionContext[] {
  const seen = new Set<string>();
  const result: RankedInteractionContext[] = [];
  for (const context of contexts) {
    const text = context.text.trim();
    if (!text) continue;
    const key = text;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...context, text });
  }
  return result;
}

function contextBlockLength(contexts: RankedInteractionContext[]): number {
  return contexts.reduce((length, context, index) => {
    return length + context.text.length + (index > 0 ? 2 : 0);
  }, 0);
}

function compareContextRanks(a: RankedInteractionContext, b: RankedInteractionContext): number {
  return b.rank - a.rank || contextKindOrder(a.kind) - contextKindOrder(b.kind);
}

function sortContextsForDisplay(contexts: RankedInteractionContext[]): RankedInteractionContext[] {
  return [...contexts].sort(
    (a, b) => contextKindOrder(a.kind) - contextKindOrder(b.kind) || b.rank - a.rank,
  );
}

function contextKindOrder(kind: InteractionContext["kind"]): number {
  return kind === "reference" ? 0 : 1;
}

function stripRank(context: RankedInteractionContext): InteractionContext {
  return {
    kind: context.kind,
    source: context.source,
    text: context.text,
  };
}
