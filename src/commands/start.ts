import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hooksDir, loreDir, settingsFile } from "../paths.js";

// メイン hook: session tracking + prompt 記録 + ファイル変更追跡
const HOOK_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
LORE_DIR="\${REPO_ROOT}/.git/lore"
mkdir -p "\${LORE_DIR}"

EVENT=$(cat)
EVENT_NAME=$(echo "$EVENT" | jq -r '.hook_event_name // empty')
SESSION_ID=$(echo "$EVENT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && exit 0

SESSION_DIR="\${LORE_DIR}/sessions/\${SESSION_ID}"
mkdir -p "\${SESSION_DIR}"

case "\${EVENT_NAME}" in
  SessionStart)
    echo "$SESSION_ID" > "\${LORE_DIR}/session"
    echo "$EVENT" | jq -c '{
      event: "session_start",
      session_id: .session_id,
      timestamp: (now | todate),
      model: (.model // null)
    }' >> "\${SESSION_DIR}/events.jsonl"
    ;;

  Stop)
    echo "$SESSION_ID" > "\${LORE_DIR}/session"
    echo "$EVENT" | jq -c '{
      event: "stop",
      session_id: .session_id,
      timestamp: (now | todate)
    }' >> "\${SESSION_DIR}/events.jsonl"
    ;;

  UserPromptSubmit)
    # 全 prompt を記録
    echo "$EVENT" | jq -c '{
      event: "prompt",
      timestamp: (now | todate),
      prompt: .prompt
    }' >> "\${SESSION_DIR}/prompts.jsonl"
    ;;

  PostToolUse)
    # Edit/Write によるファイル変更を追跡
    TOOL_NAME=$(echo "$EVENT" | jq -r '.tool_name // empty')
    case "\${TOOL_NAME}" in
      Edit|Write|NotebookEdit)
        echo "$EVENT" | jq -c '{
          event: "file_change",
          timestamp: (now | todate),
          tool: .tool_name,
          file: .tool_input.file_path,
          session_id: .session_id
        }' >> "\${SESSION_DIR}/changes.jsonl"
        ;;
    esac
    ;;
esac
`;

const SETTINGS_HOOKS = {
  SessionStart: [
    {
      hooks: [
        {
          type: "command",
          command: "bash .claude/hooks/lore-hook.sh",
          async: true,
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: "command",
          command: "bash .claude/hooks/lore-hook.sh",
          async: true,
        },
      ],
    },
  ],
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: "command",
          command: "bash .claude/hooks/lore-hook.sh",
          async: true,
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: "Edit|Write|NotebookEdit",
      hooks: [
        {
          type: "command",
          command: "bash .claude/hooks/lore-hook.sh",
          async: true,
        },
      ],
    },
  ],
};

export async function start(): Promise<void> {
  const loreDirPath = await loreDir();
  const hooksDirPath = await hooksDir();
  const settingsPath = await settingsFile();

  // ディレクトリ作成
  await mkdir(loreDirPath, { recursive: true });
  await mkdir(hooksDirPath, { recursive: true });

  // hook script 生成
  const hookPath = `${hooksDirPath}/lore-hook.sh`;
  await writeFile(hookPath, HOOK_SCRIPT, { mode: 0o755 });

  // settings.json 更新
  let settings: any = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  // 既に設定済みかチェック
  const hooks = settings.hooks ?? {};
  const hasLore = JSON.stringify(hooks).includes("lore-hook");

  if (hasLore) {
    console.log("lore: already configured");
    return;
  }

  // 全 hooks を追加
  for (const [event, entries] of Object.entries(SETTINGS_HOOKS)) {
    hooks[event] = [...(hooks[event] ?? []), ...entries];
  }
  settings.hooks = hooks;

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log("lore: hooks registered in .claude/settings.json");
  console.log("lore: tracking: session, prompts, file changes");
  console.log(
    "lore: ready. session tracking will begin on next Claude Code session.",
  );
}
