# entire.io 問題分析 & 回避設計

> **注意: この文書は初期設計時 (agentnote プロジェクト) に作成されたもので、現在の agentnote 実装とは乖離があります。**
> 特に git hooks の使用、notes の auto-push、multi-agent 対応方針は実装時に変更されました。
> 最新の設計は `DESIGN.md` を参照してください。

> entire CLI の既知の問題点を洗い出し、agentnote プロジェクトで引き継がない設計指針を定める。
> 対象スコープ: **Claude Code のみ**。

## 目次

- [1. 問題一覧](#1-問題一覧)
- [2. カテゴリ別詳細分析](#2-カテゴリ別詳細分析)
- [3. 回避設計](#3-回避設計)
- [4. 設計原則](#4-設計原則)

---

## 1. 問題一覧

> 情報源: DeepWiki コードベース分析 + GitHub Issues（133 open issues, 2026-04-02 時点）

### Critical（データ破壊・損失・重大パフォーマンス障害）

| # | カテゴリ | 問題 | 出典 |
|---|---|---|---|
| P-01 | Git 整合性 | `git gc --auto` が worktree index を破壊 → staged changes 消失 | DeepWiki |
| P-02 | Git 整合性 | go-git v5 の checkout/reset が `.entire/` 等の untracked dir を誤削除 | DeepWiki |
| P-03 | データ破壊 | `.git/config` の `user.name` を literal `"user.email"` に上書き → **72 commits の author 破壊** | #456 |
| P-04 | データ損失 | crash/kill 時に Stop hook 未発火 → 孤立 checkpoint、自動修復なし | DeepWiki |
| P-05 | パフォーマンス | Orphaned subagent sessions 蓄積 → **post-commit 2 分 44 秒ブロック、1.7GB+ RAM/process** | #591 |
| P-06 | パフォーマンス | Git LFS リポジトリで shadow branch commit が **63 秒**（バイナリ全体をハッシュ化） | #433 |
| P-07 | 信頼性 | **コア機能**: Checkpoint trailer が付与されない — 複数の未解決バグ | #768, #686, #784, #779 |
| P-08 | ストレージ | Checkpoint ごとに session 全 transcript を full snapshot 保存 → O(n²) 肥大 | DeepWiki |
| P-09 | セキュリティ | Public repo で session transcript（prompt, reasoning, tool log）が全世界に公開 | DeepWiki |
| P-10 | データ破壊 | 既存 git hooks をサイレント上書き、`disable` で元に戻らない | #261 |

### High（機能障害・セキュリティ・互換性）

| # | カテゴリ | 問題 | 出典 |
|---|---|---|---|
| P-11 | Git 整合性 | `git commit --amend -m` で Checkpoint trailer 消失 | DeepWiki |
| P-12 | Git 互換性 | Negative refspecs (`^refs/heads/...`) 未対応 → 全コマンド crash | #778 |
| P-13 | Git 互換性 | Git reftable storage（git 3.0 デフォルト）未対応 | #547 |
| P-14 | Git 互換性 | Submodules のある repo で session 初期化失敗 | #640 |
| P-15 | Git 互換性 | `extensions.worktreeConfig=true` の worktree で hooks 失敗 | #546 |
| P-16 | セキュリティ | AWS Access Key ID が redact されない（entropy 3.68 < 閾値 4.5） | #253 |
| P-17 | セキュリティ | GPG signing (`commit.gpgsign=true`) を無視 → 署名なし commit | #311 |
| P-18 | セキュリティ | Shadow branch に未 redact データが残存（手動 push で漏洩） | DeepWiki |
| P-19 | セキュリティ | PostHog telemetry がデフォルト ON | DeepWiki |
| P-20 | セキュリティ | Device auth flow で entire.io にデータ送信（vendor lock-in） | DeepWiki |
| P-21 | 信頼性 | Session 再開後に `prepare-commit-msg` が未実行 | #411 |
| P-22 | 信頼性 | Agent が commit & push を同一ターンで行うと checkpoint が push されない | #303, #275 |
| P-23 | 信頼性 | Remote checkpoint (`checkpoint_remote`) が機能しない、サイレント fallback | #800, #805 |
| P-24 | 副作用 | `entire@local` author の push が Vercel CI/CD を破壊 | #239 |
| P-25 | 副作用 | Checkpoint branch push が GitHub "Compare & PR" バナーを毎回表示 | #289 |

### Medium（パフォーマンス・データ品質・UX）

| # | カテゴリ | 問題 | 出典 |
|---|---|---|---|
| P-26 | パフォーマンス | PostCommit hook が session 数に線形スケール（40-60ms/session） | DeepWiki |
| P-27 | パフォーマンス | go-git の packed-refs 毎回フルスキャン（キャッシュなし） | DeepWiki |
| P-28 | パフォーマンス | Hooks 全体で Claude Code の起動/終了が大幅遅延 | #450 |
| P-29 | パフォーマンス | JSONL transcript をフルメモリロード → 15MB × N sessions でメモリ爆発 | #591 |
| P-30 | データ品質 | Token usage が累積値 → checkpoint 間で二重計上 | DeepWiki |
| P-31 | データ品質 | Per-file prompt attribution なし | DeepWiki |
| P-32 | データ品質 | Attribution（agent/human 貢献度）が常に 0% | #421 |
| P-33 | データ品質 | History rewrite（rebase, squash, force-push）で checkpoint metadata 喪失 | #321 |
| P-34 | 信頼性 | 同一 dir の並行 session で spurious checkpoint 生成 | DeepWiki |
| P-35 | 信頼性 | Concurrent map read/write による panic（PIIConfig race condition） | #799 |
| P-36 | UX | サブディレクトリから起動すると初期化されない | #559 |
| P-37 | UX | GUI アプリ（Xcode 等）で `entire: command not found`（PATH 未解決） | #489 |
| P-38 | UX | Exit code が常に 1（エラーハンドリング不可） | #256, #263 |
| P-39 | 設計 | Multi-agent 対応の複雑性（6 Agent 抽象化コスト） | DeepWiki |
| P-40 | 設計 | Path 処理の不整合（os.Getwd vs repo root） | DeepWiki |
| P-41 | 依存性 | go-git バグ回避の workaround 群（保護ラッパー多数） | DeepWiki |
| P-42 | 欠落機能 | 検索コマンド (`entire search`) が未実装 | #679 |
| P-43 | 欠落機能 | `.entireignore` 未対応（LFS/大規模バイナリ除外不可） | GitHub |
| P-44 | 欠落機能 | Stealth mode 不在（checkpoint branch を隠せない） | #645 |

---

## 2. 問題の構造分析

### 根本原因 Top 5

entire の 44 問題を遡ると、**5 つの根本原因**に集約される:

| 根本原因 | 該当問題数 | 代表的な問題 |
|---|---|---|
| **go-git ライブラリ依存** | 10 | P-01, P-02, P-12 〜 P-15, P-27, P-29, P-35, P-41 |
| **同期 hook + 全 session スキャン** | 7 | P-05, P-06, P-26, P-28, P-29, P-34, P-38 |
| **Full snapshot ストレージモデル** | 5 | P-08, P-29, P-30, P-32, P-33 |
| **Git hook 上書き/副作用** | 6 | P-03, P-07, P-10, P-21, P-24, P-25 |
| **Multi-agent 抽象化の複雑性** | 5 | P-22, P-23, P-37, P-39, P-43 |

### 最も深刻な 3 つの問題パターン

**1. コア機能の信頼性欠如** (P-07, P-21, P-22)

Checkpoint trailer が付与されないバグが**複数**未解決。entire のコアバリュー「commit と session の紐付け」自体が壊れている。原因は Git hook lifecycle の複雑な状態遷移と、multi-agent 対応による条件分岐の爆発。

**2. パフォーマンスの構造的欠陥** (P-05, P-06, P-26, P-28, P-29)

同期 hook × 全 session スキャン × フルメモリ transcript ロード。real-world リポジトリで **commit 2 分 44 秒、RAM 1.7GB+**。これはアーキテクチャレベルの問題であり、パッチでは解決しない。

**3. go-git が標準 Git の壁** (P-01, P-02, P-12 〜 P-15, P-17)

Negative refspecs, reftable, GPG signing, submodules, worktree extensions... 標準 git の機能が使えない。go-git のバグ回避に保護ラッパーが増殖し、コードベースの複雑性が上がり続ける悪循環。

---

## 3. 回避設計

### 3.1 Git 操作

| 問題 | entire の方式 | agentnote の方式 |
|---|---|---|
| P-01 gc 破壊 | go-git loose objects + gc.auto 無効化 | **git CLI のみ使用**。go-git 不使用。shell script で全 Git 操作 |
| P-02 checkout 誤削除 | go-git + CLI ラッパー | **git CLI のみ使用**。ライブラリ依存なし |
| P-03 trailer 消失 | 独自 trailer 保存ロジック | **git notes に分離**。trailer は補助的リンクのみ。消失しても notes から復元可 |

**原則**: Git 操作は全て `git` CLI 経由。Git library への依存を排除。

### 3.2 データ永続性

| 問題 | entire の方式 | agentnote の方式 |
|---|---|---|
| P-04 crash 孤立 | Stop hook 依存 | **多段防御**: SessionStart で前回未完了 session を検出・修復。定期的な WAL（Write-Ahead Log）で中間状態を保存 |
| P-05 未 redact 一時データ | Shadow branch → condensation 時に redact | **書込前に redact**。一時ストレージにも redact 済みデータのみ保存 |

**原則**: 任意のタイミングで kill されても、次回起動時に一貫した状態に回復可能。

### 3.3 パフォーマンス

| 問題 | entire の方式 | agentnote の方式 |
|---|---|---|
| P-06 線形スケール | 全 session condensation | **active session のみ処理**。session ID で直接参照。全 session スキャン不要 |
| P-07 packed-refs スキャン | go-git | **git CLI**。Git 本体のキャッシュ機構を利用 |

**原則**: Hook 処理は O(1) 。session 数に依存しない。

### 3.4 ストレージ

| 問題 | entire の方式 | agentnote の方式 |
|---|---|---|
| P-08 transcript 重複 | Full snapshot per checkpoint | **差分方式**: entry は前回からの delta のみ保存。full transcript は session 単位で 1 ファイルのみ |

**データモデル**:

```
.git/agentnote/
  └── sessions/
      └── <session-id>/
          ├── transcript.jsonl     ← session 全体の transcript（1 ファイル、追記型）
          ├── metadata.json        ← session メタデータ
          └── entries/
              └── <entry-id>.json  ← delta のみ（行範囲参照 + 差分 metadata）
```

Entry の中身:

```json
{
  "id": "a1b2c3d4e5f6",
  "commit_sha": "abc1234",
  "timestamp": "2026-04-02T10:30:00Z",
  "transcript_range": { "start_line": 120, "end_line": 180 },
  "token_delta": { "input": 2400, "output": 800 },
  "files_changed": ["src/auth.ts"],
  "tools_used": ["Edit", "Bash"]
}
```

**原則**: transcript は 1 箇所に 1 回だけ保存。entry は参照（ポインタ）のみ。

### 3.5 セキュリティ

| 問題 | entire の方式 | agentnote の方式 |
|---|---|---|
| P-09, P-16 redaction | gitleaks + entropy（閾値 4.5 で AWS key 漏洩） | **書込前 redact**。既知パターン（`AKIA*` 等）を明示リスト化 + entropy。`.agentnoteignore` でユーザー定義除外 |
| P-17 GPG signing | 無視 | Git の既存設定を尊重。metadata commit にもユーザーの signing 設定を継承 |
| P-18 shadow 未 redact | condensation 時に redact | **一時データにも redact 済みのみ保存**。平文データの中間状態を作らない |
| P-19, P-20 telemetry/auth | PostHog + entire.io OAuth | **telemetry なし。外部サービス依存なし** |
| P-09 public repo 漏洩 | ユーザー責任 | **デフォルト push 無効**。明示的 opt-in + push 前 redaction 検証 |

### 3.6 データ品質

| 問題 | entire の方式 | agentnote の方式 |
|---|---|---|
| P-30 token 二重計上 | 累積値を各 entry に保存 | **delta 方式**: `token_delta` で差分のみ |
| P-31 file attribution なし | なし | PostToolUse hook で tool → file マッピング記録 |
| P-32 attribution 0% | 壊れている | シンプルに「session 内の変更ファイル一覧」のみ。過度な attribution は行わない |
| P-33 history rewrite で喪失 | commit SHA 依存 | git notes は rebase で消えるため、**orphan branch にも session-id ベースで保存**。SHA 非依存の参照も併用 |

### 3.7 副作用防止

| 問題 | entire の方式 | agentnote の方式 |
|---|---|---|
| P-10 git hooks 上書き | サイレント上書き | 既存 hooks をチェーン (backup + exit status 保持) 。`agentnote init` で `prepare-commit-msg`, `post-commit`, `pre-push` をインストール |
| P-24 CI/CD 破壊 | `entire@local` author | git notes は CI に不可視。trailer はコミットメッセージのみ |
| P-25 GitHub バナー汚染 | metadata branch push | git notes は GitHub UI に表示されない。`pre-push` hook で自動 push |

### 3.8 設計簡素化

| 問題 | entire の方式 | agentnote の方式 |
|---|---|---|
| P-39 multi-agent | 6 Agent 抽象化 | **Claude Code 専用**。抽象化ゼロ |
| P-40 path 不整合 | os.Getwd vs repo root | `git rev-parse --show-toplevel` で常にルート基準 |
| P-41 go-git workaround | 保護ラッパー多数 | git CLI 直接使用。workaround 不要 |
| P-42 検索未実装 | なし | git log + jq で検索。専用コマンド不要 |

---

## 4. 設計原則

entire.io の 44 問題の根本原因分析から導出した設計原則。

> **命名規則**: entire の用語（checkpoint, shadow branch, condensation 等）をそのまま使わない。
> 独自の用語体系で設計し、entire のアーキテクチャからの安易な移植を防ぐ。

### 用語マッピング

| entire の用語 | agentnote の用語 | 理由 |
|---|---|---|
| checkpoint | **entry** | 「agentnote の 1 エントリ」。checkpoint はゲームセーブの暗喩で過剰 |
| shadow branch | — (使わない) | 一時 branch 自体を作らない設計 |
| condensation | — (使わない) | 一時→永続の変換工程自体を排除 |
| `entire/checkpoints/v1` | **`refs/notes/agentnote`** | orphan branch ではなく git notes namespace。branch 汚染なし |
| `Entire-Checkpoint` trailer | **`Agentnote-Session` trailer** | agentnote prefix で統一 |
| session | **session** | そのまま（Claude Code の概念と一致） |
| session state machine | **ファイルベース状態管理** | State machine は過剰。JSON ファイルの有無で状態判定 |
| `entire enable/disable` | **`.claude/settings.json` 直接編集** | 専用コマンド不要。hooks 定義を直接管理 |
| `.entireignore` | **`.agentnoteignore`** | agentnote 固有の除外パターン定義 |
| `entire@local` author | — (使わない) | ユーザーの git config をそのまま継承 |

### 原則一覧

#### 原則 1: Git CLI Only

> Git 操作は全て `git` コマンド経由。Git library への依存を排除する。

**回避**: P-01, P-02, P-12 〜 P-15, P-27, P-35, P-41（go-git 起因の全問題）

#### 原則 2: Crash-Safe by Design

> 任意のタイミングで kill されても、次回起動時に一貫した状態に自動回復する。

**回避**: P-04（孤立 entry）
**実現方法**: `.git/agentnote/pending/` に WAL を書き、SessionStart 時に未完了分を回収。

#### 原則 3: Write-Once, Reference-Many

> Transcript は session 単位で 1 ファイルに追記。Snapshot は行範囲参照のみ。

**回避**: P-08, P-29（transcript 重複 & メモリ爆発）

#### 原則 4: Delta Over Absolute

> Metrics（token usage 等）は前回 snapshot からの差分で記録する。

**回避**: P-30（二重計上）

#### 原則 5: Redact Before Write

> 全データは書込前に redact。平文の中間状態を作らない。

**回避**: P-16, P-18（secret 漏洩）

#### 原則 6: Local-First, Auto-Push

> データはローカルに記録。`pre-push` git hook で自動的にリモートに push。公開リポジトリではプロンプト/レスポンスが公開されることに注意。

**回避**: P-09, P-19, P-20, P-24, P-25（公開漏洩・telemetry・CI 破壊・バナー汚染）

#### 原則 7: Zero External Dependencies

> bash + git + jq で完結。外部サービス・ライブラリ依存ゼロ。

**回避**: P-19, P-20, P-41（vendor lock-in・go-git 依存）

#### 原則 8: O(1) Hook Performance

> Hook は active session のみ処理。session 総数に依存しない。

**回避**: P-05, P-06, P-26, P-28, P-29（パフォーマンス全般）
**実現方法**: `.git/agentnote/active` に current session ID を 1 つだけ保持。スキャン不要。

#### 原則 9: Non-Invasive

> 既存の git hooks を壊さない。git config、CI/CD への影響を最小化。

**回避**: P-03, P-10, P-17, P-24, P-25（git config 破壊・hooks 上書き・CI 破壊）
**実現方法**: `agentnote init` で git hooks をインストール。既存 hooks はチェーン (backup + exit status 保持) 。agent hooks (`.claude/settings.json`) も並行利用。

#### 原則 10: Repository-Root Anchored

> 全ての path は `git rev-parse --show-toplevel` 基準で解決する。

**回避**: P-36, P-40（サブディレクトリ問題・path 不整合）

#### 原則 11: Async by Default

> Hook script は `async: true` で非同期実行。commit/prompt をブロックしない。

**回避**: P-05, P-06, P-28（同期 hook による遅延）
**例外**: PreToolUse（git commit 検知）のみ同期で trailer 追加。

#### 原則 12: No Branch Pollution

> Metadata 用の branch を作成しない。git notes + ローカルファイルで完結。

**回避**: P-25, P-44（GitHub バナー汚染・branch 可視性）
**実現方法**: `refs/notes/agentnote` namespace に全データ格納。branch 一覧に表示されない。
