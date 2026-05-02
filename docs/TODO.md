# TODO

## 未解決の調査

### PR #49 prompt selection に過去タスクの prompt が混入する

- 対象 PR: `#49`
- 対象 commit: `ae056f4 refactor: centralize constants`
- 観測結果: PR body の Agent Note に、今回の定数化とは関係ない `もう次の作業はないので、プロンプト選択の改善をもう一度やってみよう` と `https://wasabeef.github.io/AgentNote/dashboard のリダイレクトはなおった？` が表示されました。
- 原因候補: 同じ長い session 内で、今回タスク開始前の prompt が `primary` / `window` として残っています。特に前者は過去タスクで `packages/cli/src/core/constants.ts` / `packages/cli/src/commands/init.ts` を触っており、今回 commit でも同じ file が含まれたため、古い primary edit turn が復活した可能性があります。
- 問題: `prompt_detail=compact` でも関係ない過去タスクの prompt が出ると、PR の作業意図が読みにくくなります。`selection.signals` が強くても、現在の task boundary より前の prompt は current commit から除外できる必要があります。
- 調査方針: session 内の明確な task start / branch switch / first current-task edit を boundary として扱えるか、または previous commit / consumed marker だけでは切れない長期 session の stale primary をどう抑えるかを検討します。keyword list ではなく、turn boundary、branch creation、commit boundary、current-task first edit、path ownership などの structural signal を優先します。
- Regression case: PR #49 の `ae056f4` note を fixture 化し、今回タスクの prompt (`ちょっとここでリファクタリングしたい`, `docs/ 以下にコーディングルール`, `全てのファイルを精査`, `定数化の作業が終わったら...`) は残し、過去の prompt selection / dashboard redirect prompt は落ちることを検証します。

## 解決済みの調査

### `prompt_detail` preset の整理

- 対象: PR Report / GitHub Action の `prompt_detail` preset
- 対象 PR: `#45` の follow-up
- 観測結果: 旧 `compact` は `high` のみを表示し、PR #45 では `2/7`、直近 80 commit の note 集計では約 8% しか表示されませんでした。一方、旧 `standard` は `high + medium` を表示し、PR #45 では `4/7`、直近集計では約 13% で、実質的に「PR body に載せたい compact view」として機能していました。
- 問題: `standard` という名前は基準が曖昧で、旧 `compact` は削りすぎて意図が落ちやすいです。利用者にとっては `compact` と `full` の 2 択の方が分かりやすい可能性があります。
- 修正: `prompt_detail` の公開 preset を `compact` / `full` の 2 つに整理しました。`compact` は `high + medium`、`full` は保存済み prompt すべてを表示します。
- 互換: 既存 workflow への安全弁として、`standard` は parser で `compact` の legacy alias として受けます。ただし README / website / Action docs には出しません。
- 確認範囲: PR Report、CLI `agent-note pr --prompt-detail`、GitHub Action `prompt_detail` input、README / website / docs の説明を更新しました。
- Regression coverage: `packages/cli/src/core/entry.test.ts` と `packages/pr-report/src/report.test.ts` で、`compact = high + medium`、`full = all`、`standard` alias を検証します。

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
- 設計メモ: 詳細は `docs/knowledge/PROMPT_SELECTION_SCORING_DESIGN.md` の `Substantive prompt policy` と `Response evidence cap` に反映済みです。

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

## 今後の cleanup

### CLI dist tracking

- 現状では `packages/cli/dist/cli.js` は package contract 上必要です。`packages/cli/package.json` の `bin.agent-note` は `./dist/cli.js` を指し、publish 対象も `dist` のみで、CI も `node packages/cli/dist/cli.js version` を直接実行しています。
- 一方で、repository が `dist` を tracked artifact として持ち続けるべきかは再検討します。`prepublishOnly` / CI が必ず build する設計にできるなら、`dist` tracking は PR noise になる可能性があります。
- tracked `dist` を外す場合は、CI、test、release docs、local git hook shim の前提を更新し、実行前に必ず build するか source CLI を解決する形へ揃える必要があります。
