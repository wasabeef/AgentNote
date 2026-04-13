// ─── Trailer ───
export const TRAILER_KEY = "Agentnote-Session";
export const AGENTNOTE_HOOK_MARKER = "# agentnote-managed";

// ─── Git notes ───
export const NOTES_REF = "agentnote";
export const NOTES_REF_FULL = `refs/notes/${NOTES_REF}`;
export const NOTES_FETCH_REFSPEC = `+${NOTES_REF_FULL}:${NOTES_REF_FULL}`;

// ─── Directory names ───
export const AGENTNOTE_DIR = "agentnote";
export const SESSIONS_DIR = "sessions";

// ─── Session file names ───
export const PROMPTS_FILE = "prompts.jsonl";
export const CHANGES_FILE = "changes.jsonl";
export const EVENTS_FILE = "events.jsonl";
export const TRANSCRIPT_PATH_FILE = "transcript_path";
export const TURN_FILE = "turn";
export const SESSION_FILE = "session";
export const SESSION_AGENT_FILE = "agent";
export const PENDING_COMMIT_FILE = "pending_commit.json";

// ─── Display limits ───
export const MAX_COMMITS = 500;
export const BAR_WIDTH_COMPACT = 5;
export const BAR_WIDTH_FULL = 20;
export const TRUNCATE_PROMPT = 120;
export const TRUNCATE_RESPONSE_SHOW = 200;
export const TRUNCATE_RESPONSE_PR = 500;
export const TRUNCATE_RESPONSE_CHAT = 800;

// ─── Archive ───
/** Base36 rotation ID pattern: [0-9a-z]{6,} (future-safe for post-2059 length growth). */
export const ARCHIVE_ID_RE = /^[0-9a-z]{6,}$/;

// ─── Session infrastructure ───
export const HEARTBEAT_FILE = "heartbeat";
export const PRE_BLOBS_FILE = "pre_blobs.jsonl";
/** Tracks (turn, file) pairs already attributed to a commit. Not rotated — persists across turns. */
export const COMMITTED_PAIRS_FILE = "committed_pairs.jsonl";

// ─── Git ───
/** SHA-1 hash of a git blob with empty content (canonical git empty blob). */
export const EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

// ─── Schema ───
export const SCHEMA_VERSION = 1 as const;

// ─── Debug ───
export const DEBUG = !!process.env.AGENTNOTE_DEBUG;
