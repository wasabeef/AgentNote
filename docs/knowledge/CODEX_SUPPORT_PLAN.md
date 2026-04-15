# Codex Support Plan

> この文書は Agent Note に Codex 対応を追加するための詳細実装計画である。
> 実装着手前の設計凍結用ドキュメントとして扱う。
> ここでは「何を作るか」だけでなく、「どこを直すか」「どこで壊れやすいか」「どう段階投入するか」まで定義する。
>
> 2026-04-12 追記:
> この計画書は「実装前計画」として書かれているため、前半には古い前提が残っている。
> 現在のコードベースでは Codex 対応はすでに preview として成立している。
> 読むときは、当初計画よりも「現状メモ」と「残タスク」を優先すること。

## 0. 結論

Codex 対応は可能であり、現在は preview として実装済みである。
当初の課題だった Claude 固定参照の整理、agent-aware な transcript 解決、Codex adapter の追加は完了している。
したがって、この文書の価値は「これから何を作るか」だけでなく、
「なぜ transcript-driven な Codex 実装になったか」を残す点にある。

この計画の基本戦略は次の 3 段階である。

1. Claude 固定参照を registry 経由に置き換える
2. session / note / transcript 解決を agent-aware にする
3. Codex adapter を最小機能で追加し、MVP を成立させる

現状:

- `packages/cli/src/agents/codex.ts` は実装済み
- `init --agent codex` は `.codex/config.toml` と `.codex/hooks.json` を生成する
- transcript-driven な prompt / response / files_touched 復元は成立している
- transcript の patch 行数と commit diff が一致した場合の安全な line-level upgrade は成立している
- status / show / log / pr は Codex note を表示できる

## 1. 目的

Codex を使ったセッションでも、Claude Code と同じように以下を成立させる。

- prompt と commit の紐付け
- AI が編集した file の記録
- line-level attribution
- `agentnote show / log / pr / status` での可視化
- GitHub Action での PR report 集計

MVP では assistant response の完全復元は必須としない。
最重要なのは「どの prompt 群がどの commit を生み、どの file が AI によって変更されたか」が残ること。

## 2. 非目標

今回の Codex 対応で、次はやらない。

- Cursor, Gemini, Copilot まで同時に対応する
- transcript の完全共通化
- adapter 共通 DSL の設計
- セッション並列実行の抜本的再設計
- 既存 note の一括 migration

## 3. 現状

### 3.1 設計上は複数 agent を想定している

`packages/cli/src/agents/types.ts` には `AgentAdapter` がある。
ここには次の責務が定義されている。

- hook 設定の install / remove / isEnabled
- event payload の parse
- transcript の探索
- transcript から interaction 抽出

つまり、設計の方向は正しい。

### 3.2 当初は実装上 Claude Code 固定だった

現在、次の箇所が `claudeCode` を直接 import している。

- `packages/cli/src/commands/init.ts`
- `packages/cli/src/commands/hook.ts`
- `packages/cli/src/commands/status.ts`
- `packages/cli/src/commands/show.ts`
- `packages/cli/src/core/record.ts`

当時はこれにより、adapter が存在していても実質的に切り替え不能だった。
現在はこの制約は解消されている。

### 3.3 commit integration 自体は agent-neutral に近い

以下は比較的 agent 非依存であり、そのまま流用できる。

- git notes への永続化
- `prepare-commit-msg` / `post-commit` / `pre-push`
- blob hash を使う line attribution
- PR report 集計

つまり Codex 対応の本体は「データ収集面の差し替え」にある。

### 3.4 現状の健全性評価

現状の Agent Note は「成り立っていない」状態ではない。
少なくとも CLI 本体の基本機能はすでに成立している。

確認済みの観点:

- `packages/cli` は build が通る
- 既存 test は大半が通る
- `init / hook / show / log / pr / status / commit` に対する test が存在する

現在の健全性評価:

- `build` / `lint` / `typecheck` / `test` は通る
- Codex 用 adapter test と command test が存在する
- Codex は preview だが、MVP は成立している

つまり、現状は「基本機能は成立し、preview として十分使える」が妥当である。

### 3.5 なぜ現状が成立していると言えるか

Claude 前提の最小ループはすでに test で担保されている。

- `init.test.ts` は hook 設定、workflow 生成、notes fetch 設定を確認している
- `hook.test.ts` は session start, prompt, file change, pre-commit trailer injection を確認している
- `show.test.ts` は commit から note を読み、session / ai ratio / prompt 表示を確認している
- `commit.test.ts` は trailer 付与、git note 記録、cross-turn 挙動を確認している

よって Codex 対応は「壊れたものを直す」よりも、「動いている Claude 実装を壊さずに一般化する」作業だと捉えるべきである。

### 3.6 実装開始前の判断

ここで重要なのは、「現状が完全ではない」ことと「現状が成立していない」ことを混同しないことである。

現状の評価は次の通り。

- コア機能は成立している
- Claude 依存が強く、拡張性は不足している
- test の一部が環境依存で、保守性には改善余地がある

この判断は当時として正しかった。
現在はその refactor が完了しており、Codex 対応は preview として稼働している。

## 4. 成功条件

Codex 対応の成功条件を 2 段階で定義する。

### 4.1 MVP 成功条件

- `agentnote init --agent codex` が成立する
- Codex から prompt が記録される
- Codex の file edit が記録される
- `git commit` または `agentnote commit` で git note が作られる
- `agentnote show` が Codex 由来 note を表示できる
- `agentnote log` と `agentnote pr` が崩れない
- line attribution が動く

### 4.2 Post-MVP 成功条件

- assistant response を復元できる
- `status` が active agent を表示できる
- docs が Claude 専用前提でなくなる
- release note で Codex 対応を説明できる

2026-04-12 時点では、この Post-MVP 項目も実質達成済みである。

## 5. 最大の前提条件

Codex 側から何を取得できるかで実装難易度が大きく変わる。

最低限ほしい情報:

- `session_id`
- `prompt`
- `tool_name`
- `file_path`
- `model`

あると望ましい情報:

- `tool_use_id` のような pre/post edit の相関 ID
- transcript path
- assistant response

## 5.1 公式 docs で確認できた Codex facts

2026-04-10 時点で、OpenAI の公式 Codex docs から確認できた事実をここに固定する。

### 確認できたこと

- Codex の user config は `~/.codex/config.toml`
- project config は `.codex/config.toml`
- project-scoped hooks は `.codex/hooks.json`
- hooks 機能は `features.codex_hooks` で有効化する
- `features.codex_hooks` は default で `false`
- hook の common input には `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model` がある
- `UserPromptSubmit` には `prompt` と `turn_id` がある
- `SessionStart` には `source` (`startup` / `resume`) がある
- `Stop` には `last_assistant_message` がある
- `PreToolUse` / `PostToolUse` は現状 Bash のみ
- `PreToolUse` は `Write`, `ApplyPatch`, `MCP`, `WebSearch` など非 shell tool を intercept しない
- `updatedInput` は parse されても未対応で fail open

### ここから言えること

1. Codex でも session / prompt / transcript_path / model は hook から取得できる
2. しかし Claude 実装と同じ「Edit/Write ごとの pre/post blob 捕捉」は、公式 docs ベースではそのまま再現できない
3. また Claude 実装で使っている `PreToolUse Bash(*git commit*)` による command rewrite も、Codex では公式 docs 上は成立しない

この 3 点は、Codex 対応計画の最重要制約である。

## 5.2 `entireio/cli` 実装から確認できた Codex facts

追加情報として、`entireio/cli` の公開実装も確認した。
この実装は、公式 docs だけでは読めなかった「Codex 対応の実用的な落としどころ」を示している。

### 確認できたこと

- agent registry を使って `codex` を built-in agent として登録している
- Codex 用 hook は `.codex/hooks.json` に `SessionStart`, `UserPromptSubmit`, `Stop` を入れている
- `PreToolUse` は hook 名として定義しているが、lifecycle 上は pass-through 扱い
- `features.codex_hooks = true` を project-level `.codex/config.toml` に書いている
- user-level config は汚さず、repo 配下の `.codex/` だけを操作する方針
- Codex transcript は `transcript_path` を session ref として直接使う前提
- transcript の JSONL を解析して prompt を復元している
- transcript の `custom_tool_call` のうち `apply_patch` から file path を抽出している
- transcript の `function_call`, `custom_tool_call`, `custom_tool_call_output` を compact transcript に正規化している
- `Stop` hook では `last_assistant_message` が payload に載るが、lifecycle event としては TurnEnd 用に使っている

### ここから言えること

1. Codex 対応は「hook で file edit を直接拾う」のではなく、「hook で transcript_path を確保し、transcript を後解析する」方式が現実的
2. `.codex/config.toml` と `.codex/hooks.json` の両方を repo-local に管理する設計は妥当
3. `SessionStart` / `UserPromptSubmit` / `Stop` の 3 hook だけで実用レベルの session tracking は成立しうる
4. `apply_patch` が transcript に残るなら、file-level attribution の一部は transcript から復元可能
5. ただし Claude のような pre/post blob 直取りではないので、line-level attribution は別途設計が必要

### Agent Note に直接効く示唆

- Base MVP は transcript-driven に切るべき
- Codex adapter の `findTranscript()` は「探索」より「session 時点で保存した transcript_path を読む」を主にすべき
- `extractInteractions()` は transcript parser 実装でかなり改善できる
- `files_touched` は transcript の `apply_patch` から復元できる可能性が高い
- line attribution だけは still-open issue として残る

2026-04-12 時点では、line attribution も
「transcript の patch 行数と final commit diff が一致したときだけ安全に `method: "line"` へ昇格する」
という形で実装済みである。

## 6. 不確実要素

Codex 対応の不確実要素は次の通り。

| 項目 | 必須度 | ない場合の影響 | 回避策 |
|---|---|---|---|
| Hook 機構 | 高 | 自動収集できない | `agentnote commit` wrapper 中心の運用へ切替 |
| session ID | 高 | commit と prompt を結べない | セッション開始時に独自発番する fallback を検討 |
| file path | 高 | file attribution 不可 | post-edit event が無い場合は line attribution を諦める |
| pre/post 相関 ID | 中 | turn drift 補正が弱くなる | turn 単位のみで attribution する |
| transcript path | 低 | response 復元が難しい | `response: null` で許容 |
| model | 低 | 表示だけ弱くなる | null で許容 |

### 6.1 公式 docs で未確定の点

まだ公式 docs だけでは確定できていない点:

- transcript file の wire format
- transcript 内に tool call / file path / patch 情報が含まれるか
- `apply_patch` や他の非 shell tool の実行履歴が transcript から復元できるか

このため、Codex 対応は次の 2 段階で考える必要がある。

- docs だけで成立する Base MVP
- transcript schema まで確認できた後に成立する Parity MVP

### 6.2 `entireio/cli` を踏まえて確度が上がった点

`entireio/cli` の実装により、次の項目は「未知」から「かなり有望」へ変わった。

- transcript から prompt を復元できる
- transcript から assistant response を復元できる
- transcript から `apply_patch` ベースの modified files を抽出できる

依然として未知な点:

- Codex transcript に常に `apply_patch` が出るか
- shell / exec_command 経由の file change をどこまで recover できるか
- line-level attribution を transcript だけで十分に再構築できるか

## 7. 実装ポリシー

### 7.1 まず Claude 実装を壊さずに一般化する

Codex 対応の初手は新機能追加ではなく、既存機能の構造改善である。
Phase 1 のゴールは「Claude 互換維持」であって「Codex 完成」ではない。

### 7.2 `hook` は agent 明示で呼ぶ

payload 自動判別は避ける。
Codex と Claude の JSON 形式差異は今後も変わりうるため、hook 設定側から agent 名を明示した方がよい。

想定 CLI:

```bash
agentnote hook --agent claude-code
agentnote hook --agent codex

## 12. 現状メモ

Codex 対応の現在地を短く固定しておく。

- 状態: Preview
- commit integration: generated git hooks が主経路
- session / prompt / model / transcript_path: hook から取得
- prompt / response / files_touched: transcript から復元
- line-level attribution: transcript patch 行数が commit diff と一致したときのみ安全に昇格
- fallback: 一致しない場合は `method: "file"`

## 13. 残タスク

Codex 対応の残タスクは、Cursor より小さい。

- transcript schema の変化に備えた parser の保守
- shell / exec 系だけで変更された file を transcript だけでどこまで recover できるかの継続検証
- preview を `full support` に上げるための基準整理
```

ただし Codex では `updatedInput` が未対応のため、
`hook --agent codex` は command rewrite のためではなく、
session / prompt / transcript_path の収集用として設計する必要がある。

### 7.3 session metadata に agent を持たせる

現在 `.git/agentnote/session` は session ID のみを保持している。
この設計は維持してよいが、session directory 側には agent 名を保存する。

想定追加:

- `.git/agentnote/sessions/<session-id>/agent`

これにより次が可能になる。

- `record.ts` が正しい adapter で transcript を読む
- `show.ts` が正しい adapter で transcript を探す
- `status.ts` が active session から active agent を表示する

### 7.4 schema は additive change に留める

git note の schema には `agent` を追加するが、互換性を壊さない。

想定 note:

```json
{
  "v": 1,
  "agent": "codex",
  "session_id": "..."
}
```

ここでは schema version は上げない。
理由は additive field のみであり、既存 consumer を壊さないため。

### 7.5 Claude 非破壊を最優先にする

Codex 対応の最重要条件は、既存 Claude ユーザーの運用を壊さないことである。

そのため次を実施する。

- `agentnote init` のデフォルトは当面 `claude-code` のまま維持する
- Claude adapter の hook 形式は registry 化後も意味的に同一に保つ
- Claude non-regression test を Phase 1 完了条件に含める
- Codex adapter を追加する前に、registry 化だけの段階で一度 Claude 動作を固定する

この方針により、Codex 対応を「Claude の rewrite」ではなく「Claude を保持したままの拡張」にする。

### 7.6 Codex は Claude と同じ方法で追跡しない

これは重要な設計判断である。

Claude:

- agent hook で `Edit/Write` を拾う
- pre/post blob を直接保存できる
- `PreToolUse Bash` で `git commit` command を書き換えられる

Codex:

- 公式 docs 上、hook で拾えるのは Bash 系のみ
- 非 shell file edit は hook からは見えない
- command rewrite は未対応

したがって Codex 対応は「Claude adapter の移植」ではなく、
「Codex に合う別経路の tracking」を設計する必要がある。

### 7.7 Codex は transcript-driven adapter として設計する

`entireio/cli` の実装が示している通り、Codex は次の設計が最も現実的である。

1. hook で `session_id` と `transcript_path` を取る
2. `UserPromptSubmit` で prompt を記録する
3. commit 時または show/pr 時に transcript を解析する
4. `apply_patch` や tool call から file 情報を復元する

これは Agent Note にもそのまま参考になる。

## 8. 追加する概念

### 8.1 Agent Registry

想定新規ファイル:

- `packages/cli/src/agents/index.ts`

責務:

- `AGENTS` map
- `getAgent(name: string): AgentAdapter`
- `getDefaultAgent(): AgentAdapter`
- `hasAgent(name: string): boolean`
- `listAgents(): string[]`

### 8.1.1 `settingsRelPath` 抽象化の見直し

現在の `AgentAdapter` は `settingsRelPath: string` を持っている。
しかし Codex は実質的に次の 2 ファイルを扱う必要がある。

- `.codex/config.toml`
- `.codex/hooks.json`

このため `settingsRelPath` は abstraction として弱い。

見直し候補:

1. `settingsRelPath` を `primaryConfigRelPath` に改名し、補助ファイルは adapter 側で管理する
2. `managedPaths(): string[]` を adapter に追加する
3. `installHooks()` が返す「作成/更新したパス一覧」を `init` が表示に使う

推奨:

- interface の破壊を最小化するため、`settingsRelPath` は残してもよい
- ただし `init` の表示や commit 対象ファイル算出は `managedPaths()` のような新 API に寄せる

### 8.2 Session Metadata Helpers

想定追加先:

- `packages/cli/src/core/constants.ts`
- `packages/cli/src/paths.ts`
- もしくは `packages/cli/src/core/session.ts` 新設

想定追加定数:

- `SESSION_AGENT_FILE = "agent"`

想定 helper:

- `readSessionAgent(sessionDir): Promise<string | null>`
- `writeSessionAgent(sessionDir, agentName): Promise<void>`
- `resolveActiveSessionAgent(): Promise<string | null>`

### 8.3 CLI Agent Option

最初に agent 指定が必要なのは以下。

- `init`
- `hook`

必要なら将来的に:

- `status`
- `show`

ただし `status/show` は session metadata と note から解決できるので、MVP では必須ではない。

### 8.4 Codex Base MVP と Parity MVP

#### Base MVP

公式 docs だけで成立が見込める範囲。

- session 記録
- prompt 記録
- model 記録
- transcript_path 記録
- git hooks による commit integration
- `show / log / pr / status` 非破壊動作

#### Parity MVP

Claude に近い attribution 品質まで狙う範囲。

- AI が触った file の精度ある記録
- line-level attribution
- response 復元の安定化

`entireio/cli` の実装を踏まえると、response 復元と `files_touched` 復元は Base MVP でも狙える可能性がある。
ただし line-level attribution はなお Parity 領域に残す。

Parity MVP は transcript schema の確認または別シグナルの確保が前提になる。

## 9. ファイル別の変更計画

ここでは「どのファイルに何を入れるか」を明確にする。

### 9.1 `packages/cli/src/agents/types.ts`

変更内容:

- `AgentAdapter` は基本維持
- optional にすべきメソッドがあるか再検討

判断:

- `findTranscript()` と `extractInteractions()` は残す
- Codex が transcript を持たない場合でも、空配列と null を返せばよい
- interface 自体の breaking change は避ける
- ただし config 管理ファイルが複数ある agent を表現できるよう補助 API を追加する

### 9.2 `packages/cli/src/agents/claude-code.ts`

変更内容:

- logic は基本維持
- `HOOK_COMMAND` を `agentnote hook --agent claude-code` に変更
- 可能なら transcript base path 判定関数を adapter 内 private helper として明確化

注意:

- 既存 `init.test.ts` は `.claude/settings.json` の具体文字列を見ているため、hook command 変更に追従が必要

### 9.3 `packages/cli/src/agents/codex.ts`

新規追加。

責務:

- Codex の設定ファイルに hook を入れる
- Codex の raw event を `NormalizedEvent` に変換する
- transcript 探索と interaction 抽出を行う

Codex の公式 docs から見えている要件:

- `.codex/config.toml` に `features.codex_hooks = true` を入れる必要がある
- `.codex/hooks.json` を生成または更新する必要がある
- common input から `session_id`, `transcript_path`, `model`, `cwd` を取れる
- `UserPromptSubmit` から `prompt` を取れる
- `Stop` から `last_assistant_message` を取れる可能性がある

Base MVP では transcript が使えない場合、次でもよい。

- `findTranscript()` は session dir に保存した `transcript_path` 依存
- `extractInteractions()` は空配列または prompt fallback

ただし重要な注意:

- Bash hook だけでは file edit を捕捉できないため、Codex adapter 単体で Claude 相当の attribution は保証できない

`entireio/cli` を踏まえた改善案:

- `extractInteractions()` は空配列 fallback ではなく、Codex JSONL transcript parser を実装対象にする
- parser は少なくとも次を扱う
  - `response_item` + `message` + `role=user`
  - `response_item` + `message` + `role=assistant`
  - `response_item` + `custom_tool_call` + `name=apply_patch`
  - `response_item` + `function_call`
  - `response_item` + `*_output`

これにより `response` と `files_touched` の精度を大きく上げられる。

その場合でも note は prompt ベースで成立する。

### 9.4 `packages/cli/src/agents/index.ts`

新規追加。

責務:

- adapter registry
- agent 名の正規化
- unknown agent の error 化

agent 名の canonical 候補:

- `claude-code`
- `codex`

alias 候補:

- `claude`
- `codex-cli`

### 9.5 `packages/cli/src/cli.ts`

変更内容:

- 現状は command と args を単純に切っているだけ
- `hook` と `init` の `--agent` を下流で解釈するだけなら大改修は不要

判断:

- ここでは parser を大きくしない
- `init(args)` / `hook(args)` の形にして下流で parse するのが安全

必要変更:

- `hook()` を `hook(args)` に変更

### 9.6 `packages/cli/src/commands/init.ts`

変更内容:

- `claudeCode` の直接参照をやめる
- `--agent <name>` を追加
- 既定値をどうするか決める

推奨仕様:

- `agentnote init` は当面 `claude-code` を default にして後方互換維持
- `agentnote init --agent codex` で Codex 用設定

将来的な候補:

- `--all-agents`

MVP では不要。

出力文言変更:

- `.claude/settings.json` 固定の表示をやめる
- adapter の `settingsRelPath` を使って表示する

Codex 向け追加要件:

- `.codex/config.toml` の生成または merge
- `.codex/hooks.json` の生成または merge
- `features.codex_hooks = true` を設定

ここでの難所:

- TOML merge と JSON merge の両方が必要
- 既存 `.codex/config.toml` や `.codex/hooks.json` を壊さない idempotent 更新が必要

### 9.7 `packages/cli/src/commands/hook.ts`

変更内容:

- `claudeCode` 直接参照を削除
- `hook(args)` にして `--agent` を必須または準必須にする
- `session_start` 時に session dir へ agent 名を書き込む

推奨仕様:

- `--agent` 必須
- 未指定なら終了コード 1

理由:

- payload 自動判別を避けたい
- agent 名不明で誤って event を捨てるより、設定ミスとして即失敗の方がよい

session start 時の追加保存:

- session ID
- transcript path
- agent 名

Codex の official docs を踏まえた補足:

- `SessionStart` で `transcript_path` を保存できる
- `UserPromptSubmit` で `prompt` を保存できる
- `Stop` で `last_assistant_message` を将来的に保存候補にできる
- ただし `PreToolUse` / `PostToolUse` は Bash のみなので、Codex 用 `hook.ts` 分岐では file edit 用の既存ロジックを流用できない

### 9.8 `packages/cli/src/commands/status.ts`

変更内容:

- `claudeCode` の直接参照をやめる
- active session があれば session dir から agent を引く
- `hooks: active` の意味を「default agent が有効」から「active agent or selected agent が有効」へ明確化する

MVP 表示案:

```text
hooks:   active (codex)
session: a1b2c3d4…
agent:   codex
linked:  3/20 recent commits
```

### 9.9 `packages/cli/src/commands/show.ts`

変更内容:

- `claudeCode.findTranscript()` 直接参照を削除
- note から `agent`、無ければ session dir の agent、最後に default agent で解決
- transcript 表示は agent ごとの adapter で行う

MVP 表示案:

- `agent:   codex` を `model` の前後に追加

### 9.10 `packages/cli/src/core/record.ts`

最重要変更。

変更内容:

- `claudeCode.extractInteractions()` 直接参照をやめる
- session dir の agent metadata から adapter を選ぶ
- transcript pairing は agent ごとに行う

必要 helper:

- `resolveSessionAdapter(sessionDir): Promise<AgentAdapter>`

fallback 順序:

1. session dir の `agent`
2. note or args の agent
3. default agent

注意:

- Claude 既存 session には `agent` file がない
- その場合でも Claude として読める必要がある

Codex 向け重要論点:

- Claude は `changes.jsonl` と `pre_blobs.jsonl` があるので line attribution が成立する
- Codex は公式 docs の範囲ではそれを hook から作れない

したがって `record.ts` には agent 別の attribution policy が必要になる可能性がある。

候補:

1. `agent === "claude-code"` のときのみ現行 line attribution
2. `agent === "codex"` は transcript から file event を復元できる場合のみ line attribution
3. それ以外は `method: "file"` または `method: "none"` へ degrade

この degrade を仕様として許容するかは、実装前に合意が必要。

`entireio/cli` を踏まえた補強:

- Codex では transcript parser から `files_touched` を作り、`by_ai` 判定は file-level までは持っていける見込みがある
- ただし pre/post blob がない限り、現行の 3-diff line attribution をそのまま適用するのは難しい
- よって Agent Note では当面
  - Claude: `method: "line"`
  - Codex: `method: "file"` を基本
  - line attribution は後続研究
  とする案が現実的

### 9.11 `packages/cli/src/core/entry.ts`

変更内容:

- `AgentnoteEntry` に `agent?: string | null` を追加
- `buildEntry()` の入力へ `agent` を追加

判断:

- optional field として扱う
- note の生成時は新規 note に `agent` を入れる

### 9.12 `packages/cli/src/commands/normalize.ts`

変更内容:

- 旧 note を normalize するとき `agent: null` を許容
- additive field なので過去 note はそのまま読める

### 9.13 `packages/cli/src/core/constants.ts`

追加候補:

- `SESSION_AGENT_FILE`

既存 `SESSION_FILE` は維持。

### 9.14 `packages/cli/src/paths.ts`

変更内容:

- `.claude/settings.json` 専用 helper を agent-neutral にするか、新規 helper に置き換える

判断:

- `settingsFile()` は削除または Claude 専用 helper として限定使用
- 汎用 path は adapter 側で解決した方がよい

## 10. CLI 仕様案

MVP での CLI 仕様を先に固定する。

### 10.1 `agentnote init`

現行:

```bash
agentnote init
```

新仕様:

```bash
agentnote init [--agent <name>]
```

挙動:

- 未指定時は `claude-code`
- `--agent codex` で Codex 用設定を入れる

この仕様は後方互換のために重要である。
既存の README、docs、ユーザー習慣、CI 想定をいきなり壊さない。

### 10.2 `agentnote hook`

現行:

```bash
agentnote hook
```

新仕様:

```bash
agentnote hook --agent <name>
```

挙動:

- `--agent` 必須
- 不正 agent 名は stderr 出力 + exit 1

注意:

- Claude では command rewrite のためにも使う
- Codex では公式 docs 上 rewrite に使えないため、収集用 hook として使う

### 10.3 `agentnote status`

MVP:

- オプション追加なし
- active session があればそこから agent を表示

### 10.4 `agentnote show`

MVP:

- オプション追加なし
- note / session metadata から agent を表示

## 11. Session Metadata 設計

### 11.1 維持するもの

- `.git/agentnote/session`

これは active session ID の単純ポインタとしてそのまま維持する。

### 11.2 追加するもの

- `.git/agentnote/sessions/<session-id>/agent`

保存内容は 1 行の agent 名でよい。

理由:

- 既存 `session` file を JSON 化せずに済む
- backward compatibility が高い
- troubleshooting が容易

### 11.3 session_start 時の保存内容

最低限:

- `session`
- `heartbeat`
- `events.jsonl`
- `agent`
- `transcript_path` があれば保存

Codex では `transcript_path` が common input にあるので、`findTranscript()` よりこの保存値を優先した方が堅い。

## 12. Git Note Schema 設計

### 12.1 追加 field

- `agent`

例:

```json
{
  "v": 1,
  "agent": "codex",
  "session_id": "a1b2c3d4-..."
}
```

### 12.2 version 方針

今回は schema version を上げない。

理由:

- additive field のみ
- 既存 consumer は unknown field を無視できる
- normalize 側で backward compatibility を確保できる

### 12.3 表示方針

`show`:

- `agent:   codex`

`pr`:

- report 全体の代表 model と同じく、必要なら将来 agent も出せる
- MVP では commit JSON に agent を残すだけでもよい

## 13. Codex Adapter MVP 設計

この節は、OpenAI 公式 docs で確認できた Codex hook 制約を前提に、最も安全な MVP を定義する。

### 13.1 `installHooks()`

Codex の設定ファイルに次を入れる。

- session start 相当
- prompt submit 相当
- stop 相当
- Bash の pre/post tool hook は必要なら補助的に追加

hook command は必ず agent 指定付き:

```bash
npx --yes agentnote hook --agent codex
```

加えて `.codex/config.toml` で `features.codex_hooks = true` を有効化する。

### 13.2 `parseEvent()`

出力したい `NormalizedEvent`:

- `session_start`
- `prompt`
- `stop`
- `pre_commit`
- `post_commit`

MVP では次の簡略化を許容する。

- `response` は使わない
- `transcriptPath` は無くてもよい
- `toolUseId` は無ければ null

ただし docs 上の現実:

- `pre_edit` と `file_change` は Bash hook だけでは埋まらない
- `pre_commit` / `post_commit` も Codex hook では command rewrite 目的ではなく補助扱いになる

よって Base MVP では `parseEvent()` の主対象は次になる。

- `SessionStart`
- `UserPromptSubmit`
- `Stop`
- 必要なら Bash `PreToolUse` / `PostToolUse`

### 13.3 `findTranscript()`

Codex では hook input に `transcript_path` があるため、MVP では session dir に保存した値を最優先で使う。

`findTranscript(sessionId)` は次の順で考える。

1. session dir の保存済み `transcript_path`
2. 将来必要なら Codex ローカル保存先探索
3. 見つからなければ null

`entireio/cli` は transcript path を hook payload から直接 session ref として使っている。
この設計は Agent Note にも強く推奨できる。

### 13.4 `extractInteractions()`

MVP では transcript format 未確定なら、空配列でもよい。
`record.ts` 側は既に prompt JSONL だけで interaction を作れるため、Base MVP は成立する。

ただし Parity MVP に進むには、transcript に次のどれが含まれるか確認が必要。

- assistant response
- tool call records
- touched file paths
- patch or diff metadata

`entireio/cli` の transcript parser から学べる最低仕様:

- user message は `response_item.payload.type == "message"` かつ `role == "user"`
- assistant message は `response_item.payload.type == "message"` かつ `role == "assistant"`
- tool use は `function_call` / `custom_tool_call`
- file path は `custom_tool_call` の `apply_patch` input から正規表現抽出できる

Agent Note でまず目指すべき parser もこの水準でよい。

## 14. もし Codex に十分な hook が無い場合

ここは contingency plan である。

### 14.1 fallback MVP

成立条件:

- prompt を何らかの形で取得できる
- commit 直前または commit 時に session を把握できる

手段:

- `agentnote commit` wrapper に寄せる
- git hooks はそのまま使う
- Codex hooks は session / prompt / transcript_path の収集だけに使う
- file edit event が取れなければ attribution は degrade する

`entireio/cli` を踏まえると、この fallback はさらに次へ改善できる。

- transcript parser を使って file-level attribution を復元する
- したがって「file edit event が取れない = 完全に file attribution 不可」ではない
- ただし line-level attribution 不可の可能性は依然高い

### 14.2 fallback で失うもの

- 正確な file-level attribution
- line-level attribution の安定性
- transcript 由来 response

つまり fallback MVP は「Claude と同じ精度」ではなく、
「Codex セッションの commit traceability を先に成立させる」戦略である。

### 14.3 fallback を採る判断基準

次のうち 2 つ以上が欠ける場合は fallback へ切り替える。

- file path
- prompt
- session ID
- edit timing

## 15. テスト計画

テストは「Claude 非回帰」と「Codex 新規保証」を分離して考える。

### 15.1 unit test

対象:

- `agents/index.ts`
- `codex.ts`
- `normalize.ts`

テスト項目:

- unknown agent の reject
- alias から canonical 変換
- Codex payload の parse 成功
- Codex payload の parse 失敗
- additive `agent` field の normalize

### 15.2 command integration test

対象:

- `init.test.ts`
- `hook.test.ts`
- `show.test.ts`
- `status.test.ts`
- `commit.test.ts`
- `pr.test.ts`

追加すべきケース:

- `init --agent codex`
- `hook --agent codex`
- Codex 由来 session の `show`
- Codex 由来 note の `pr --json`
- Codex で `features.codex_hooks = true` が書かれる
- Codex 用 `.codex/hooks.json` が idempotent に更新される
- Codex transcript parser が user/assistant/apply_patch を読める
- `files_touched` が `apply_patch` から抽出される

### 15.3 Claude non-regression test

最低確認:

- `agentnote init` は今まで通り Claude 用設定を作る
- `agentnote hook --agent claude-code` が既存 payload を ingest できる
- `commit/show/pr` の既存挙動が維持される
- 既存の split-commit / cross-turn 系 test が通る
- `git commit --amend` 非注入の既存ルールが維持される

### 15.4 テスト環境改善

現状の課題:

- `commit.test.ts` に `~/.claude` 直書きがあり環境依存で失敗する

改善方針:

- transcript path validation を test 注入しやすくする
- もしくは HOME を temp directory へ差し替えてテストする

これは Codex 対応のついでに直す価値が高い。

### 15.5 Parity 判定用テスト

Codex で Claude 同等の attribution を目指す場合は、次のテストが必要になる。

- transcript に file event があるケース
- transcript に file event がないケース
- attribution が `file` または `none` に degrade するケース

このテストが書けない段階では、Parity MVP を約束してはいけない。

## 16. docs 更新計画

更新対象:

- `README.md`
- `website/src/content/docs/index.mdx`
- `website/src/content/docs/getting-started.mdx`
- `website/src/content/docs/how-it-works.mdx`
- `website/src/content/docs/commands.mdx`
- 日本語 docs も必要箇所更新

更新内容:

- `.claude/settings.json` 固定表現の見直し
- `Works With` の更新
- `Codex CLI | Supported` への変更
- `init --agent codex` の例追加

注意:

- MVP で response 復元が未対応なら docs に明記する

## 17. 段階投入計画

### Gate A: Refactor only

内容:

- agent registry
- session agent metadata
- note schema additive change
- Claude 既存挙動維持

この段階では Codex adapter なしでもよい。

Gate A は最重要ゲートである。
ここで Claude の既存 test が壊れるなら、その時点で先へ進まない。

### Gate B: Codex MVP

内容:

- `codex.ts`
- `init --agent codex`
- `hook --agent codex`
- `show/status/pr` の Codex 表示

Gate B はさらに 2 段に分ける。

- Gate B1: Base MVP
- Gate B2: Parity MVP

#### Gate B1: Base MVP

- session / prompt / transcript_path / model の収集
- Codex 用 repo config の生成
- Claude 非破壊

#### Gate B2: Parity MVP

- file attribution
- line attribution
- response 復元の強化

Gate B2 は transcript schema 確認後でなければ開始しない。

### Gate C: Docs and polish

内容:

- docs 更新
- release note
- テスト環境改善

## 18.5 ロールバック方針

Claude 非破壊を最優先する以上、Gate A と Gate B には明確な rollback 条件が必要である。

### Gate A rollback 条件

次のいずれかを満たしたら Gate A をやり直す。

- Claude の既存 test が 1 件でも回帰する
- `agentnote init` の既定挙動が Claude 用でなくなる
- `agentnote hook` の Claude payload ingest が壊れる
- `agentnote show` が既存 note を読めなくなる

### Gate B rollback 条件

次のいずれかを満たしたら Codex adapter を一旦無効化する。

- Codex 対応を入れたことで Claude test が壊れる
- Codex note が作られても `pr` 集計で例外が出る
- `show` が `response: null` で壊れる

### rollback の実務方針

- registry 化と Codex adapter 追加は論理的に分離する
- Gate A の commit 群と Gate B の commit 群を混ぜない
- 必要なら Codex adapter だけ revert できる粒度で変更を積む

## 18. 受け入れ基準

最終的な受け入れ基準を具体化する。

### 18.1 機能

- Claude 既存ユーザーのワークフローが壊れない
- Codex で新規 repo 初期化ができる
- Codex セッションから note が生成される
- PR report 集計が成立する

Base MVP ではここに「Claude 同等の attribution」は含めない。
それは Parity MVP の受け入れ基準に分離する。

### 18.2 品質

- 既存 test が通る
- 追加した Codex test が通る
- docs が実装と整合する

### 18.3 互換性

- 既存 git notes をそのまま読める
- 既存 Claude セッション directory も読める
- `agentnote init` のデフォルト UX は大きく壊さない
- 既存の `.claude/settings.json` 利用 repo は再 `init` により自然回復できる

### 18.4 Parity 受け入れ基準

Codex を Claude と同等品質で「対応済み」と呼ぶには、さらに次が必要。

- touched file を十分な精度で復元できる
- line attribution が Claude と同じ意味で成立する
- `show` で prompt / response / files_touched が妥当な形で見える

この条件が満たせない間は、docs 上の表現も `Base support` 相当に留めるべきである。

### 18.5 `Preview` から `対応済み` への昇格条件

Codex CLI の docs 表記を `Preview` から `対応済み` へ上げる条件を、実装判断ではなく運用判断として明文化する。
ここでいう `対応済み` は「Codex でも日常運用に必要な記録が、保守的で安定した条件の下で継続的に成立する」ことを意味する。

最低条件:

- `agentnote init --agent codex` が新規 repo と既存 repo の両方で安定して動く
- `show`, `status`, `log`, `pr` が Codex note を特別扱いせず表示できる
- Codex transcript から prompt, response, files_touched を継続的に復元できる
- file attribution が主要な編集経路で安定して成立する
- Claude non-regression test が継続的に通る

ここでいう「file attribution が主要な編集経路で安定して成立する」とは、少なくとも次を満たすことを指す。

- `apply_patch` を使った編集で、コミットに含まれる AI 編集ファイルを妥当に復元できる
- transcript から根拠が取れない変更を、AI 変更として過剰計上しない
- transcript parser の前提が test fixture に固定され、schema 変化で壊れたときに test で検知できる

`対応済み` に上げてもよいが、まだ `Full support` と呼んではいけない条件:

- file attribution は安定している
- line attribution は条件付きでしか成立しない
- docs に line attribution の条件が明記されている

つまり、`対応済み` は「Codex を production 利用してよい」という意味であり、「Claude と同等精度」という意味ではない。

### 18.6 `対応済み` から `Full support` への昇格条件

Codex CLI を `Full support` へ上げる条件は、`対応済み` よりさらに強い。
ここでいう `Full support` は、Claude Code の現在表現と同じく「line attribution を含む主要機能が、通常運用で特別条件なしに信頼できる」ことを意味する。

必要条件:

- line attribution が例外的な成功ではなく、通常の Codex 編集フローで安定して成立する
- `apply_patch` 以外を含む主要編集経路でも attribution の説明責任が立つ
- line attribution の成立条件が内部事情ではなく、docs 上で簡潔に説明できる
- transcript schema 変更に対する parser の回復性、または十分な検知性がある
- Claude と Codex の両方で release 前の非回帰確認が routine 化されている

現時点の実装はこの条件をまだ満たしていない。
したがって、2026-04-10 時点では Codex CLI を `Preview` と表現するのが妥当である。

### 18.7 `entireio/cli` から転用できる受け入れ基準

Codex transcript parser については、少なくとも次を満たすべきである。

- user prompt を transcript から復元できる
- assistant response を transcript から復元できる
- `apply_patch` 入力から file path を抽出できる
- transcript path が null のときは graceful に degrade できる

## 19. 実装順序

安全な実装順序を固定しておく。

1. `agents/index.ts` 追加
2. `hook.ts` を agent-aware 化
3. session metadata に agent 保存を追加
4. `record.ts` を adapter 解決に変更
5. `show.ts` / `status.ts` を agent-aware 化
6. `entry.ts` / `normalize.ts` に `agent` field 追加
7. Claude 非回帰 test 修正
8. `codex.ts` 実装
9. Codex integration test 追加
10. README / docs 更新

この順番の意図:

- まず土台を作る
- 次に既存挙動を守る
- その上で Codex を載せる

補足:

- `entireio/cli` の Codex parser 実装は Phase 2 の参考実装として強く活用できる
- ただし Agent Note は Go ではなく TypeScript なので、思想だけ借りて再実装する

## 20. リスクと対策

### リスク 1: Codex hook の仕様が Claude より弱い

対策:

- transcript 復元を MVP から外す
- prompt と file attribution を優先

修正:

- 公式 docs を踏まえると、file attribution すら優先できない可能性がある
- よって Base MVP では prompt / session / transcript_path を優先し、attribution は transcript schema 次第にする

### リスク 2: `hook --agent` 化で既存 Claude 設定が壊れる

対策:

- `init` が生成する hook command を更新
- 既存設定に対する migration は不要でも、再 `init` で自然回復できるようにする
- Gate A で Claude hook test が全通しない限り Codex 実装へ進まない

### リスク 3: note schema に `agent` を足すことで表示系がずれる

対策:

- `normalizeEntry()` を最初に更新
- `show/pr/log` は field 不在時に null を許容

### リスク 4: test が HOME 依存で不安定

対策:

- test 専用 HOME を切る
- path validation を injectable にする

### リスク 5: Codex config 管理が単一ファイル abstraction に収まらない

対策:

- `settingsRelPath` の扱いを見直す
- 複数 managed path を adapter が返せるようにする

### リスク 6: transcript parser は作れても line attribution まで届かない

対策:

- Base MVP では `method: "file"` を正規仕様として認める
- docs 上も Claude と Codex の attribution 差を明示する
- line attribution は transcript の追加解析か別フック戦略を後で研究する

## 21. Phase ごとの完了条件

### Phase 0 完了

- Codex の event source と payload shape が確定

### Phase 1 完了

- Claude 実装が adapter registry 経由に置き換わる
- Claude の既存動作が変わらない
- Claude non-regression test が全通する

### Phase 2 完了

- Gate B1: Base MVP が成立
- もしくは Gate B2: Parity MVP まで成立

### Phase 3 完了

- 表示と docs が Codex 対応に追従

### Phase 4 完了

- test と release readiness が揃う

## 24. Claude を壊さないための実装ルール

実装時のルールをここで固定する。

1. Claude adapter の挙動変更と Codex adapter 追加を同じ commit に混ぜすぎない
2. まず registry 化だけを行い、Claude を緑に戻してから Codex を載せる
3. `init` の default agent は変更しない
4. note schema は additive のみとし、既存 note の書き換えはしない
5. test が 1 件でも Claude 回帰した状態で docs 更新へ進まない

## 25. 実装開始判断

実装開始前に満たすべき判断条件は次の通り。

- Codex の hook / event 仕様が最低限把握できている
- Gate A の作業が Claude 非破壊であると合意できている
- transcript 未対応でも MVP として受け入れるかの方針が合意されている
- Base MVP と Parity MVP を分けて受け入れる方針が合意されている

この 4 条件が揃って初めて実装着手してよい。

## 25.1 実装前に解決すべき blocking issues

ここでいう「課題を全て解決してから着手する」とは、
少なくとも次の blocking issues に対して、実装方針が未確定のままコードを書き始めないことを意味する。

### Blocker 1: Codex の transcript parser 対象範囲

未解決点:

- Agent Note でどこまで transcript を読むか
- `message`, `function_call`, `custom_tool_call`, `*_output` のどれを MVP 対象にするか
- `apply_patch` 以外の file mutation をどう扱うか

解決条件:

- Base MVP parser の対象 event type を固定する
- 非対象 event は無視することを仕様として明記する

### Blocker 2: Codex の attribution policy

未解決点:

- Codex note の `attribution.method` を何にするか
- file-level attribution をどう定義するか
- line-level attribution を MVP から外すかどうか

解決条件:

- Base MVP では `method: "file"` を標準とするか、または条件付き `line` を許容するかを決める
- docs 表現と PR report 表示がその仕様に整合する

### Blocker 3: `AgentAdapter` abstraction の不足

未解決点:

- `settingsRelPath` だけでは `.codex/config.toml` と `.codex/hooks.json` を表現できない
- `init` が何を commit 対象として表示すべきか未定

解決条件:

- `managedPaths()` 相当の新 API を入れるかどうか決める
- `init` 出力と docs の例がその設計に乗る

### Blocker 4: `hook --agent` の migration policy

未解決点:

- 既存 Claude repo が古い hook command のままでも壊れないか
- `agentnote init` 再実行以外で migration を要するか

解決条件:

- 「再 `init` で自然回復」で十分かを決める
- 旧 hook command を一時的に互換受理するかを決める

### Blocker 5: test fixture の HOME / transcript 依存

未解決点:

- 既存 Claude test が `~/.claude` に依存している
- Codex test を足すと同種の不安定さを増やす恐れがある

解決条件:

- test 専用 HOME 方針を決める
- transcript path validation を test 可能な形にする
- Codex test の isolation 方針を固定する

### Blocker 6: Base MVP と Parity MVP の外部表現

未解決点:

- README / docs / changelog で「Codex 対応済み」とどの粒度で書くか
- Base MVP を supported と呼ぶか preview と呼ぶか

解決条件:

- docs 用の文言レベルを決める
- support matrix の表記を決める

## 25.2 blocker 解消チェックリスト

実装着手前のチェックリスト:

- Codex transcript parser の MVP 対象 event が決まっている
- Codex attribution policy が決まっている
- `AgentAdapter` の config abstraction が決まっている
- `hook --agent` migration policy が決まっている
- test isolation 方針が決まっている
- docs 上の support 表現が決まっている

この 6 項目が未解決なら、実装には入らない。

## 25.3 blocker resolution

この節で、25.1 の blocker を実装前提として解決済みにする。

### Resolution 1: Codex transcript parser 対象範囲

Base MVP の parser 対象は次で固定する。

- `response_item.payload.type == "message"` かつ `role == "user"`
- `response_item.payload.type == "message"` かつ `role == "assistant"`
- `response_item.payload.type == "custom_tool_call"` かつ `name == "apply_patch"`
- `response_item.payload.type == "custom_tool_call_output"`
- `response_item.payload.type == "function_call"`
- `response_item.payload.type == "function_call_output"`

Base MVP で parser 対象外とするもの:

- `reasoning`
- `event_msg` のうち token accounting 以外
- shell command の副作用からの file change 推定
- `apply_patch` 以外の tool input からの file mutation 復元

判断:

- interaction 復元のために user / assistant / tool_use は読む
- file attribution のために `apply_patch` だけを信頼ソースにする
- それ以外は「見えたら儲けもの」ではなく、仕様として無視する

これにより parser スコープは確定。

### Resolution 2: Codex attribution policy

Base MVP の Codex attribution policy は次で固定する。

- `files_touched` は transcript の `apply_patch` から抽出した file のみ
- `by_ai` は commit files と `apply_patch` 抽出 file の積集合で判定する
- `attribution.method` は Codex Base MVP では `file`
- line-level attribution は Codex Base MVP では提供しない
- `apply_patch` から 1 件も file を復元できない場合でも note は作る

その場合の表示方針:

- note は session, prompt, response, model を保持する
- `files_touched` は空でもよい
- `attribution.ai_ratio` は file-level 算出結果に従う

保守的な仕様:

- shell-based edits や `exec_command` 経由の変更は Base MVP では under-attribution を許容する
- false positive より false negative を選ぶ

これにより attribution policy は確定。

### Resolution 3: `AgentAdapter` abstraction

`settingsRelPath` 単独では Codex を表現できないため、Base MVP の設計は次で固定する。

- `settingsRelPath` は後方互換のため残す
- 追加で `managedPaths(repoRoot): Promise<string[]>` を `AgentAdapter` に導入する
- `init` は commit 対象表示と生成ファイル表示に `managedPaths()` を使う

Claude:

- `managedPaths()` は `[".claude/settings.json"]`

Codex:

- `managedPaths()` は `[".codex/config.toml", ".codex/hooks.json"]`

これにより multi-file agent config 問題は解決。

### Resolution 4: `hook --agent` migration policy

migration policy は次で固定する。

- 新規 install は必ず `agentnote hook --agent <name>` を使う
- ただし既存 Claude repo の互換のため、`agentnote hook` 単独は legacy Claude mode として当面受理する
- `agentnote hook` 単独時は Claude payload parser を使う
- `agentnote init` 再実行で新形式へ自然移行する

この方針により:

- 既存 Claude ユーザーは即時破壊されない
- 新しい設計は agent 明示で進められる
- migration 専用コマンドは不要

これにより migration policy は解決。

### Resolution 5: test isolation 方針

test の isolation は次で固定する。

- CLI integration test はすべて subprocess 実行時に `HOME` を temp dir に差し替える
- Claude transcript fixture は temp HOME 配下の `.claude/` に置く
- Codex transcript fixture は temp HOME 配下の `.codex/` に置く
- 実ユーザーの `~/.claude` / `~/.codex` を使わない

必要なら adapter 側で次を許容する。

- `CODEX_HOME` の尊重
- `HOME` 由来 path の解決

この方針により、現行の `~/.claude` 権限依存 test 失敗も同時に解消対象に含める。

これにより test isolation 方針は解決。

### Resolution 6: docs 上の support 表現

Base MVP と Parity MVP の表現は次で固定する。

- Claude Code: `Full support`
- Codex CLI: `Preview`

`Preview` の意味:

- session / prompt / response / transcript-driven reporting は対応
- file attribution は `apply_patch` ベースの保守的推定
- Claude と同等の line-level attribution は未保証

`Preview` から `対応済み` へ上げるには、18.5 の昇格条件を満たすこと。
`対応済み` から `Full support` へ上げるには、18.6 の昇格条件を満たすこと。

これにより docs wording は解決。

### Resolution 7: `apply_patch` 以外の file mutation

Base MVP では次で固定する。

- `apply_patch` から抽出できる file のみ file attribution の根拠とする
- `exec_command` / shell command の副作用から file change を推定しない
- transcript から明示的に file が取れない変更は AI file attribution の対象外とする

理由:

- shell command の副作用推定は誤認率が高い
- Base MVP は conservatively correct を優先する

これにより Base MVP の file mutation policy は解決。

## 25.4 blocking issues の最終判定

2026-04-10 時点で、25.1 に列挙した blocking issues はすべて
「未調査の論点」ではなく「計画上の固定方針」へ落とし込み済みである。

したがって、現時点の判断は次で固定する。

- 設計上の blocker は解消済み
- 残っているのは実装時に test で検証するべき項目のみ
- 実装着手を止めている理由は「未解決の設計課題」ではなく「ユーザー未許可」である

実装時に確認すべき項目:

- Codex transcript fixture が実装した parser 仮定に一致すること
- `apply_patch` 抽出が実 fixture で十分な file attribution を返すこと
- Claude non-regression が Gate A 後も維持されること

これらは blocker ではなく、実装 gate の検証項目として扱う。

## 26. この計画書の自己レビュー結果

この計画書は 2 回見直しを行い、次の弱点を補強した。

最初の弱点:

- Codex 追加の話はあるが、現行システムが成立しているかの評価が薄かった
- Claude を壊さないための gate が曖昧だった
- rollback 条件がなかった

改善後に明確化した点:

- 現状は「動いている Claude 実装」であると評価した
- Gate A を Claude 非破壊の固定点と定義した
- rollback 条件を Gate A / Gate B に分けて明記した

初稿時点での残る未知数:

- Codex 側の hook / event / transcript 実仕様

この未知数は、公式 docs と `entireio/cli` の実装確認によって
「設計 blocker」から「実装時検証項目」へ格下げできた。
したがって、計画の具体化を止める理由ではもうない。

ただし今回の公式調査により、少なくとも次は確定した。

- session / prompt / transcript_path / model の収集は計画可能
- `.codex/config.toml` と `.codex/hooks.json` を扱う必要がある
- file edit hook と command rewrite は Claude と同じ方式では実現できない

これにより、計画は「Codex も Claude と同じ実装でいける」という前提から、
「Base MVP と Parity MVP を分けて設計する」前提へ更新された。

さらに `entireio/cli` の実装確認により、次もかなり確度高くなった。

- Codex transcript parser の実装可能性
- `apply_patch` ベース file extraction の実装可能性
- `.codex/config.toml` と `.codex/hooks.json` の repo-local 管理方針

## 27. 実作業タスクリスト

このセクションは、25.3 と 25.4 の判断により実行順として確定した。
未解決 blocker は planning level では残っていない。
ただし、実装開始はユーザー許可後に限る。

### 27.1 Gate A: Claude 非破壊 refactor

- `packages/cli/src/agents/index.ts` を追加して agent registry を導入する
- `packages/cli/src/cli.ts` の `hook` 呼び出しを `hook(args)` に変更する
- `packages/cli/src/commands/hook.ts` を `--agent` 前提に変更する
- session dir に agent 名を保存する仕組みを追加する
- `packages/cli/src/core/record.ts` の transcript 解決を adapter 経由へ変更する
- `packages/cli/src/commands/show.ts` の Claude 直接参照を除去する
- `packages/cli/src/commands/status.ts` の Claude 直接参照を除去する
- `packages/cli/src/core/entry.ts` と `packages/cli/src/commands/normalize.ts` に `agent` field を追加する
- Claude non-regression test を修正して緑に戻す

### 27.2 Gate B1: Codex Base MVP

- `packages/cli/src/agents/codex.ts` を追加する
- `.codex/config.toml` 更新ロジックを実装する
- `.codex/hooks.json` 更新ロジックを実装する
- `features.codex_hooks = true` の idempotent 設定を実装する
- `SessionStart` / `UserPromptSubmit` / `Stop` の payload parser を実装する
- `transcript_path` を session metadata に保存する
- Codex transcript parser の最小版を実装する
- prompt / response / files_touched の抽出を実装する
- Codex 用 `show / status / pr` の表示互換を確認する
- Codex integration test を追加する

### 27.3 Gate B2: Codex Parity MVP

- transcript から file-level attribution を安定して復元する
- `apply_patch` 以外の tool pattern で file change が取れるか検討する
- line-level attribution の成立条件を実装に落とす
- `attribution.method` の Codex 表示と PR 集計を整える
- Parity 用 test を追加する

### 27.4 Gate C: Docs と仕上げ

- `README.md` の agent 対応表記を更新する
- `website/src/content/docs/getting-started.mdx` を更新する
- `website/src/content/docs/index.mdx` を更新する
- `website/src/content/docs/commands.mdx` を更新する
- `website/src/content/docs/how-it-works.mdx` を更新する
- 日本語 docs の対応ページを更新する
- Base MVP と Parity MVP の違いを docs に明記する

### 27.5 実行前チェック

- 25.2 の blocker 解消チェックリストが全て満たされている
- Gate A を単独で revert 可能な粒度に分けられている
- Gate B1 を単独で revert 可能な粒度に分けられている
- Claude の既存利用者向け migration 方針が決まっている
- docs の support 表現が決まっている

## 22. 実装者向けチェックリスト

- `claudeCode` 直接 import を残していないか
- `hook` の agent 指定が曖昧になっていないか
- session dir に agent が保存されるか
- transcript 解決が adapter 経由になっているか
- note の `agent` が optional で後方互換か
- docs に `.claude/settings.json` 固定表現が残っていないか
- Codex が `response: null` でも show/pr が壊れないか

## 23. 最終判断

Codex 対応の本質は「Codex adapter の追加」ではない。
本質は「設計上存在する adapter 境界を、実装上も本物にすること」である。

この土台を先に整えれば、Codex 対応は単発の特例実装ではなく、
将来的な Cursor / Gemini 対応にも耐える拡張になる。
