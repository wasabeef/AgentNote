export type ContextCandidate = {
  prompt: string;
  previousResponse: string | null;
  previousTurnSelected: boolean;
};

export type CommitContextSignature = {
  changedFiles: string[];
  changedFileBasenames: string[];
  codeIdentifiers: Set<string>;
  commitSubjectTokens: string[];
};

const MAX_CONTEXT_CHARS = 900;
const GENERIC_TOKENS = new Set([
  "agent",
  "agentnote",
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
  "json",
  "note",
  "prompt",
  "record",
  "response",
  "test",
  "tests",
  "todo",
  "turn",
  "utf8",
  "yaml",
]);

const CAMEL_OR_PASCAL_IDENTIFIER = /\b[A-Za-z_$]*[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*\b/g;
const SNAKE_IDENTIFIER = /\b[a-z][a-z0-9]*_[a-z][a-z0-9_]*[a-z0-9]\b/g;
const ALL_CAPS_IDENTIFIER = /\b[A-Z][A-Z0-9_]{3,}\b/g;

type ParagraphScore = {
  paragraph: string;
  index: number;
  exactPathHits: number;
  basenameHits: number;
  codeIdentifierHits: number;
  subjectTokenHits: number;
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
