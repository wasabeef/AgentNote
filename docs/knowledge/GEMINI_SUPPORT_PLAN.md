# Gemini Support Plan

> この文書は Agent Note に Gemini CLI 対応を追加するための実装計画である。
> 2026-04-14 時点のコードベースと Gemini CLI の公開情報を前提に、何が確定していて何が未確定か、
> そしてどの条件なら MVP が成立するかを実装順に固定する。
>
> 2026-04-14 追記:
> Gemini CLI hooks design issue (#9070) および `hookPlanner.ts` ソースの調査で、
> matcher は正規表現として評価されることを確認済み。`write_file|replace` 形式は valid regex alternation として動作する。

## 0. 結論

Gemini CLI 対応は可能であり、adapter + hook handler + テスト + ドキュメントは実装済みである。
一方で、Gemini CLI のシェルツール名・トランスクリプト JSON スキーマは公開情報だけでは確定できない。
したがって、`extractInteractions` は safe fallback（空配列返却）で実装し、
実ファイル入手後にパーサーを実装する必要がある。

この計画では成功条件を 2 段階に分ける。

1. **MVP-A**: session tracking と commit linkage を成立させる
2. **MVP-B**: file-level attribution を成立させる
3. **Stretch**: transcript-driven な prompt/response 復元

現状:

- **MVP-A**: 完了（SessionStart/SessionEnd、BeforeAgent/AfterAgent、heartbeat、trailer 注入）
- **MVP-B**: 完了（BeforeTool/AfterTool による pre-blob 取得 + file_change 記録 + pending-commit パターン）
- **Stretch**: 未完（`extractInteractions` は空配列 fallback。Gemini transcript JSON スキーマ未確定）

## 1. 目的

Gemini CLI を使った作業でも、少なくとも以下を成立させる。

- `agent-note init --agent gemini`
- session と commit の紐付け
- git commit 後の git notes 記録
- `show / log / pr / status` での `agent: gemini` 表示
- file-level attribution（BeforeTool/AfterTool 経由）

余力があれば次も目指す。

- transcript-driven な prompt/response 復元
- line-level attribution

## 2. 非目標

今回の Gemini 対応で、次はやらない。

- website ドキュメントの多言語対応
- GitHub Action 側の変更（不要）
- `extractInteractions` の完全実装（トランスクリプトスキーマ未確定）

## 3. Gemini CLI hooks の仕様

### イベント一覧

| Event | 用途 | AgentNote での使用 |
|---|---|---|
| `SessionStart` | セッション開始 | ✅ `session_start` |
| `SessionEnd` | セッション終了 | ✅ `stop` |
| `BeforeAgent` | prompt 送信前 | ✅ `prompt` (turn increment) |
| `AfterAgent` | agent ループ完了 | ✅ `response` |
| `BeforeTool` | ツール実行前 | ✅ `pre_edit` / `pre_commit` / null fallback |
| `AfterTool` | ツール実行後 | ✅ `file_change` / `post_commit` |
| `BeforeModel` | LLM リクエスト前 | 不使用 |
| `AfterModel` | LLM レスポンス後 | 不使用 |
| `BeforeToolSelection` | ツール選択前 | 不使用 |
| `PreCompress` | コンテキスト圧縮前 | 不使用 |
| `Notification` | 通知 | 不使用 |

### Hook 設定ファイル

- パス: `.gemini/settings.json`（プロジェクトレベル）
- 形式: Claude Code の `.claude/settings.json` と類似した JSON 構造
- matcher: **正規表現**として評価される（`hookPlanner.ts:101` で確認済み）

### ペイロード

全イベント共通:
```json
{
  "session_id": "UUID v4",
  "transcript_path": "/absolute/path",
  "cwd": "/current/working/directory",
  "hook_event_name": "BeforeTool",
  "timestamp": "ISO 8601"
}
```

BeforeTool/AfterTool 追加:
```json
{
  "tool_name": "write_file|replace|shell|...",
  "tool_input": { "file_path": "...", "command": "..." }
}
```

### 同期 hook の要件

- **全 hook がブロッキング**（Gemini agent ループをブロック）
- **BeforeTool** は stdout に `{"decision": "allow"}` を返す必要がある
- その他のイベントは exit code 0 のみで unblock

### ファイル編集ツール

| ツール | tool_input フィールド |
|---|---|
| `write_file` | `file_path`, `content` |
| `replace` | `file_path`, `old_string`, `new_string` |

## 4. 設計判断

### 4.1 Trailer 注入

Gemini の hook stdout は `{"decision": "allow"}` のみ返す仕様。
Claude Code の `hookSpecificOutput.updatedInput` によるコマンド書き換えは不可。
→ **`prepare-commit-msg` git hook 方式**（Codex/Cursor と同パターン）

### 4.2 BeforeTool 同期レスポンス

3 箇所で `{"decision": "allow"}` を stdout に出力:

1. `pre_edit` ケースの末尾
2. `pre_commit` ケース（pending-commit 書き込み後）
3. `parseEvent` が null を返した未認識 BeforeTool（フォールバック）

### 4.3 transcript_path バリデーション

`resolve()` + `${base}${sep}` パターンで prefix trick を防御。
Cursor adapter と同水準のセキュリティ。

### 4.4 pending-commit パターン

Cursor と同一ロジック。`post_commit` の条件分岐を `adapter.name === "cursor" || adapter.name === "gemini"` で共有。

## 5. ファイル構成

### 新規作成

| ファイル | 説明 |
|---|---|
| `packages/cli/src/agents/gemini.ts` | Adapter 本体 (394 行) |
| `packages/cli/src/agents/gemini.test.ts` | テスト (649 行, 51 テストケース) |

### 変更

| ファイル | 変更内容 |
|---|---|
| `packages/cli/src/agents/index.ts` | Registry に `gemini` 追加 (+2 行) |
| `packages/cli/src/commands/hook.ts` | BeforeTool 同期対応 + null fallback + pending-commit (+36 行) |
| `CLAUDE.md` / `AGENTS.md` | Gemini adapter ドキュメント追記 |

## 6. 未確定事項

実装は完了しているが、以下は実際の Gemini CLI で検証が必要。

### 高優先度

1. **Shell ツール名**: `shell|bash|run_command|execute_command` は候補セット。実際の `tool_name` を確認後に `SHELL_TOOLS` Set を調整
2. **`BeforeAgent` の発火頻度**: プロンプトごと発火の前提。セッションごと 1 回の場合は turn attribution が壊れる

### 中優先度

3. **トランスクリプト JSON スキーマ**: `~/.gemini/tmp/<project_hash>/chats/` 内のファイル構造。`extractInteractions` 実装に必要
4. **`<project_hash>` の算出方法**: プロジェクトルートパスから hash への変換ロジック
5. **matcher パイプ区切り**: `hookPlanner.ts` で `new RegExp(matcher)` を確認済みだが、実環境での動作検証が望ましい

### 低優先度

6. **`AfterAgent` の model フィールド**: ペイロードに model 名が含まれるか

## 7. レビュー履歴

| フェーズ | レビュアー | 結果 | 主な指摘 |
|---|---|---|---|
| 計画 | Codex | ⚠️ 条件付き承認 | BeforeAgent 発火頻度、非 BeforeTool unblock 方式、二重パース |
| 実装 | Opus | ✅ 承認 | dirname 動的 import、pre_commit コード重複、path normalization |
| 実装 | Codex | ✅ 条件付き承認 | isValidTranscriptPath の sep 付き検証 |
| テスト | Opus | ⚠️ 条件付き承認 | SHELL_TOOLS 網羅不足、transcript_path traversal テスト |
| テスト | Codex | ❌→✅ | transcript_path 不正パステスト欠落（修正済み） |
| ドキュメント | Opus | ✅ 承認 | transcript 検索パス未記載（stub 段階では合理的省略） |
| ドキュメント | Codex | ✅ 承認 | extractInteractions stub 注記推奨 |
| 外部 (Codex CLI) | Codex | ✅ | matcher 記法 → hookPlanner.ts で regex 確認済み |

## 8. 検証結果

```
npm run build      ✅
npm run typecheck   ✅
npm run lint        ✅
npm test            ✅ (140 tests, 0 fail)
```

## 9. 今後の作業

1. **Gemini CLI 実環境テスト**: `agent-note init --agent gemini` → 実際のセッションでイベント発火を確認
2. **`extractInteractions` 実装**: トランスクリプト JSON ファイルを入手後にパーサーを実装
3. **Shell ツール名の確定**: 実際の BeforeTool イベントで `tool_name` を確認し `SHELL_TOOLS` を調整
4. **tech debt**: `pre_commit` の Gemini/Cursor コード重複を shared helper に抽出（5 つ目の adapter 追加時に検討）
