# Investigation History

このファイルは、解決済みの調査と regression の判断を残す場所です。未解決タスクの TODO list ではありません。

新しい調査を書くときは、対象 PR / commit、観測結果、原因、修正、regression coverage を残してください。

## Open Follow-ups

### Codex hook diagnostics

- `.codex/hooks.json` が存在しても、現在の Codex runtime が Agent Note hook を呼んで `.git/agentnote/session` を更新しているとは限りません。
- 次 PR では `agent-note status` か専用診断で、active session の `agent` / 最終 heartbeat / recordable files / installed git hook template version / agent hook enabled state を表示し、`Codex hook config exists but no recent Codex session was recorded` のような warning を出せるようにします。
- これにより、note がない原因を PR Report からではなく local diagnostics で切り分けられるようにします。

### PR #72 / #74 follow-up: env fallback の改善候補

PR #72 で `--fallback-env` を導入し、PR #74 で stale trailer retry と bounded display context を追加しました。現在の主要 regression は test で固定済みですが、追加調査の結果、以下は将来 PR で検討する価値がある改善候補です。いずれも現時点の blocker ではなく、debug 性・保守性・false negative 低減のための候補として扱います。

#### 1. Codex transcript 読み取りエラーの原情報を保存する

- 対象: `packages/cli/src/agents/codex.ts` `extractInteractions`
- 現状: stream の `for await` を try/catch で囲み、内部エラーを `throw new Error(\`Failed to read Codex transcript: ${transcriptPath}\`)` で再 throw します。元のエラー (EACCES、EISDIR、stream error 等) が失われ、debug 困難。
- 影響: 機能には影響なし。`record` の outer catch で warning として表示されるため commit は壊れません。
- 判断: 妥当。低リスクで、巨大 transcript / permission / filesystem error の切り分けが楽になります。
- 改善案: `throw new Error(message, { cause: err })` で原因を保持し、必要なら warning 側で `cause` の message も出します。

#### 2. session ID 検証の regex 不整合

- 対象: `packages/cli/src/commands/record.ts`
- 現状:
  - `readActiveSessionId`: `SESSION_ID_SEGMENT_RE = /^[A-Za-z0-9._-]+$/` (permissive)
  - `sanitizeSessionId` (env path): `UUID_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` (strict)
- 理由: active session pointer は repo-local internal state で、env 変数は process environment 由来です。そのため env path だけ strict UUID v4 にする設計は自然です。
- 影響: `readActiveSessionId` を strict 化すると、legacy / corrupted / manually-created session pointer を fallback で拾えなくなる可能性があります。これは「挙動変更なし」とは言い切れません。
- 判断: すぐ strict 化するより、まず診断表示を強化する方が安全です。
- 改善案: `agent-note status` などで active session id が UUID v4 でない場合に warning を出します。strict 化は、過去 version / repo-local hook との互換性を確認してから検討します。

#### 3. 環境衝突テストの追加候補

- 既存 test gap:
  - `existingAgent !== "codex"` で env fallback が reject される regression test なし
  - `recordHeadFallback` 直後に `recordEnvironmentFallback` が呼ばれた場合に `existingNote` idempotency で no-op する regression test なし
- 影響: 既存の integration tests は env fallback の成功・失敗・stale transcript・read-only shell・mutating shell・future row・stale trailer retry を広くカバーしています。一方、この 2 つは defensive guards の直接 test としてはまだ弱いです。
- 判断: 妥当。ただし現時点の挙動が壊れているわけではありません。
- 改善案: 上記 2 つの境界条件をテストとして固定する。

#### 4. SHELL_MUTATION_COMMAND_RE の網羅性

- 対象: `packages/cli/src/agents/codex.ts` `SHELL_MUTATION_COMMAND_RE`
- 現状: `apply_patch`, `cat >`, `cp`, `install`, `mkdir`, `mv`, `npm install/update/audit fix/dedupe/version`, `perl -i`, `pnpm add/install/update`, `rm`, `sed -i`, `tee`, `touch`, `yarn add/install/upgrade`, `>` `>>` をカバー。
- 未カバー: `chmod`, `chown`, `git apply`, `ln`, `dd`, `make` で生成、`pip install`, `gem install`, `bundle install`, `if true; then rm foo; fi` のような conditional 経由。
- 影響: false negative 方向 (under-attribute) 。Codex の mutating shell を 100% 検出しないが、false positive (manual edit を AI 認定) は起こらないため安全側。
- 判断: 妥当。ただし mutation regex は広げすぎると false positive を増やすため、追加は実データで頻出した command に限定します。
- 改善案: まず `git apply`、`chmod` / `chown`、`ln`、`make` のような developer workflow で頻出する command を候補にし、それぞれ read-only command と paired test を追加します。conditional shell は regex で無理に追わず、false negative として扱います。

#### 5. catastrophic transcript size (単一行 GB 級)

- 対象: streaming 化された Codex transcript reader
- 現状: 600MB の transcript ファイルを stream で読めるが、単一行が極大の場合 readline が 1 行をメモリにバッファするため OOM 可能性。
- 影響: 通常の Codex transcript (1 event = 1 line ≒ 数 KB 〜数百 KB) では問題なし。悪意ある単一巨大 line のみが OOM トリガー。
- 判断: 妥当だが優先度は低いです。通常の Codex JSONL では 1 event が 1 line なので、現実的な問題は transcript 全体サイズよりも 1 line の異常肥大です。
- 改善案: line size limit を追加し、超過行は skip または safe error にします。実装する場合は、巨大 line で commit hook が壊れず warning になる regression test を追加します。

---

これらの項目は、PR #74 時点で確認済みの機能的デグレではありません。実装する場合は、救済 path だけでなく false-positive path も同時に test で固定します。

## Resolved Investigations

### CLI dist tracking policy

- 決定: `packages/pr-report/dist/index.js` は tracked artifact として維持します。`action.yml` が GitHub Action runtime でこの bundle を直接実行するため、repository に存在しないと published Action が動きません。
- 決定: `packages/cli/dist/cli.js` も v1.x では tracked artifact として維持します。`packages/cli/package.json` の `bin.agent-note` は `./dist/cli.js` を指し、CI は build 後に `node packages/cli/dist/cli.js version` を smoke test し、repo-local git hook shim も現在の built CLI path を pin します。
- 理由: CLI package は `prepublishOnly` と release workflow で build しますが、tracked `dist/cli.js` は npm package contract、test contract、repo-local development hook contract の 3 つを同時に満たしています。公開直後の v1 系では、この安定性を PR diff の小ささより優先します。
- 運用: generated bundle は手編集しません。source を変更したら対応する build script で再生成し、必要な bundle 差分も同じ PR に含めます。`.agentnoteignore` は `packages/cli/dist/**` と `packages/pr-report/dist/**` を AI Ratio から除外しますが、git tracking から除外するものではありません。
- 将来 `packages/cli/dist/cli.js` を untrack する条件: release workflow が source から build した `npm pack` を検証すること、CLI tests が checked-in dist に依存しないこと、repo-local hook shim が source CLI または build-before-run strategy に移行していること、`AGENTS.md` / `CLAUDE.md` / docs が新しい前提に更新されていること。
- 非推奨: `packages/pr-report/dist/index.js` の untrack は、Action を composite から build-on-run / Docker / external package download に変える大きな設計変更なしには行いません。GitHub Action は checkout された action contents だけで即実行できるべきです。

### Missing commit notes after long or mismatched sessions

- 対象 PR: `#57`, `#58`, `#71`
- 対象 commit: `b28d52f feat(report): add reviewer context`, `56e6b48 fix(hooks): refresh heartbeat during long turns`, `17c2d1d docs: clarify trailer evidence paths`

この調査は、PR Report の commit table が `—` になる原因を 3 つに分けて整理します。`—` は PR Report の表示バグではなく、対象 commit に Agent Note の git note が存在しないことを意味します。

#### Case 1: stale heartbeat で trailer が付かない

- 観測結果: PR `#57` の `b28d52f` は `Agentnote-Session` trailer を持たず、`git notes --ref=agentnote show b28d52f` も `no note found` でした。
- 原因: 旧実装は `prompt` で heartbeat を更新していましたが、長い single turn 中の `file_change`、`response`、`pre_commit` では更新していませんでした。そのため、1 時間を超える AI 作業の最後に `git commit` すると、commit 直前に Agent hook event が来ていても heartbeat が stale のままになり、`prepare-commit-msg` が trailer 注入を skip しました。
- 修正: `agent-note hook` は、正規化された hook event を受けた時点で session heartbeat を更新します。これにより、長い turn の tool event、response、commit hook event が session freshness を延長します。Gemini の `SessionEnd` は true session termination なので、従来通り最後に heartbeat を削除します。

#### Case 2: metadata-only session に trailer だけ付く

- 観測結果: PR `#58` の `56e6b48` は `Agentnote-Session` trailer を持っていましたが、git note は作成されませんでした。
- 原因: commit 時点の session は `SessionStart` / `transcript_path` / heartbeat だけの metadata-only session でした。`recordCommitEntry()` は `interactions.length === 0 && aiFiles.length === 0` の空 note を安全側で skip するため、trailer だけが残りました。
- 修正: `transcript_path` は補助 metadata であり、単体では recordable data として扱いません。`prepare-commit-msg`、`agent-note commit`、Agent の `PreToolUse git commit` は、metadata-only session に trailer を付けません。

#### Case 3: fresh prompt-only active pointer が plain git commit を hijack する

- 観測結果: PR `#71` の直近 commit 群は長時間作業ではなく短時間でも欠落しました。`17c2d1d` も `Agentnote-Session` trailer と git note を持たないため、PR Report では `—` になります。
- 原因: `.git/agentnote/session` が現在の Codex 作業 session を正しく表しておらず、fresh な active session pointer が `prompts.jsonl` だけを持つ状態でした。plain `git commit` の `prepare-commit-msg` は commit command が Agent 内で観測されたかを判断できないため、prompt-only session に trailer を付けると別 session hijack の危険があります。
- 修正: plain `git commit` 経路（`prepare-commit-msg`）は、fresh heartbeat に加えて `changes.jsonl` または `pre_blobs.jsonl` の file evidence がある session だけに trailer を付けます。Agent の `PreToolUse git commit` 経路は、commit command 自体が Agent 内で観測されているため prompt-only rescue を維持します。`agent-note commit` も wrapper 内で session を確認できるため、`prompts.jsonl` / `changes.jsonl` / `pre_blobs.jsonl` のいずれかを recordable data として扱います。
- Follow-up 修正: cmux などの Agent host 上では、`.git/agentnote/session` が更新されなくても process environment に現在の Agent session が残る場合があります。`CODEX_THREAD_ID` がある場合、`post-commit` は `--fallback-env` で fresh な Codex transcript を探します。transcript が現在 commit file に直接接続できる場合は通常の file/line attribution を使い、file touch を特定できなくても current transcript の mutating shell work がある場合は v0.2 系に近い commit-level attribution として commit files を AI 扱いします。古い transcript mtime は拒否するため、stale な Codex session は救済しません。
- Follow-up 修正 2: `--fallback-env` は current process の fresh transcript を信用する一方で、record 時の prompt selection が stale な `.git/agentnote/sessions/<id>/prompts.jsonl` に引きずられると、fresh transcript が commit file に接続できても note が作られないことがありました。environment fallback では stale repo-local prompt window に依存せず、fresh transcript の末尾から commit files を覆う最小の matched interaction を選びます。親 commit 以降の matched row があればそれを優先し、なければ前 commit の直前から準備していた同一 task の matched row を救済します。これにより、cmux のような host で `.git/agentnote/session` が古くても、現在の Codex transcript に file evidence があれば note が作られます。
- Follow-up 修正 2 の tolerance: Git commit timestamp と transcript JSONL write timestamp には数秒のズレがあり得るため、parent / HEAD 境界には 30 秒の許容幅を持たせます。これは clock skew の吸収には十分で、commit 後に行う debug / verification prompt を混ぜるには短い値として選んでいます。
- Follow-up 修正 3: 実 repository の Codex transcript は 600MB を超えることがあり、adapter が `readFile()` で transcript 全体を文字列化すると Node の string size / memory 制限で失敗し、post-commit hook の safety catch により note が silently skipped されました。Codex transcript parser は JSONL を stream で読み、巨大 transcript でも現在 commit に接続できる interaction を抽出できるようにします。
- Follow-up 修正 4: 後追い recording や遅延した fallback では、fresh transcript の中に対象 commit 後の debug / verification conversation も含まれます。recording は HEAD commit timestamp より後の transcript row を除外し、未来の同一 file edit を誤って prompt として採用しません。
- Follow-up 修正 5: `writeNote()` が `git notes add` の non-zero exit を `gitSafe()` 経由で飲み込むと、recording は `promptCount > 0` を返すのに git note が存在しない状態になります。`writeNote()` は git note 書き込み失敗を例外にし、hook entrypoint 側の safety catch で warning に変換します。これにより commit は壊さず、PR Report の `—` 原因を診断できます。

#### Safe fallback

- `prepare-commit-msg` が stale heartbeat のため trailer 注入を skip した場合だけ、one-shot の `post_commit_fallback` marker を書きます。
- `post-commit` は trailer がなく、かつ marker がある場合だけ `agent-note record --fallback-head` を呼びます。
- fallback は `.git/agentnote/session` を無条件に信じません。active session に recordable data があり、かつ `changes.jsonl` の post-edit `blob` が HEAD の committed blob と一致する場合だけ `recordCommitEntry()` に進みます。
- `--fallback-head` は prompt-only / metadata-only / unrelated file evidence / same-path different-blob evidence を救済しません。これは stale `.git/agentnote/session` pointer を再び信用しないためです。
- `--fallback-env` は `.git/agentnote/session` を使わず、adapter が current process から読み出した session id だけを候補にします。現時点では Codex の `CODEX_THREAD_ID` だけが対象です。Codex transcript は adapter の transcript discovery で探し、heartbeat または transcript mtime が fresh な場合だけ `recordCommitEntry()` に進みます。これは cmux のような host が Codex process environment を維持しているケースの救済であり、古い active pointer を再び信用するものではありません。
- `--fallback-env` で選ばれた current Codex transcript に commit file と直接つながる interaction がある場合、stale な repo-local prompt window ではなく transcript 側の matched interaction を採用します。複数 file の commit では、transcript 末尾から commit files を覆う最小の interaction set を使います。
- `--fallback-env` で選ばれた current Codex transcript に mutating shell interaction がある場合、file touch が取れなくても commit-level attribution として commit files を `by_ai: true` にします。これは v1 の stale pointer guard は残しつつ、v0.2 系の「AI が関わった commit を見失わない」挙動へ戻すためです。`git status` や test run のような read-only shell activity は env fallback attribution には使いません。`files_touched` は per-prompt file evidence なので推測では埋めません。
- Codex transcript は stream で読みます。これは memory optimization ではなく correctness requirement です。長期 session の transcript が巨大化しても、recording should fail safe only for unreadable files, not for large but valid JSONL.
- Transcript row の timestamp が HEAD commit より後の場合は recording から除外します。親 commit 以降の matched row がある場合は、親 commit より前の row も除外します。親 commit 以降に matched row がまったくない場合だけ、前 commit の直前から準備していた同一 task の matched row を救済します。これは後追い `--fallback-env` で、過去 task の同一ファイル prompt や対象 commit 後に実行した調査・debug prompt が PR Report に混入することを防ぎつつ、連続 commit の作業順で正しい transcript を見失わないためです。
- HEAD blob 読み取りは `git diff-tree -z --raw` を使います。NUL 区切りで読むことで、Git の `core.quotePath=true` による path quote を避け、`src/日本語 file.ts` のような path でも post-edit blob evidence を正しく照合します。
- Git note 書き込み失敗は silent success にしません。`record` command は warning を出して終了し、git commit 自体は成功させます。

#### Display behavior

- PR Report は git note を読むだけなので、表示可否は実際に使った Agent 名ではなく、対象 commit に git note が作られているかで決まります。
- `tracked_commits === 0 && total_commits > 0` の場合、`Total AI Ratio: ░░░░░░░░ 0%` ではなく `Total AI Ratio: —` と `Agent Note data: No tracked commits` を表示します。これで missing note と true 0% attribution commit を分離します。

#### Regression coverage

- `packages/cli/src/commands/hook.test.ts`: `PreToolUse` の `git commit` hook が stale heartbeat を更新すること、metadata-only session では trailer を注入しないことを確認します。
- `packages/cli/src/commands/init.test.ts`: 生成された `prepare-commit-msg` hook が metadata-only session と fresh prompt-only session を skip し、file evidence がある session だけに trailer を入れることを確認します。同じ test file で、stale heartbeat のため trailer がない commit でも post-edit blob が HEAD blob と一致すれば post-commit fallback が note を作成し、stale prompt-only session、same-path different-blob session、amend commit は note を作らないこと、root commit と quoted raw diff path でも fallback が動くことを確認します。さらに、`.git/agentnote/session` が unrelated prompt-only session を指していても、fresh な `CODEX_THREAD_ID` transcript が commit file に接続できる場合だけ environment fallback が note を作り、stale transcript は拒否することを確認します。Codex session directory に古い `prompts.jsonl` が残っていても、fresh transcript が commit file に直接接続できれば note が作られる regression、parent commit 以降の matched row がある場合は parent より前の stale row を選ばない regression、parent commit より前に準備済みで newer match がない同一 task を救済する regression、read-only shell transcript を AI attribution にしない regression、mutating shell transcript を commit-level attribution として救済する regression、commit 後の future transcript row を選ばない regression もここで固定します。
- `packages/cli/src/core/record.test.ts`: 180 case の fallback evidence simulation を追加し、`Claude` / `Codex` / `Cursor` / `Gemini`、current / rotated `changes` / `pre_blobs`、matching / unrelated / empty evidence、prompt-only noise を組み合わせて fallback predicate を検証します。
- `packages/cli/src/core/storage.test.ts`: `git notes add` が失敗した場合に `writeNote()` が例外を返すことを確認し、`promptCount > 0` なのに note がない silent success を防ぎます。
- `packages/cli/src/commands/commit.test.ts`: manual `agent-note commit` も同じ条件を使うことを確認します。
- `packages/pr-report/src/report.test.ts`: note missing commit は `Total AI Ratio: —`、true 0% attribution commit は従来通り `░░░░░░░░ 0%` と表示されることを確認します。

### PR #59 Codex shell-only commit が trailer 付き no-note になる

- 対象 PR: `#59`
- 対象 commit: `afcb2d9 docs: normalize agent names on website`
- 観測結果: commit message には `Agentnote-Session: 019da962-23cc-7aa0-bbe3-a10f60fddada` が入っていましたが、`git notes --ref=agentnote show afcb2d9` は `no note found` でした。そのため PR Report では AI 判定できず、commit table では prompt / file 情報が欠落しました。
- 直接原因: 変更は Codex の `apply_patch` ではなく shell command による一括置換で行われていました。当時の Codex adapter は安全側のため、shell command だけから `files_touched` や AI-authored files を推測しませんでした。
- 設計漏れ: transcript 内に古い `apply_patch` edit が残っている場合、human-only skip guard が「current commit file には transcript edit がなく、別 file への transcript edit だけがある」と判断し、current turn の shell-only tool activity まで空 note として skip していました。結果として trailer はあるのに note がない状態が再発しました。
- 修正: current prompt window に `files_touched` を持たない tool-backed Codex interaction がある場合は、shell-only work として note を残します。v1 の初期修正では AI ratio を 0% にしていましたが、これは v0.2 系の良かった「AI が関わった commit を広く拾う」体験を落としすぎました。現在は、guard を通過した current tool-backed work については commit-level attribution として commit files を `by_ai: true` にします。ただし shell command から per-prompt file attribution は推測せず、`files_touched` は付けません。cross-turn commit では shell-only fallback を出さず、古い `apply_patch` が別 file にあるだけの human-only commit は引き続き skip します。
- 追加修正: Codex でも `transcript_path` だけの metadata-only session は recordable としません。少なくとも `prompts.jsonl` / `changes.jsonl` / `pre_blobs.jsonl` のいずれかが必要です。
- Regression coverage: `packages/cli/src/core/record.test.ts` に PR #59 型の shell-only Codex regression を追加し、古い transcript edit があっても current shell-only prompt が note として残り、commit files が AI 扱いになること、ただし `files_touched` は推測されないことを確認します。同じ test file に 100+ case の shell-only fallback simulation を追加し、current no-file tool activity だけが rescue され、true human-only commit は skip されることを確認します。`packages/cli/src/core/session.test.ts` に 100+ case の recordable session matrix を追加し、`transcript_path` 単体ではどの Agent でも recordable にならないことを確認します。`packages/cli/src/commands/codex.test.ts` は shell の `echo` 経由ではなく stdin に JSON を直接渡すようにし、改行を含む prompt でも実際の hook と同じ形で `prompts.jsonl` が作られることを確認します。

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
