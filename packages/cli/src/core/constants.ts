// ─── Trailer ───
export const TRAILER_KEY = "Agentnote-Session";

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

// ─── Display limits ───
export const MAX_COMMITS = 500;
export const BAR_WIDTH_COMPACT = 5;
export const BAR_WIDTH_FULL = 20;
export const TRUNCATE_PROMPT = 120;
export const TRUNCATE_RESPONSE_SHOW = 200;
export const TRUNCATE_RESPONSE_PR = 500;
export const TRUNCATE_RESPONSE_CHAT = 800;

// ─── Schema ───
export const SCHEMA_VERSION = 1 as const;

// ─── Debug ───
export const DEBUG = !!process.env.AGENTNOTE_DEBUG;
