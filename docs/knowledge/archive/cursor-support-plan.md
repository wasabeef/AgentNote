# Cursor Support Plan

> この文書は Agent Note に Cursor 対応を追加するための実装計画である。
> 2026-04-11 時点のコードベースと公開情報を前提に、何が確定していて何が未確定か、
> そしてどの条件なら MVP が成立するかを実装順に固定する。
>
> 2026-04-12 追記:
> 公開 docs / forum の追加調査で、`beforeShellExecution` の command rewrite schema は確認できなかった。
> 現時点では Cursor shell hooks を commit integration の主経路にしない。

## 0. 結論

Cursor 対応は可能であり、MVP-A / MVP-B は現行実装で成立した。
一方で、Cursor の `beforeShellExecution` を使った安全な command rewrite は、
2026-04-12 時点の公開情報だけでは正当化できない。
したがって、commit integration の主経路は引き続き repo-local git hooks とする。

この計画では成功条件を 2 段階に分ける。

1. **MVP-A**: session tracking と commit linkage を成立させる
2. **MVP-B**: file-level attribution を成立させる
3. **Stretch**: assistant response 復元と line-level attribution を成立させる

現状:

- **MVP-A**: 完了
- **MVP-B**: 完了
- **Stretch**: response 復元は完了、line-level attribution は安全な条件付きで完了
- **未完**: `beforeShellExecution` を使った safe な command rewrite

重要なのは、MVP-A と MVP-B を混同しないことだ。
現行の `recordCommitEntry()` は file change 情報が無い状態では prompt だけを安全に note へ残せない。
したがって Cursor 対応の最初の焦点は「prompt を拾えるか」ではなく、
「commit に紐づく file touch 情報をどの経路で確保するか」である。

## 1. 目的

Cursor を使った作業でも、少なくとも以下を成立させる。

- `agent-note init --agent cursor`
- session と commit の紐付け
- `agent-note commit` / git commit 後の git notes 記録
- `show / log / pr / status` での `agent: cursor` 表示
- 可能なら file-level attribution

余力があれば次も目指す。

- assistant response の復元
- line-level attribution

## 2. 非目標

今回の Cursor 対応で、次は同時にやらない。

- Gemini / Copilot 対応の同時着手
- note schema の migration
- 既存 transcript parser の全面共通化
- session 並列実行モデルの再設計
- Claude / Codex 実装の抜本的整理

## 3. 現状の制約

現在のコードベースは `AgentAdapter` を通せば agent を追加できる。
ただし、Cursor 対応には次の制約がある。

### 3.1 `hook.ts` の同期 hook 判定

当初は `hook_event_name === "PreToolUse"` のときだけ同期 hook とみなしていた。
現在は Cursor の `beforeSubmitPrompt` / `beforeShellExecution` も同期 hook として扱える。
したがって残課題は「同期 hook を扱えるか」ではなく、
「その返却 schema で何を安全に制御できるか」である。

### 3.2 `recordCommitEntry()` は prompt-only fallback を持たない

`recordCommitEntry()` は turn tracking が有効な場合、
`file_change` または `pre_blob` から `relevantTurns` を決めて prompt を絞り込む。
したがって file touch 情報が一切無い Cursor 実装では、prompt だけ拾えても note の価値がかなり落ちる。

### 3.3 `stop` / `afterAgentResponse` の response 精度

当初は `stop` の response が永続化されず、note に反映されなかった。
現在は `afterAgentResponse` / `stop` を `events.jsonl` に保存し、
transcript が無い場合の response 復元にも使っている。
残っている論点は「response を取れるか」ではなく、
Cursor 側 payload の安定性と transcript との優先順位である。

### 3.4 `init` の UX は adapter 依存で成立する

`init.ts` は `managedPaths()` を表示と `git add` 提案の両方に使っている。
したがって Cursor adapter は `.cursor/hooks.json` だけでなく、
実際に commit 対象として何を見せるかまで責務に含めて設計する必要がある。

## 4. 確定事項

現時点で前提にしてよい事項は次の通り。

- Cursor には repo-local hook 設定の仕組みがある
- 公開情報ベースでは `beforeSubmitPrompt`, `beforeShellExecution`, `afterAgentResponse`, `afterFileEdit`, `afterTabFileEdit`, `afterShellExecution`, `stop` 系 hook が存在する
- CLI / headless では `beforeShellExecution` / `afterShellExecution` は送られる
- `afterAgentResponse` と `stop` は response 復元経路として使える
- Agent Note 側は session metadata を `.git/agentnote/sessions/<session-id>/` に保存する設計である

追加で、2026-04-12 の調査で次が確認できた。

- hook response の message field は `snake_case` (`user_message`, `agent_message`) が正である
- `permission` は現状 `deny` 以外が不安定で、`allow` / `ask` を前提にした制御は危険である
- malformed JSON に対して fail-open する既知不具合がある
- `beforeShellExecution` の command rewrite schema は公開情報では確認できていない

## 5. 未確定事項

実装前に payload 実測で確定したい点は次の通り。

- stable な session identifier のキー名
- `beforeSubmitPrompt` で取得できる prompt 本文の shape
- `afterFileEdit` が file path のみか、before / after content まで含むか
- `stop` に assistant response が含まれるか
- transcript path または session artifact の参照が取れるか

このうち、MVP-B と Stretch に効くのは 3〜5 である。
一方で `beforeShellExecution` の rewrite 可否は、もはや MVP 成立条件ではない。
Git hooks が commit integration の主経路として成立しているため、
shell rewrite は optional optimization として扱う。

## 6. 成功条件の再定義

### 6.1 MVP-A

以下が成立すれば MVP-A 完了とする。

- `init --agent cursor` が repo-local config を生成する
- Cursor hook から session id を保存できる
- commit 時に `Agentnote-Session` trailer を git hooks 経由で付与できる
- commit 後に `agent: cursor` を持つ git note が作られる
- `show / log / pr / status` が壊れない

### 6.2 MVP-B

以下が追加で成立すれば MVP-B 完了とする。

- Cursor 由来の file change が `CHANGES_FILE` または同等データに保存される
- note の `files[].by_ai` が少なくとも file-level で正しく出る
- split commit でも既存 turn / consumed pair の仕組みを壊さない

### 6.3 Stretch

- `stop` または transcript から response を復元できる
- line-level attribution が成立する

## 7. 実装戦略

### Phase 0: Spike

最初に payload を固定する。
ここでは production 実装を増やすより、Cursor hooks の実サンプルを 3〜5 パターン採取する方を優先する。

確認対象:

- prompt submit
- shell execution
- file edit
- stop

成果物:

- payload fixture
- key 名と optional field の表
- shell hook を safe に production 利用できる範囲の判定

### Phase 1: Adapter 基盤

- `packages/cli/src/agents/cursor.ts` を追加
- `packages/cli/src/agents/index.ts` に registry 登録
- `.cursor/hooks.json` の install / remove / isEnabled を実装
- `managedPaths()` に commit 対象を正しく返す

この段階では transcript 解析はまだ必須ではない。

### Phase 2: Commit Linkage

- `beforeSubmitPrompt` を `prompt` に正規化
- session start 相当イベントがあれば `session_start` に正規化
- `beforeShellExecution` / `afterShellExecution` は fallback 観測経路として接続
- `git commit` の主経路は generated git hooks とする
- `agent-note commit` は git hooks が使えない環境での fallback wrapper として残す

2026-04-12 時点では、この Phase に shell rewrite を含めない。
理由は、Cursor 公開情報から command rewrite schema を確認できず、
`permission` ベース制御も不安定だからである。

### Phase 3: File Attribution

- `afterFileEdit` から file path を `file_change` に正規化
- 可能なら edit 前後の情報も保存する
- turn tracking と consumed pairs を既存ロジックに合わせて利用する
- file change が取れない場合は MVP-B を延期し、MVP-A で止める

### Phase 4: Response / Transcript

- `stop` payload の response を永続化する
- transcript path または session artifact があれば `extractInteractions()` に接続
- response だけ取れるが transcript が無い場合は、`EVENTS_FILE` 由来の簡易 interaction 復元を検討する

### Phase 5: Docs / UX

- `README.md` の support matrix を更新
- `CONTRIBUTING.md` と `../../architecture.md` に Cursor 設定を追記
- `init` の next steps を Cursor 専用 config に合わせて確認

## 8. 実装分岐表

Cursor payload 次第で、実装の終着点は次のように分かれる。

| 条件 | できること | 判定 |
| --- | --- | --- |
| session id + prompt + git hooks 可 | MVP-A | Go |
| 上記 + file path 可 | MVP-B | Go |
| 上記 + edit counts + final blob 一致 | 安全な line-level attribution | Stretch |
| response 可だが transcript 無 | 簡易 response 表示 | Stretch |
| shell hook のみで commit integration したい | 公開情報不足 | No-Go |
| file path 不可 | prompt-only 記録は不十分 | MVP-B は No-Go |

## 9. テスト計画

最低限、次の test を追加する。

- `init --agent cursor` が `.cursor/hooks.json` を生成する
- session / prompt event で `.git/agentnote/session` と prompt log が更新される
- `show` が `agent: cursor` を表示する
- hook 未設定や不完全 payload でも fail closed になる

rewrite が可能な場合は、さらに次を追加する。

- shell hook から `pre_commit` が動く
- 通常の `git commit` で note が書かれる

rewrite が不可能な場合は、代わりに次を追加する。

- `agent-note commit` で Cursor session の note が書かれる
- shell hook fallback で `pre_commit` / `post_commit` が観測できる

file attribution が可能な場合は、さらに次を追加する。

- `afterFileEdit` から `file_change` が保存される
- `show` / git note で AI file が表示される
- split commit で re-attribution しない

response 復元が可能な場合は、さらに次を追加する。

- `stop` または transcript から response が復元される

## 10. リスク

- Cursor hooks の payload 仕様変更が比較的起きやすい
- IDE と CLI で dispatch される hook が一致しない可能性がある
- `permission` 系の hook response は現時点で不安定であり、制御経路に使うと危険である
- command rewrite schema が公開情報で確認できない以上、shell rewrite は推測実装になる
- transcript 相当の永続データが安定して取れない場合、Claude / Codex と同精度にはならない

## 11. 残タスク

2026-04-12 時点で残っている実質的なタスクは 1 つだけである。

- `beforeShellExecution` の stdin / stdout を local spike で実測し、safe な command rewrite schema が存在するかを確認する

このタスクは「今すぐ実装を足せば進む」種類ではない。
公開情報だけでは schema が確認できないため、次のアクションは production 実装ではなく実測調査になる。

補足:

- Git hooks 主体の commit integration はすでに成立している
- Cursor の prompt / response / edits / shell fallback は現行実装で成立している
- したがって残差分は parity 向上のための optional optimization であり、MVP 不足ではない

## 12. 完了条件

Cursor 対応完了の定義は次の通り。

- 少なくとも MVP-A が成立している
- どこまでが MVP-A / MVP-B / Stretch か docs に明記されている
- test が追加され、既存 agent の regressions がない
- Cursor 非対応の残りがある場合も、「未実装」ではなく「どの条件不足で deferred か」が説明されている

2026-04-12 時点では、上記条件は満たしている。
残差分は「実装がまだ足りない」ではなく、
「`beforeShellExecution` の safe な command rewrite schema を公開情報で確認できていないため deferred」である。

理想は将来的に shell rewrite まで含めた parity を取ることだが、
現時点では Git hooks 主体のまま止める判断が最も安全である。
