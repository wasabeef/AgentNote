# lore — 調査レポート

> AI Agent セッション履歴を Git に紐づけて管理する仕組みの調査と、Claude Code + GitHub のみで再現する設計。

## 目次

- [1. entire.io 調査](#1-entireio-調査)
- [2. Claude Code Hooks システム](#2-claude-code-hooks-システム)
- [3. Git メタデータ格納方法](#3-git-メタデータ格納方法)
- [4. 再現アーキテクチャ設計](#4-再現アーキテクチャ設計)

---

## 1. entire.io 調査

### 概要

| 項目 | 詳細 |
|---|---|
| URL | https://entire.io / https://github.com/entireio/cli |
| License | MIT |
| GitHub Stars | 3.8k |
| 言語 | Go 1.25+ |
| 資金調達 | $60M seed round |
| Docs | https://docs.entire.io |

### 作成された目的

Git は「**what** changed」を記録するが「**why** changed」は記録しない。AI Agent がコードを書く時代において、Agent の reasoning / prompt / tool 実行ログという「なぜ」の情報は session 終了とともに消失する。entire はこのギャップを埋める developer platform。

核心的な課題意識：

- AI Agent の session は揮発性 — terminal や context window の中にしか存在せず、session 終了で消失
- Git commit からは Agent がなぜそのコードを書いたか追跡できない
- Agent session の途中状態に巻き戻し・再開したいニーズ
- Git history はクリーンに保ちたい（Agent メタデータで汚さない）

### 実現できること

| 機能 | 説明 |
|---|---|
| **Session Capture** | Agent の各ターン完了時 & Git commit 時に working tree + transcript のスナップショットを自動保存 |
| **Checkpoint 管理** | 一時スナップショット → shadow branch、commit 時 → permanent metadata branch |
| **Rewind** | Agent が暴走した時に過去の checkpoint に巻き戻し |
| **Resume** | 別マシン・別メンバーでもセッション再開可能 |
| **Explain** | Checkpoint の AI サマリー生成 |
| **Secret Redaction** | gitleaks v8 で API key 等を自動検出・除去 |
| **Clean Git History** | active branch には一切触らず、メタデータは orphan branch に分離 |

Checkpoint に記録される内容：

- 完全な session transcript
- 元の prompt / リクエスト
- 変更ファイル一覧
- token 消費量の metrics
- tool 実行ログ
- reasoning の完全な trail

### CLI 実装

#### Tech Stack

| 技術 | 用途 |
|---|---|
| Go 1.25+ | メイン言語 |
| `spf13/cobra` | CLI コマンド管理 |
| `charmbracelet/huh` | Interactive TUI/prompts |
| `charmbracelet/lipgloss` | Terminal styling |
| `go-git/go-git` v6 | Git 操作（checkout/reset は git CLI にフォールバック） |
| `zricethezav/gitleaks` v8 | Secret 検出・除去 |
| `zalando/go-keyring` | Credential storage |
| `posthog/posthog-go` | Telemetry（opt-out 可） |
| mise | Build/task runner |
| goreleaser | Release |

#### アーキテクチャ（レイヤー構成）

```
cmd/entire/main.go              → Entry Point
cmd/entire/cli/root.go          → Root command (cobra)
cmd/entire/cli/agent/           → Agent 実装 (共通 interface)
  ├── claude-code/
  ├── gemini/
  ├── cursor/
  ├── opencode/
  ├── factory/
  └── copilot/
cmd/entire/cli/strategy/        → ManualCommitStrategy (checkpoint, condensation, rewind)
cmd/entire/cli/session/         → Session state machine (ACTIVE → IDLE → ENDED)
cmd/entire/cli/checkpoint/      → Storage (shadow branch → permanent metadata branch)
cmd/entire/cli/auth/            → Device auth flow
cmd/entire/cli/settings/        → Settings loading
cmd/entire/cli/logging/         → Internal debug logging
cmd/entire/cli/telemetry/       → PostHog analytics
redact/                         → Secret redaction module
e2e/                            → E2E tests (Vogon = deterministic fake agent)
```

#### 設計パターン

- **Strategy pattern** — `Strategy` interface で将来の拡張に対応（現在は `ManualCommitStrategy` のみ）
- **Agent abstraction** — 各 Agent が共通 `agent.Agent` interface を実装、hook payload を共通 `agent.Event` に正規化
- **Session phase state machine** — `ACTIVE` ⇄ `IDLE` → `ENDED`、event (`TurnStart`/`TurnEnd`/`GitCommit`/`SessionStop`) で遷移、`ActionCondense` 等の action を emit
- **Shadow branches** — 一時データ: `entire/<hash>-<id>`、commit 時に `entire/checkpoints/v1` orphan branch へ condensation
- **Checkpoint ID linking** — 12-hex-char random ID で user commit ⇄ metadata を双方向リンク（`Entire-Checkpoint` trailer）
- **Silent error pattern** — user-friendly メッセージ出力済みの場合に `SilentError` を返し cobra の重複出力を防止

#### 対応 Agent

| Agent | Hook 場所 | Status |
|---|---|---|
| **Claude Code** | `.claude/settings.json` | Full support |
| Gemini CLI | `.gemini/settings.json` | Preview |
| OpenCode | `.opencode/plugins/entire.ts` | Preview |
| Cursor | `.cursor/hooks.json` | Preview (no rewind) |
| Factory AI Droid | `.factory/settings.json` | Preview |
| Copilot CLI | `.github/hooks/entire.json` | Preview |

#### Install

```bash
curl -fsSL https://entire.io/install.sh | bash
# or
brew install entireio/tap/entire
# or
go install github.com/entireio/cli/cmd/entire@latest
```

---

## 2. Claude Code Hooks システム

### Lifecycle Events（28 種）

#### Core Session Events

| Event | 説明 |
|---|---|
| `SessionStart` | Session 開始・再開 |
| `SessionEnd` | Session 終了 |
| `InstructionsLoaded` | CLAUDE.md やルールファイルの読込 |
| `UserPromptSubmit` | ユーザーが prompt 送信（処理前） |

#### Tool Execution Events

| Event | 説明 |
|---|---|
| `PreToolUse` | ツール実行前（ブロック可） |
| `PostToolUse` | ツール成功後 |
| `PostToolUseFailure` | ツール失敗後 |
| `PermissionRequest` | 権限ダイアログ表示時 |
| `PermissionDenied` | auto mode でツール拒否時 |

#### Notification & Async Events

| Event | 説明 |
|---|---|
| `Notification` | Claude がユーザー入力を必要とする時 |
| `Stop` | Claude の応答完了時 |
| `StopFailure` | API エラーでターン終了時 |
| `CwdChanged` | Working directory 変更時 |
| `FileChanged` | 監視ファイルのディスク変更時 |
| `ConfigChange` | 設定ファイル変更時 |

#### Agent & Task Events

| Event | 説明 |
|---|---|
| `SubagentStart` | Subagent 生成時 |
| `SubagentStop` | Subagent 完了時 |
| `TeammateIdle` | Agent team の teammate がアイドル移行時 |
| `TaskCreated` | TaskCreate でタスク作成時 |
| `TaskCompleted` | タスク完了マーク時 |

#### Worktree & Context Events

| Event | 説明 |
|---|---|
| `WorktreeCreate` | Git worktree 作成時 |
| `WorktreeRemove` | Git worktree 削除時 |
| `PreCompact` | Context compaction 前 |
| `PostCompact` | Context compaction 後 |
| `Elicitation` | MCP server がユーザー入力要求時 |
| `ElicitationResult` | ユーザーが MCP elicitation に応答時 |

### Hook に渡されるデータ

#### 共通入力フィールド（全 Event）

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "default|plan|auto|...",
  "hook_event_name": "PreToolUse",
  "agent_id": "agent-123",
  "agent_type": "Explore"
}
```

#### Event 固有フィールド

| Event | 追加フィールド |
|---|---|
| `PreToolUse` | `tool_name`, `tool_input` |
| `PostToolUse` | `tool_result`, `token_usage` |
| `SessionStart` | `source` ("startup"/"resume"/"clear"/"compact"), `model`, `agent_type` |
| `UserPromptSubmit` | `prompt` |
| `FileChanged` | `file_path` |
| `CwdChanged` | 新ディレクトリパス |
| `ConfigChange` | `source`, `file_path` |
| `SubagentStart/Stop` | agent name, type |

#### 環境変数

```bash
$CLAUDE_PROJECT_DIR        # プロジェクトルート
$CLAUDE_ENV_FILE           # SessionStart/CwdChanged/FileChanged のみ
$CLAUDE_PLUGIN_ROOT        # Plugin インストールディレクトリ
$CLAUDE_PLUGIN_DATA        # Plugin 永続データディレクトリ
```

### Session Transcript の保存場所

```
~/.claude/
  └── projects/
      └── <hash-of-project-path>/
          └── sessions/
              └── <session-uuid>.jsonl   ← 完全な会話記録
```

- Hook には `transcript_path` として完全パスが渡される
- フォーマット: JSONL（JSON Lines）— 1 行 1 JSON オブジェクト
- 内容: メッセージ単位の記録、tool calls（入出力）、ターン毎の token 数、model、cwd、git state

### settings.json の Hook 定義フォーマット

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "pattern",
        "hooks": [
          {
            "type": "command|http|prompt|agent",
            "if": "Bash(git *)",
            "timeout": 600,
            "statusMessage": "Custom message",
            "command": "path/to/script.sh",
            "async": false,
            "shell": "bash"
          }
        ]
      }
    ]
  }
}
```

#### Hook タイプ

| Type | 説明 |
|---|---|
| `command` | Shell コマンド実行 |
| `http` | HTTP POST でイベント JSON を送信 |
| `prompt` | 単一 LLM 評価（Haiku デフォルト） |
| `agent` | Subagent 生成（ツールアクセス付き） |

#### Matcher パターン

| Event | Matcher 対象 | 例 |
|---|---|---|
| PreToolUse, PostToolUse | ツール名 regex | `Bash`, `Edit\|Write` |
| SessionStart | session source | `startup\|resume` |
| FileChanged | ファイル名 | `.env\|.envrc` |
| SubagentStart/Stop | agent type | `Explore\|Plan` |

#### Hook 出力（Exit Code）

| Exit Code | 動作 |
|---|---|
| **0** | 続行。stdout を JSON parse、`additionalContext` を Claude に注入 |
| **2** | ブロック。stderr が Claude へのフィードバックに |
| **その他** | 続行、stderr はログのみ |

---

## 3. Git メタデータ格納方法

### 比較表

| 方法 | 長所 | 短所 | 適用先 |
|---|---|---|---|
| **Git Notes** | SHA-indexed で O(1) lookup、commit 不変 | GitHub UI 非表示、push/fetch 明示必要、merge conflict | Quick lookup |
| **Orphan Branch** | フル filesystem、GitHub UI 閲覧可、Actions trigger 可 | Commit との link は論理的（構造的でない） | Transcript storage |
| **Commit Trailers** | Lightweight、cherry-pick/rebase 耐性 | 既存 commit への追加は SHA 書換、容量小 | Commit linking |
| **GitHub Actions** | Orphan branch push で trigger 可 | Notes push では trigger 不可 | Automation |

### Git Notes

```bash
# カスタム namespace で note 追加
git notes --ref=lore add -m '{"session_id":"..."}' <commit-sha>

# 読取
git notes --ref=lore show <commit-sha>

# Push/Fetch（デフォルトでは同期されない）
git push origin refs/notes/lore
git fetch origin refs/notes/lore:refs/notes/lore
```

### Orphan Branch + Worktree パターン

```bash
# 初回セットアップ: orphan branch 作成
git checkout --orphan lore/v1
git rm -rf .
git commit --allow-empty -m "init lore"
git checkout -

# Worktree で main branch を離れずに操作
git worktree add .lore lore/v1

# データ書込（main branch にいたまま）
cat > .lore/sessions/<session-id>.json << 'EOF'
{"transcript": "..."}
EOF

git -C .lore add -A
git -C .lore commit -m "checkpoint for <commit-sha>"
git -C .lore push origin lore/v1
```

`.lore` を `.gitignore` に追加して main から不可視にする。

### Commit Trailers

```bash
# Commit 時に trailer 追加
git commit -m "feat: add auth" --trailer "Context-Session-Id: sess_abc123"

# Trailer 検索
git log --all --grep="Context-Session-Id: sess_abc123"

# Trailer 抽出
git log -1 --format="%(trailers:key=Context-Session-Id,valueonly)" HEAD
```

### GitHub Actions Trigger

```yaml
# .github/workflows/lore.yml
name: Process Context History
on:
  push:
    branches:
      - lore/v1

jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: lore/v1
      - name: Process session data
        run: |
          git diff --name-only HEAD~1 HEAD -- sessions/
```

---

## 4. 再現アーキテクチャ設計

### 全体構成

```
┌─────────────────────────────────────────────────┐
│  Claude Code Session                            │
│                                                 │
│  hooks (settings.json)                          │
│  ├── SessionStart  → init session tracking      │
│  ├── UserPromptSubmit → log prompt              │
│  ├── Stop          → create checkpoint          │
│  └── PreToolUse(Bash: git commit) → finalize    │
└──────────────┬──────────────────────────────────┘
               │ transcript_path, session_id, cwd
               ▼
┌─────────────────────────────────────────────────┐
│  Hook Script (bash)                             │
│                                                 │
│  1. Read transcript from transcript_path        │
│  2. Extract metadata (tokens, tools, prompts)   │
│  3. Redact secrets (regex patterns)             │
│  4. Write to orphan branch via worktree         │
│  5. Add git note for quick lookup               │
│  6. Add commit trailer (at commit time)         │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Git Storage Layer                              │
│                                                 │
│  [orphan branch: lore/v1]            │
│  ├── sessions/                                  │
│  │   └── <session-id>.jsonl  (full transcript)  │
│  ├── checkpoints/                               │
│  │   └── <checkpoint-id>.json (metadata)        │
│  └── index.json              (session index)    │
│                                                 │
│  [git notes: refs/notes/lore]        │
│  └── <commit-sha> → checkpoint-id mapping       │
│                                                 │
│  [commit trailers on main branch]               │
│  └── Context-Session-Id: <session-id>           │
└──────────────┬──────────────────────────────────┘
               │ git push
               ▼
┌─────────────────────────────────────────────────┐
│  GitHub Actions (on push to lore/v1) │
│  ├── Index sessions → searchable summary        │
│  ├── Generate AI explain (optional)             │
│  └── PR comment with session context            │
└─────────────────────────────────────────────────┘
```

### 機能マッピング

| entire.io 機能 | 再現方法 |
|---|---|
| Session Capture | Claude Code hooks (`Stop`/`UserPromptSubmit`) → `transcript_path` から JSONL 読取 |
| Checkpoint Storage | Orphan branch `lore/v1` + git worktree |
| Commit Linking | Commit trailer `Context-Session-Id: <id>` |
| Quick Lookup | Git notes `--ref=lore` |
| Rewind | Orphan branch から working tree snapshot を復元 |
| Resume | Orphan branch 上の session metadata を読み出し |
| Secret Redaction | Hook script 内で regex pattern matching |
| Automation | GitHub Actions on orphan branch push |

### ファイル構成

```
.claude/
├── settings.json              ← hooks 定義
└── scripts/
    ├── context-capture.sh     ← メイン hook script
    ├── checkpoint.sh          ← checkpoint 作成
    ├── rewind.sh              ← checkpoint 復元
    ├── resume.sh              ← session 再開
    └── lib/
        ├── transcript.sh      ← JSONL パーサー
        ├── redact.sh          ← secret redaction
        └── storage.sh         ← orphan branch 操作

.github/
└── workflows/
    └── lore.yml    ← orphan branch push trigger
```

### hooks 定義

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": ".claude/scripts/context-capture.sh",
        "async": true
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": ".claude/scripts/checkpoint.sh",
        "async": true
      }]
    }],
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "if": "Bash(git commit *)",
        "command": ".claude/scripts/context-capture.sh --finalize"
      }]
    }]
  }
}
```

### Checkpoint データ構造

```json
{
  "id": "a1b2c3d4e5f6",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "commit_sha": "abc1234",
  "timestamp": "2026-04-02T10:30:00Z",
  "branch": "feature/auth",
  "prompt_summary": "JWT refresh token impl",
  "files_changed": ["src/auth.ts", "src/middleware.ts"],
  "token_usage": { "input": 12000, "output": 3400 },
  "tools_used": ["Edit", "Bash", "Read"],
  "transcript_ref": "sessions/550e8400.jsonl:L120-L180"
}
```

### コマンド対応表

| entire.io | 再現コマンド | 実装方法 |
|---|---|---|
| `entire enable` | `./setup.sh` | `jq` で `.claude/settings.json` に hooks 注入 |
| `entire status` | `./status.sh` | `.git/context-sessions/<id>.json` を読取 |
| `entire explain` | `./explain.sh` | `claude -p "summarize this session" < transcript.jsonl` |
| `entire rewind` | `./rewind.sh` | orphan branch から snapshot 取得 → `git checkout` |
| `entire resume` | `./resume.sh` | orphan branch の metadata を復元 → `claude -r` |

### トレードオフ

| 観点 | entire.io | DIY (Claude Code + GitHub) |
|---|---|---|
| セットアップ | `entire enable` 1 コマンド | scripts 群の初期構築が必要 |
| Agent 対応 | 6 Agent | Claude Code のみ（目的に合致） |
| Shadow branch | go-git で高速操作 | shell + git worktree（やや遅い） |
| State machine | Go 製、堅牢 | Shell script、シンプルだが脆い |
| Secret redaction | gitleaks 統合 | regex ベース or gitleaks CLI 呼出 |
| メンテナンス | OSS コミュニティ | 自前保守 |
| カスタマイズ性 | Agent interface 準拠 | **完全自由** |

### 段階的実装計画

#### Phase 1 — 最小限の Session Capture

- `Stop` hook → transcript を orphan branch にコピー
- Commit trailer で session-id を紐付け
- 最小限の metadata（session_id, timestamp, files_changed）

#### Phase 2 — Checkpoint & Rewind

- Working tree snapshot の保存・復元
- Git notes で高速 lookup
- `rewind.sh` / `resume.sh` の実装

#### Phase 3 — GitHub Actions 連携

- PR に session context を自動コメント
- Session index の生成
- AI explain（`claude -p` 活用）

---

## 参考リンク

- [entire.io](https://entire.io/)
- [entireio/cli (GitHub)](https://github.com/entireio/cli)
- [entire.io Docs](https://docs.entire.io)
- [Claude Code Hooks Guide](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [DeepWiki — entireio/cli](https://deepwiki.com/entireio/cli)
