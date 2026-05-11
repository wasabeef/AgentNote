# Investigation History

このファイルは、解決済みの調査と regression の判断を残す場所です。未解決タスクの TODO list ではありません。

新しい調査を書くときは、対象 PR / commit、観測結果、原因、修正、regression coverage を残してください。

## Open Follow-ups

### CLI dist tracking

- 現状では `packages/cli/dist/cli.js` は package contract 上必要です。`packages/cli/package.json` の `bin.agent-note` は `./dist/cli.js` を指し、publish 対象も `dist` のみで、CI も `node packages/cli/dist/cli.js version` を直接実行しています。
- 一方で、repository が `dist` を tracked artifact として持ち続けるべきかは再検討します。`prepublishOnly` / CI が必ず build する設計にできるなら、`dist` tracking は PR noise になる可能性があります。
- tracked `dist` を外す場合は、CI、test、release docs、local git hook shim の前提を更新し、実行前に必ず build するか source CLI を解決する形へ揃える必要があります。

## Resolved Investigations

### Long-running session で commit note が作成されない

- 対象 PR: `#57`
- 対象 commit: `b28d52f feat(report): add reviewer context`
- 観測結果: PR body の Agent Note が `Total AI Ratio: ░░░░░░░░ 0%` になり、commit table も `AI Ratio` / `Prompts` / `Files` がすべて `—` でした。`git notes --ref=agentnote show b28d52f` も `no note found` です。
- 正常例: PR `#56` の commit `dfd82eb docs: make README language more user-facing` は commit message に `Agentnote-Session: 019da962-23cc-7aa0-bbe3-a10f60fddada` を持ち、git note も正常に作成されています。
- 差分: PR `#57` の commit message には `Agentnote-Session` trailer がありません。`post-commit` hook は HEAD の trailer を source of truth として `agent-note record <session_id>` を呼ぶため、trailer がない commit は記録対象になりません。
- 原因: `prepare-commit-msg` hook は `.git/agentnote/session` と session heartbeat を確認し、heartbeat が 1 時間より古い場合は安全側で trailer 注入を skip します。旧実装は `prompt` で heartbeat を更新していましたが、長い single turn 中の `file_change`、`response`、`pre_commit` では更新していませんでした。そのため、1 時間を超える長い AI 作業の最後に `git commit` すると、commit 直前に agent hook event が来ていても heartbeat が stale のままになり得ました。
- 修正: `agent-note hook` は、正規化された hook event を受けた時点で session heartbeat を更新します。これにより、長い turn の tool event、response、commit hook event が session freshness を延長します。Gemini の `SessionEnd` は true session termination なので、従来通り最後に heartbeat を削除します。
- 表示修正: PR Report は `tracked_commits === 0 && total_commits > 0` の場合、`Total AI Ratio: ░░░░░░░░ 0%` ではなく `Total AI Ratio: —` と `Agent Note data: No tracked commits` を表示します。これで missing note と true 0% attribution commit を分離します。
- Follow-up: PR `#58` の commit `56e6b48 fix(hooks): refresh heartbeat during long turns` では `Agentnote-Session` trailer は入ったものの、git note は作成されませんでした。原因は heartbeat ではなく、commit 時点の session が `SessionStart` / `transcript_path` / heartbeat だけの metadata-only session だったことです。`recordCommitEntry()` は `interactions.length === 0 && aiFiles.length === 0` の空 note を安全側で skip するため、trailer だけが残りました。
- Follow-up 修正: `prepare-commit-msg`、`agent-note commit`、Agent の `PreToolUse git commit` trailer injection は、fresh heartbeat だけではなく、`prompts.jsonl` / `changes.jsonl` / `pre_blobs.jsonl` のいずれかに実データがある session だけを記録対象にします。`transcript_path` は補助 metadata であり、単体では recordable data として扱いません。これにより、plain shell commit や metadata-only session に dangling `Agentnote-Session` trailer を付けません。
- 追加 Follow-up: PR `#71` の follow-up commit では、作業自体は長時間化していませんでしたが、runtime hook が現在の Codex session として発火しておらず、`.git/agentnote/session` が古い Claude session を指したままでした。この状態では `prepare-commit-msg` が heartbeat stale と判断し、trailer を入れないため、`post-commit` も従来は記録できませんでした。
- 採用した追加修正: `prepare-commit-msg` が stale heartbeat のため trailer 注入を skip した場合だけ、one-shot の `post_commit_fallback` marker を書きます。`post-commit` は trailer がなく、かつ marker がある場合だけ `agent-note record --fallback-head` を呼びます。amend / reuse commit は marker を書かず、既存 marker も先に削除するため fallback 対象外です。
- fallback は `.git/agentnote/session` を無条件に信じません。active session に recordable data があり、かつ `changes.jsonl` の post-edit `blob` が HEAD の committed blob と一致する場合だけ `recordCommitEntry()` に進みます。prompt-only / metadata-only / unrelated file evidence / same-path different-blob evidence は救済しません。
- 設計判断: `heartbeat` は active status と fast trailer injection の signal として残します。一方で、commit 紐づけの最後の判断は post-commit fallback marker、post-edit blob match、`recordCommitEntry()` の既存 causal filter に委ねます。これにより、1 時間を超える正当な作業は救いつつ、古い prompt-only session や同一 path の後続 human-only commit の誤 attribution を避けます。
- Regression coverage: `packages/cli/src/commands/hook.test.ts` で `PreToolUse` の `git commit` hook が stale heartbeat を更新すること、metadata-only session では trailer を注入しないことを確認します。`packages/cli/src/commands/init.test.ts` で生成された `prepare-commit-msg` hook が metadata-only session を skip し、prompt data がある session だけに trailer を入れることを確認します。同じ test file で、stale heartbeat のため trailer がない commit でも post-edit blob が HEAD blob と一致すれば post-commit fallback が note を作成し、stale prompt-only session、same-path different-blob session、amend commit は note を作らないこと、root commit でも fallback が動くことを確認します。`packages/cli/src/core/record.test.ts` には 180 case の fallback evidence simulation を追加し、`Claude` / `Codex` / `Cursor` / `Gemini`、current / rotated `changes` / `pre_blobs`、matching / unrelated / empty evidence、prompt-only noise を組み合わせて fallback predicate を検証します。`packages/cli/src/commands/commit.test.ts` で manual `agent-note commit` も同じ条件を使うことを確認します。`packages/pr-report/src/report.test.ts` で note missing commit は `Total AI Ratio: —`、true 0% attribution commit は従来通り `░░░░░░░░ 0%` と表示されることを確認します。

### PR #59 Codex shell-only commit が trailer 付き no-note になる

- 対象 PR: `#59`
- 対象 commit: `afcb2d9 docs: normalize agent names on website`
- 観測結果: commit message には `Agentnote-Session: 019da962-23cc-7aa0-bbe3-a10f60fddada` が入っていましたが、`git notes --ref=agentnote show afcb2d9` は `no note found` でした。そのため PR Report では AI 判定できず、commit table では prompt / file 情報が欠落しました。
- 直接原因: 変更は Codex の `apply_patch` ではなく shell command による一括置換で行われていました。Codex adapter は安全側のため、shell command だけから `files_touched` や AI-authored files を推測しません。
- 設計漏れ: transcript 内に古い `apply_patch` edit が残っている場合、human-only skip guard が「current commit file には transcript edit がなく、別 file への transcript edit だけがある」と判断し、current turn の shell-only tool activity まで空 note として skip していました。結果として trailer はあるのに note がない状態が再発しました。
- 修正: current prompt window に `files_touched` を持たない tool-backed Codex interaction がある場合は、shell-only work として prompt-only note を残します。ただし shell command から file attribution は推測せず、`files_touched` は付けず、AI ratio は 0% のままにします。cross-turn commit では shell-only fallback を出さず、古い `apply_patch` が別 file にあるだけの human-only commit は引き続き skip します。
- 追加修正: Codex でも `transcript_path` だけの metadata-only session は recordable としません。少なくとも `prompts.jsonl` / `changes.jsonl` / `pre_blobs.jsonl` のいずれかが必要です。
- Regression coverage: `packages/cli/src/core/record.test.ts` に PR #59 型の shell-only Codex regression を追加し、古い transcript edit があっても current shell-only prompt が prompt-only note として残ること、file attribution は付かないことを確認します。同じ test file に 100+ case の shell-only fallback simulation を追加し、current no-file tool activity だけが rescue され、true human-only commit は skip されることを確認します。`packages/cli/src/core/session.test.ts` に 100+ case の recordable session matrix を追加し、`transcript_path` 単体ではどの Agent でも recordable にならないことを確認します。`packages/cli/src/commands/codex.test.ts` は shell の `echo` 経由ではなく stdin に JSON を直接渡すようにし、改行を含む prompt でも実際の hook と同じ形で `prompts.jsonl` が作られることを確認します。

### Prompt window policy の module 分離

- 対象 PR: `#53` の follow-up
- 目的: prompt selection policy を次に変更するとき、状態遷移の読み間違いで regression を増やさないように、prompt window の保存判定を dedicated module に分離しました。
- 修正: `packages/cli/src/core/prompt-window.ts` を追加し、`PromptWindowRow`、window anchor score、tail dedupe、task-boundary trim、max-entry trim、persisted selection evidence の付与を `record.ts` から移しました。`record.ts` は commit data の収集、transcript attribution、entry assembly に集中します。
- 命名整理: prompt window 内だけで使う score は `windowFileRefScore` / `windowShapeScore` / `windowTextScore` に揃えました。これは `entry.ts` の runtime prompt score とは別物で、git note に保存されません。
- 維持した挙動: consumed tail prompt の dedupe、response anchor による review tail の救済、split commit carryover、Codex prompt-only fallback は既存 policy のままです。`Claude` / `Codex` / `Cursor` / `Gemini` すべてが同じ record-level policy を通ります。
- Regression coverage: PR #53 で追加した concrete regression、100+ case の task-boundary simulation、100+ case の consumed tail state-transition simulation、full CLI test 387 件で確認します。

### PR #52 prompt selection に前 commit の operational prompt が混入する

- 対象 PR: `#52`
- 対象 commit: `4be1573 ci: make npm alias publish rerunnable`
- 観測結果: PR body の Agent Note で、`4be1573` に `commit して PR までつくって` が表示されました。この prompt は直前 commit `c0e3505 ci: publish scoped npm alias` の commit / PR 作成指示であり、`4be1573` の変更理由そのものではありません。
- 正しい中心 prompt: `自己レビュー`。この turn で release workflow の再実行不能リスクを見つけ、`agent-note@<version>` / `@wasabeef/agentnote@<version>` が既に npm にある場合は publish step を skip する修正を入れました。
- raw note の状態: `4be1573` には `commit して PR までつくって`、`自己レビュー`、`commit push` が保存されています。`commit push` は compact 表示では落ちており妥当ですが、`commit して PR までつくって` は `response_basename_or_identifier` と `between_non_excluded_prompts` により medium 相当として残っていました。
- 原因: 前 commit で `prompt_scope: "tail"` として記録された prompt が、次 commit では `tail` ではなく通常の `window` として再評価されていました。そのため `isConsumedTailPrompt` の除外が効かず、前 commit の commit / PR boundary prompt が後続 commit の compact 表示に復活できました。
- 修正: consumed tail prompt は、次 commit で primary edit turn になった場合、または Codex の prompt-only fallback path の場合だけ再評価します。通常の prompt window では、古い tail prompt を `window` context として復活させません。
- Regression coverage: `packages/cli/src/core/record.test.ts` に PR #52 型の regression を追加しました。`4be1573` 相当の compact candidate では `自己レビュー` だけが残り、`commit して PR までつくって` は復活しないことを確認します。同時に、consumed tail prompt が後続 commit の primary edit turn になった場合は `primary` として再評価できることも確認します。
- Follow-up 修正: `4be1573` では `自己レビューを5回やって` も commit 前の重要な品質確認でしたが、prompt 本文に file anchor がないため落ちていました。response に current commit file / identifier の anchor がある tail prompt は残すようにし、edit turn ではない review / verification prompt も compact に出せるようにしました。
- Simulation coverage: `Claude` / `Codex` / `Cursor` / `Gemini`、過去 scope (`none` / `window` / `tail`)、次 commit での再解釈 (`window` / `tail` / `primary` / `fallback`)、prompt shape (`plain` / `substantive` / `exact-file` / `diff-id` / `quoted` / `tiny`)、response anchor、commit boundary、post-primary edit barrier、non-primary edit turn を組み合わせた 4,608 ケースの state-transition simulation を追加しました。旧 `isTail` 限定 dedupe なら復活してしまうケースを検出し、強い file anchor がある古い tail prompt でも通常 window context としては復活しないことを確認します。同時に、response が current commit に強く接続する review tail prompt は保持できることも検証します。
- 注意点: `prompt_scope: "tail"` は `maxConsumedTurn` を進めない設計のままです。split commit で同じ prompt が別 file の primary edit を持つケースと、Codex の prompt-only fallback は維持します。

### PR #49 prompt selection に過去タスクの prompt が混入する

- 対象 PR: `#49`
- 対象 commit: `ae056f4 refactor: centralize constants`
- 観測結果: PR body の Agent Note に、今回の定数化とは関係ない `もう次の作業はないので、プロンプト選択の改善をもう一度やってみよう` と `https://wasabeef.github.io/AgentNote/dashboard のリダイレクトはなおった？` が表示されました。
- 原因: `selectCommitPromptWindow()` が `primaryTurns.has(turn)` を commit-to-commit window の下限より優先していたため、過去 task の primary prompt が current commit に復活できました。特に Codex transcript-driven path では、過去 transcript edit が今回 commit file と同じ file を触っていると、line-count suffix matching の候補に入りやすくなります。
- 修正: commit-to-commit window 外の primary prompt を無条件に残さないようにしました。現在 window に説明できる prompt がある場合、window 外 primary は stale task history として落とします。現在 window に説明がない場合だけ split commit の carryover として残すため、同じ prompt で複数 file を編集して別 commit に分けるケースは維持します。
- Regression coverage: `packages/cli/src/core/record.test.ts` に PR #49 型の Codex transcript regression を追加しました。修正前は `improve prompt selection scoring again` が混入して失敗し、修正後は current task の `centralize constants and comments in Agent Note` と `add coding rules documentation` だけが残ることを確認します。
- Simulation coverage: `Claude` / `Codex` / `Cursor` / `Gemini`、window 外 primary、正当な split commit carryover、current window prompt、tail after barrier、non-primary edit barrier、stale leading window を組み合わせた 192 ケースの policy simulation を追加しました。legacy の primary-turn bypass が stale prompt を拾う危険なケースを明示的に検出します。

### `prompt_detail` preset の整理

- 対象: PR Report / GitHub Action の `prompt_detail` preset
- 対象 PR: `#45` の follow-up
- 観測結果: 旧 `compact` は表示を絞りすぎ、PR #45 では `2/7`、直近 80 commit の note 集計では約 8% しか表示されませんでした。一方、旧 `standard` 相当の範囲は PR #45 では `4/7`、直近集計では約 13% で、実質的に「PR body に載せたい compact view」として機能していました。
- 問題: `standard` という名前は基準が曖昧で、旧 `compact` は削りすぎて意図が落ちやすいです。利用者にとっては `compact` と `full` の 2 択の方が分かりやすい可能性があります。
- 修正: `prompt_detail` の公開 preset を `compact` / `full` の 2 つに整理しました。`compact` は commit の説明に必要な prompt を中心に表示し、`full` は保存済み prompt すべてを表示します。
- 互換: 既存 workflow への安全弁として、`standard` は parser で `compact` の legacy alias として受けます。ただし README / website / Action docs には出しません。
- 確認範囲: PR Report、CLI `agent-note pr --prompt-detail`、GitHub Action `prompt_detail` input、README / website / docs の説明を更新しました。
- Regression coverage: `packages/cli/src/core/entry.test.ts` と `packages/pr-report/src/report.test.ts` で、`compact` の表示範囲、`full = all`、`standard` alias を検証します。

### Dashboard の `0/0 AI-added lines` 表示

- 対象: Dashboard の PR / commit summary に出る `AI-added lines` 表示
- 観測結果: file-level attribution の commit では git note の `attribution.lines` が存在しないため、Dashboard 側で `ai_added ?? 0` / `total_added ?? 0` として `0/0 AI-added lines` が表示されます。
- 例: Codex の transcript 行数と最終 commit diff が一致しない commit は安全側で `method: "file"` になり、`attribution` は `{ "ai_ratio": 75, "method": "file" }` のように `lines` を持ちません。
- 問題: `0/0` は「AI-added lines が本当に 0」という意味に見えますが、実際には「line-level data unavailable」です。利用者に誤解を与える可能性があります。
- 対応案: `attribution.lines` がない、または `total_added` が 0 の場合は `AI-added lines` pill を非表示にするか、`file-level attribution` / `line data unavailable` のような method-aware な表記に変えます。
- 確認範囲: PR summary、commit summary、commit list の lines 表示をすべて見直し、line-level attribution の commit では従来通り `x/y AI-added lines` が表示されることを確認します。
- テスト方針: Dashboard fixture か source-level test で、`method: "file"` かつ `lines` なしの note が `0/0 AI-added lines` を出さないことを検証します。
- 修正: line-level data がある場合だけ `x/y AI-added lines` を出し、file-level attribution では `File-level attribution`、その他の欠損では `Line data unavailable` と表示します。PR summary で一部 commit だけ line-level data を持つ場合は `partial` を付けて、集計範囲が限定されていることを示します。
- Regression coverage: `packages/dashboard/workflow/dashboard-source.test.mjs` で、Dashboard が欠損 line data を `0/0 AI-added lines` として出さないことを source-level で検証します。

### Prompt detail filter の過剰 filter 確認

- 対象: `prompt_detail` の runtime scoring
- 対象 PR: `#44`
- 観測結果: local Agent Note notes、PR #29 / #33 / #43 / BUGS PR 群、英語 OSS PR snippet、synthetic multilingual cases を混ぜて 20,000 cases の simulation を実施しました。
- 対象言語: English, 日本語, Español, Deutsch, Français, Italiano, Português, Bahasa Indonesia, Русский, العربية, 简体中文, 한국어
- 結果: 旧 `standard` 相当、つまり現 `compact` の過剰 filter risk は、raw simulation では 13 件検出されました。ただし内訳は `Risk`, `Problem`, `Root cause`, `Verification` のような PR template heading / one-word heading で、prompt 自体の情報量が弱く、response path だけで `compact` に出すべきではないと判断しました。
- 修正: `substantive_prompt_shape` を追加し、長めの質問・相談は keyword なしで `medium` に上げます。一方で `commit push`, `PR 作成`, `please create the pull request` のような操作指示は、response 側に path があっても `low` に留めます。
- Regression coverage: `packages/cli/src/core/entry.test.ts` と `packages/cli/src/core/record.test.ts` に、CJK の長め相談が `compact` に残る case、operation-only prompt が `compact` に上がらない case、response evidence だけでは tail を `medium` にしない case を追加しました。
- 設計メモ: 詳細は `docs/knowledge/prompt-selection.md` の `Substantive prompt policy` と `Response evidence cap` に反映済みです。

### PR #34 go-ahead prompt の前段 context 表示

- 対象 PR: `#34`
- 対象 commit: `6af1e16 fix(dashboard): preserve truncated diff entries`
- 観測結果: PR body の Agent Note は prompt を 1 件だけ表示し、内容は `ブランチ切って作業開始` でした。response には `Dashboard diff 欠落表示`、`BUGS.md` の PR 1、binary / truncated diff、restore cleanup などの作業文脈が含まれていました。
- 判定: commit に入った Dashboard files はこの turn で編集されているため、causal prompt selection としては大きく間違っていません。一方で、user prompt 自体は短い go-ahead で、前段の作業指示や BUGS.md の作業順を知らない読者には「何を開始したのか」が弱く見えます。
- 調査結果: 現在は `interactions[].contexts[]` が実装済みです。短い prompt が直前 response に依存する場合は `reference`、current response の冒頭に作業範囲が明確に出る場合は `scope` として、PR Report と Dashboard は `📝 Context` を prompt の直前に表示します。
- 実装上の安全策: context は display-only metadata で、prompt selection、`files_touched`、AI ratio、attribution、note 作成可否には影響しません。keyword list で `はい` / `yes` / `continue` などを拾う方式ではなく、language-neutral な structural anchor だけを使います。
- 既存 coverage: `packages/cli/src/core/interaction-context.test.ts` と `packages/cli/src/core/record.test.ts` で、短い go-ahead prompt、previous response の file / code anchor、transcript response fallback、anchor がない場合の省略、previous turn がすでに selected の場合の省略を検証しています。
- 注意点: 既に生成済みの PR #34 body / git note は retroactive には更新されません。また、前段 response が `BUGS.md` の作業順のような概念説明だけで、commit file / code symbol への anchor を含まない場合は、意図的に context を省略します。
- 結論: future case は現在の Prompt Context 実装で対応済みのため、追加実装は不要です。

### PR #32 prompt selection regression

- 対象 PR: `#32`
- 対象 commit: `f8d7cae feat(action): route dashboard through root action`, `8bc068f fix(dashboard): persist notes without switching workspace`
- 原因は、Codex の transcript-driven path で古い同一ファイル interaction が `primaryTurns` として復活し、`maxConsumedTurn` をバイパスしていたことでした。`8bc068f` では現在の edit が synthetic prompt 配下にあり `prompt_id` と対応できなかったため、過去の package split prompt が誤って採用されました。
- 修正では、transcript primary candidate を `prompt_id:file` の消費状態で判定します。legacy の prompt-only consumed entry は stale revival 防止のため全 file 消費済みとして扱い、新しい prompt-window marker は `maxConsumedTurn` の前進だけに使います。
- split commit を壊さないよう、transcript 由来の消費状態は file 単位で保存します。同じ prompt が `src/a.ts` と `src/b.ts` を編集し、別 commit に分けられた場合、`src/a.ts` で消費済みでも `src/b.ts` には再利用できます。
- synthetic prompt 配下の現在 edit は、現在 window の user prompt より後に出た unlinked transcript edit の場合だけ prompt-only fallback を使います。これにより、古い synthetic edit が将来の prompt と偶然つながるリスクを下げています。
- regression test では、PR #32 型の stale same-file prompt 復活を防ぐケースと、split commit の正当な prompt 再利用を守るケースを追加しました。
- 追加の境界確認では、Cursor の `change_id` と Gemini の `tool_use_id` を使う record-level regression test も追加し、adapter 単体ではなく `recordCommitEntry()` 経由で consumed change が古い prompt を復活させないことを確認します。

### Prompt selection

- 対象 PR: `#27`, `#29`, `#30`
- 旧実装の狭い prompt heuristic は、最終 edit turn に依存しすぎていました。そのため、commit 単位で必要な setup context が落ちる一方で、別ケースでは古い同一 session の議論が後続 note に混ざることがありました。
- 現在の方針は commit-to-commit prompt window です。前回記録済み commit の直後から始め、現在の commit に残った edit turn までの context を残し、構造的に stale な先頭 context だけを trim します。
- 選択ロジックは language-neutral である必要があります。turn boundary、edit ownership、path 参照、commit metadata との Unicode token overlap、list/code 形状、quoted-history 形状などの構造 signal を使い、日本語や英語の command keyword list は使いません。
- regression case には、`PR #29` の package split prompt history と、`PR #30` の prompt-only Codex fallback を含めます。
- 成功条件は、commit を説明する planning / clarification / review context が残り、stale な quoted history が trim され、全 supported agents (`Claude`, `Codex`, `Cursor`, `Gemini`) が安全に note を記録し続けることです。

### Missing commit notes

- 対象 PR: `#29`、`#30` で修正済み
- 主な再現例: `e1e1596` は `Agentnote-Session` trailer を持っていたのに git note がなく、前後の commit には note がありました。
- 修正では、transcript attribution が committed files を拾えない prompt-only Codex case でも、正当な note を落とさないようにしました。同時に human-only skip path は維持しています。
- regression coverage では、workflow-only edit、consumed turn / file pair、prompt-only transcript fallback を継続して確認します。
