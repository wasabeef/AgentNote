// ─── Trailer ───
/** Commit trailer key that links a commit to an Agent Note session. */
export const TRAILER_KEY = "Agentnote-Session";
/** Marker written into managed git hook files so deinit can identify them safely. */
export const AGENTNOTE_HOOK_MARKER = "# agentnote-managed";
/** Public CLI hook command used in agent configuration files. */
export const AGENTNOTE_HOOK_COMMAND = "agent-note hook";
/** Local shim hook command used when generated git hooks call the built CLI. */
export const CLI_JS_HOOK_COMMAND = "cli.js hook";

// ─── Git notes ───
/** Short git-notes ref name used for Agent Note entries. */
export const NOTES_REF = "agentnote";
/** Fully qualified git-notes ref name used for push/fetch operations. */
export const NOTES_REF_FULL = `refs/notes/${NOTES_REF}`;
/** Fetch refspec that syncs Agent Note notes into the local notes ref. */
export const NOTES_FETCH_REFSPEC = `+${NOTES_REF_FULL}:${NOTES_REF_FULL}`;

// ─── Directory names ───
/** Directory under `.git/` where local Agent Note session state is stored. */
export const AGENTNOTE_DIR = "agentnote";
/** Session subdirectory name under `.git/agentnote/`. */
export const SESSIONS_DIR = "sessions";
/** Git hooks managed by `agent-note init`. */
export const GIT_HOOK_NAMES = ["prepare-commit-msg", "post-commit", "pre-push"] as const;

// ─── Session file names ───
/** JSONL file containing user prompts for the active session turn stream. */
export const PROMPTS_FILE = "prompts.jsonl";
/** JSONL file containing post-edit file change events. */
export const CHANGES_FILE = "changes.jsonl";
/** JSONL file containing session lifecycle and heartbeat-related events. */
export const EVENTS_FILE = "events.jsonl";
/** File containing the agent transcript path for the current session. */
export const TRANSCRIPT_PATH_FILE = "transcript_path";
/** File containing the monotonic causal turn counter. */
export const TURN_FILE = "turn";
/**
 * Current user prompt identity (UUID v4, one line). Overwritten at each
 * UserPromptSubmit. Authoritative primary key for pairing prompts with the
 * file edits and transcript interactions they produced.
 */
export const PROMPT_ID_FILE = "prompt_id";
/** File containing the active session ID pointer. */
export const SESSION_FILE = "session";
/** File containing the adapter name that owns the session. */
export const SESSION_AGENT_FILE = "agent";
/** Gemini pending commit state file used between BeforeTool and AfterTool. */
export const PENDING_COMMIT_FILE = "pending_commit.json";

// ─── Display limits ───
/** Maximum commits scanned by commands that need bounded history traversal. */
export const MAX_COMMITS = 500;
/** Number of recent commits inspected by `agent-note status`. */
export const RECENT_STATUS_COMMIT_LIMIT = 20;
/** Compact bar width used in terminal and PR table summaries. */
export const BAR_WIDTH_COMPACT = 5;
/** Full bar width used in detailed terminal output. */
export const BAR_WIDTH_FULL = 20;
/** Prompt truncation length for terminal summaries. */
export const TRUNCATE_PROMPT = 120;
/** Prompt truncation length for PR Report details. */
export const TRUNCATE_PROMPT_PR = 500;
/** Response truncation length for `agent-note show`. */
export const TRUNCATE_RESPONSE_SHOW = 200;
/** Response truncation length for PR Report details. */
export const TRUNCATE_RESPONSE_PR = 500;
/** Response truncation length for chat-style Dashboard snippets. */
export const TRUNCATE_RESPONSE_CHAT = 800;

// ─── Archive ───
/** Base36 rotation ID pattern: [0-9a-z]{6,} (future-safe for post-2059 length growth). */
export const ARCHIVE_ID_RE = /^[0-9a-z]{6,}$/;

// ─── Session infrastructure ───
/** File containing the latest session activity timestamp. */
export const HEARTBEAT_FILE = "heartbeat";
/** Session freshness window used by git hooks and status. */
export const HEARTBEAT_TTL_SECONDS = 60 * 60;
/** Conversion constant for timestamp math. */
export const MILLISECONDS_PER_SECOND = 1000;
/** JSONL file containing pre-edit blob hashes captured before AI edits. */
export const PRE_BLOBS_FILE = "pre_blobs.jsonl";
/** Tracks (turn, file) pairs already attributed to a commit. Not rotated — persists across turns. */
export const COMMITTED_PAIRS_FILE = "committed_pairs.jsonl";

// ─── Git ───
/** SHA-1 hash of a git blob with empty content (canonical git empty blob). */
export const EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

// ─── Schema ───
/** Current Agent Note git-note schema version. */
export const SCHEMA_VERSION = 1 as const;

// ─── Encoding ───
/** Text encoding used for all local Agent Note files. */
export const TEXT_ENCODING = "utf-8";
