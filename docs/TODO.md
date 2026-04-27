# TODO

## 未解決の調査

### PR #32 prompt selection regression

- 対象 PR: `#32`
- 対象 commit: `f8d7cae feat(action): route dashboard through root action`, `8bc068f fix(dashboard): persist notes without switching workspace`
- 症状は 2 種類あります。`f8d7cae` は root Action dispatcher の本題 prompt も拾えていますが、以前の docs / prompt selection / PR preview 周りの会話が多く混ざっています。`8bc068f` はさらに悪く、本来は CI failure と `persist-notes` の workspace 切り替え修正の文脈が出るべきところ、過去の package split 作業の prompt が保存されています。
- PR body の rendering 問題ではありません。`git notes --ref=agentnote show <sha>` で確認すると、誤った `interactions` は note 本体に保存されています。
- 両 commit は同じ Codex `session_id` (`019da962-23cc-7aa0-bbe3-a10f60fddada`) を共有していました。この session は `2026-04-20` から `2026-04-27` まで続いており、複数 PR / branch の prompt と transcript が同じ session log に蓄積されています。
- `committed_pairs.jsonl` の `maxConsumedTurn` 自体は進んでいましたが、`selectCommitPromptWindow()` は `primaryTurns` を `lowerTurn` より優先して通します。これは split commit のための仕様ですが、今回のように過去の同一ファイル edit が `primaryTurns` になると、消費済みより古い turn でも prompt window に再流入します。
- `8bc068f` では `packages/dashboard/workflow/persist-notes.mjs` を過去の package split 作業でも触っていました。その古い transcript interaction が commit file と一致し、turn `361` / `362` が primary turn として復活した可能性が高いです。一方、実際に `8bc068f` の修正につながった直近 prompt は turn `531` 付近でしたが、note には採用されませんでした。
- `f8d7cae` のノイズは、長い Codex session で branch / PR をまたいだ未消費 prompt-only context が commit-to-commit window に残ったことが主因です。`PROMPT_WINDOW_MAX_ENTRIES` により 24 件には抑えられていますが、window の開始位置が作業単位としては広すぎました。
- 影響範囲は core の prompt selection です。再現しやすいのは Codex ですが、`selectCommitPromptWindow()` は共通処理なので、長寿命 session と同一ファイル再編集が重なる agent では同種の誤帰属が起こり得ます。
- 改善候補は、`primaryTurns` が `lowerTurn` を無条件にバイパスする仕様を見直すことです。split commit は守りつつ、消費済み turn を復活させる場合は「現在 commit の transcript suffix / diff count / session-local commit marker と一致する」など追加条件を置く必要があります。
- もう一つの改善候補は、branch ancestry や git note だけに頼らず、session-local に「最後に note を書いた commit / turn / transcript index」を marker として保存することです。これにより、branch 切り替えや PR をまたぐ長い Codex session でも、現在作業の lower bound をより正確に決められます。
- regression case には、`PR #32` の `f8d7cae` と `8bc068f` を追加します。期待値は、`f8d7cae` が root Action dispatcher の設計相談から始まり、`8bc068f` が CI failure / `persist-notes` workspace fix の prompt を含み、過去の package split prompt を含まないことです。

## 解決済みの調査

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
