/** Stable agent identifiers used in config files, git notes, and session metadata. */
export const AGENT_NAMES = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  gemini: "gemini",
} as const;

export type AgentName = (typeof AGENT_NAMES)[keyof typeof AGENT_NAMES];

/** Agent-agnostic event kinds written by adapters and consumed by the hook recorder. */
export const NORMALIZED_EVENT_KINDS = {
  sessionStart: "session_start",
  stop: "stop",
  response: "response",
  prompt: "prompt",
  preEdit: "pre_edit",
  fileChange: "file_change",
  preCommit: "pre_commit",
  postCommit: "post_commit",
} as const;

export type NormalizedEventKind =
  (typeof NORMALIZED_EVENT_KINDS)[keyof typeof NORMALIZED_EVENT_KINDS];

/** Raw hook input plus sync/async execution metadata from the CLI wrapper. */
export interface HookInput {
  /** Raw stdin JSON from the agent. */
  raw: string;
  /** True for synchronous hooks (PreToolUse) that must write to stdout. */
  sync: boolean;
}

/** Prompt/response pair recovered from an agent transcript. */
export interface TranscriptInteraction {
  prompt: string;
  response: string | null;
  /**
   * Timestamp of the user prompt in the source transcript when available.
   * Used only as a safety lower bound for resumed transcripts; older
   * transcripts without timestamps keep the existing pairing behavior.
   */
  timestamp?: string;
  /**
   * Authoritative identity for this prompt, assigned by the hook at
   * UserPromptSubmit time. Used to pair transcript-derived interactions with
   * session prompts without relying on text-content comparison. Undefined on
   * older interactions extracted before the adapter's correlate step runs.
   */
  prompt_id?: string;
  files_touched?: string[];
  line_stats?: Record<string, { added: number; deleted: number }>;
  tools?: string[] | null;
  mutation_tools?: string[] | null;
}

/** Agent-agnostic event shape consumed by the hook command. */
export interface NormalizedEvent {
  kind: NormalizedEventKind;
  sessionId: string;
  timestamp: string;
  prompt?: string;
  response?: string;
  file?: string;
  tool?: string;
  /** Stable identifier correlating a PreToolUse event with its PostToolUse counterpart. */
  toolUseId?: string;
  editStats?: {
    added: number;
    deleted: number;
  };
  commitCommand?: string;
  transcriptPath?: string;
  model?: string;
}

/** Adapter contract for installing hooks and normalizing agent-specific events. */
export interface AgentAdapter {
  /** Agent identifier (e.g., "claude", "cursor"). */
  name: AgentName;

  /** Config file path relative to repo root (e.g., ".claude/settings.json"). */
  settingsRelPath: string;

  /** All repo-relative files this adapter manages. */
  managedPaths(repoRoot: string): Promise<string[]>;

  /** Add agent-note hooks. Idempotent — safe to call multiple times. */
  installHooks(repoRoot: string): Promise<void>;

  /** Remove agent-note hooks. Idempotent — no-op if not installed. */
  removeHooks(repoRoot: string): Promise<void>;

  /** Check if hooks are installed. */
  isEnabled(repoRoot: string): Promise<boolean>;

  /** Parse raw hook input into a normalized event. Returns null for unrecognized events. */
  parseEvent(input: HookInput): NormalizedEvent | null;

  /** Find the transcript file for a session. Returns null if not available locally. Path must be under the agent's data directory. */
  findTranscript(sessionId: string): string | null;

  /** Extract all prompt-response pairs from the agent's transcript. */
  extractInteractions(transcriptPath: string): Promise<TranscriptInteraction[]>;

  /** Return an environment-provided current session id when the agent exposes one. */
  readEnvironmentSessionId?(): string | null;
}
