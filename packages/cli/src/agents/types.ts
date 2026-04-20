export interface HookInput {
  /** Raw stdin JSON from the agent. */
  raw: string;
  /** True for synchronous hooks (PreToolUse) that must write to stdout. */
  sync: boolean;
}

export interface TranscriptInteraction {
  prompt: string;
  response: string | null;
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
}

export interface NormalizedEvent {
  kind:
    | "session_start"
    | "stop"
    | "response"
    | "prompt"
    | "pre_edit"
    | "file_change"
    | "pre_commit"
    | "post_commit";
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

export interface AgentAdapter {
  /** Agent identifier (e.g., "claude", "cursor"). */
  name: string;

  /** Config file path relative to repo root (e.g., ".claude/settings.json"). */
  settingsRelPath: string;

  /** All repo-relative files this adapter manages. */
  managedPaths(repoRoot: string): Promise<string[]>;

  /** Add agentnote hooks. Idempotent — safe to call multiple times. Replaces legacy formats. */
  installHooks(repoRoot: string): Promise<void>;

  /** Remove agentnote hooks. Idempotent — no-op if not installed. Removes both current and legacy formats. */
  removeHooks(repoRoot: string): Promise<void>;

  /** Check if current-format hooks are installed. Returns false for legacy-only installs. */
  isEnabled(repoRoot: string): Promise<boolean>;

  /** Parse raw hook input into a normalized event. Returns null for unrecognized events. */
  parseEvent(input: HookInput): NormalizedEvent | null;

  /** Find the transcript file for a session. Returns null if not available locally. Path must be under the agent's data directory. */
  findTranscript(sessionId: string): string | null;

  /** Extract all prompt-response pairs from the agent's transcript. */
  extractInteractions(transcriptPath: string): Promise<TranscriptInteraction[]>;
}
