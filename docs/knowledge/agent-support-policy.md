# Agent Support Policy

> この文書は Agent Note における non-Claude agent の `Preview` 表記を、
> どの条件で `Supported` あるいは `Full support` へ引き上げるかを定義する横断 policy である。
> 個別の実装経緯や詳細な制約は `archive/codex-support-plan.md`、`archive/cursor-support-plan.md`、
> `archive/gemini-support-plan.md` を参照し、この文書では release judgement と rollout 順を固定する。
>
> 2026-05-08 時点で `packages/cli` の `build` / `typecheck` / `lint` / `test` は green であり、
> 現在の議論は「実装が壊れているか」ではなく「どの条件で preview を外せるか」にある。

## 0. 結論

Claude 以外を一括で正式化するのではなく、agent ごとに promotion する。
現在の public status は次の通り。

1. **Claude Code**: `Full support`
2. **Cursor**: `Supported`
3. **Codex CLI**: `Supported`
4. **Gemini CLI**: `Preview`

Gemini CLI だけを `Preview` に残す理由は明確である。

- Gemini CLI は upstream 側の event / transcript 仕様に未確定事項があり、実機検証が promotion gate になる

これまでの rollout は次の状態である。

- **Phase 1**: Cursor を `Supported` に引き上げ済み
- **Phase 2**: Codex CLI を `Supported` に引き上げ済み
- **Phase 3**: Gemini CLI は実機検証完了まで `Preview` 維持

このとき、Claude の `Full support` は「行単位 attribution が通常経路で成立する最上位 tier」として残す。
Codex CLI と Cursor は `Supported` であっても attribution の精度は条件付き line-level のままでよい。

## 1. 目的

この計画の目的は次の通り。

- `Preview` と `Supported` の境界を曖昧な印象論ではなく、release gate として定義する
- support status と attribution fidelity を混同しない
- README、website、CLI status の説明を同じ意味体系にそろえる
- agent ごとの deferred item を「未完成」ではなく「何を満たせば昇格できるか」で説明できるようにする

## 2. 対象範囲

対象は次の 3 agent である。

- `Codex CLI`
- `Cursor`
- `Gemini CLI`

この文書は Claude Code の実装計画書ではない。
ただし promotion judgment の基準線として、Claude Code の現在地を参照する。

## 3. 非目標

この計画では次を同時にやらない。

- 全 agent を Claude と同じ attribution 手法に統一する
- note schema を promotion のためだけに変更する
- transcript parser を 1 つの共通実装に全面統合する
- すべての agent を同一 release で一括昇格する
- optional optimization を promotion blocker として扱う

## 4. Support Tier の定義

### 4.1 `Preview`

`Preview` は「実装済みだが、まだ正式サポートの約束を置かない」段階である。
次のいずれかが残っている場合は `Preview` とする。

- upstream event schema や transcript schema に高優先度の未確定事項がある
- 実機 session から採取した fixture が足りず、test が synthetic payload 中心である
- normal `git commit`、`show`、`log`、`pr`、`status` の一連動作を安定保証できない
- fallback 条件や deferred 理由が docs 上で十分説明されていない

### 4.2 `Supported`

`Supported` は「通常利用を推奨できる」段階である。
行単位 attribution が常時取れることまでは要求しない。

`Supported` の条件は次の通り。

- generated git hooks を入れた通常の `git commit` が期待通りに動作する
- `agent-note commit` fallback も継続して動作する
- `show` / `log` / `pr` / `status` が当該 agent の note を問題なく扱える
- 実機 session 由来の fixture と regression test がある
- 既知の limitation と fallback 条件が README と website に明記されている
- promotion 後に support すると言える範囲が、maintainer の言葉で説明できる

### 4.3 `Full support`

`Full support` は最上位 tier であり、単に「使える」以上の意味を持つ。
少なくとも次を期待する。

- attribution の主経路が line-level である
- core workflow が upstream の一時的な不確定仕様に強く依存していない
- fallback が補助経路であり、通常経路ではない

2026-04-15 時点では、この tier は Claude Code のみを想定する。

## 5. Promotion 判定の原則

support status と attribution fidelity は別軸として扱う。
ここを混同すると、Codex CLI や Cursor のように「十分実用だが line-level は条件付き」という agent が、
永続的に `Preview` に留まってしまう。

したがって、public docs では少なくとも次を分離して説明する。

- **Status**: `Preview` / `Supported` / `Full support`
- **Attribution**: `file-level` / `conditional line-level` / `line-level`

この整理により、次が可能になる。

- Cursor を `Supported` に保ちつつ、line-level は conditional のまま説明する
- Codex CLI を `Supported` に保ちつつ、transcript-driven であることを limitation として明示する
- Gemini CLI は file-level でも `Supported` になりうるが、upstream 未確定事項がある限りは `Preview` に留める

## 6. 共通 Promotion Gate

non-Claude agent を `Supported` へ上げる前に、少なくとも次を満たす。

- `packages/cli` で `npm run build`、`npm run typecheck`、`npm run lint`、`npm test` が green
- 実際の agent session から採取した fixture をもとに adapter test と command test がある
- generated git hooks を入れた通常の `git commit` で note 記録まで確認できる
- `show` / `log` / `pr` / `status` が当該 agent の note を表示できる
- session / transcript path の validation が path traversal や prefix trick に耐える
- fallback 条件が「暫定 workaround」ではなく「正式な secondary path」として説明されている
- README と website の support matrix が同期している
- release note に promotion 理由と既知 limitation を書ける

## 7. 現在地

### 7.1 Claude Code

Claude Code は promotion の対象ではなく、基準線である。
現在の意味づけは次の通り。

- status: `Full support`
- attribution: line-level が通常経路
- role: 他 agent の promotion gate を考える際の baseline

### 7.2 Cursor

Cursor は最も promotion に近い。
個別計画でも、残差分は `beforeShellExecution` による safe command rewrite の確認であり、
これは optional optimization と整理されている。

現在の評価:

- normal `git commit` は generated git hooks 主体で成立している
- prompt / response / edits / shell fallback は現行実装で成立している
- file-level attribution は成立している
- line-level upgrade も安全条件付きで成立している
- 残件は parity 向上のための追加検証であり、MVP 不足ではない

判断:

- **promotion 候補の最優先**
- `beforeShellExecution` rewrite が未確定でも `Supported` 判定は可能

### 7.3 Codex CLI

Codex CLI は `Supported` とする。
ただし transcript-driven な設計なので、attribution fidelity は Claude Code と同じ意味ではない。

現在の評価:

- session / prompt / model / transcript path の取得は成立している
- prompt / response / files_touched の transcript 復元は成立している
- patch 行数が commit と一致したときの safe line-level upgrade は成立している
- 通常は file-level attribution で説明可能である
- transcript が読めない、または不確かな場合は note を作らず安全側に倒れる
- shell-only の変更を transcript だけから AI-authored file と推測しない

判断:

- **`Supported` 維持**
- transcript-driven limitation は README と website で明示する

### 7.4 Gemini CLI

Gemini CLI は実装・テスト・ドキュメントまではかなり進んでいるが、
upstream 側の未確定仕様が promotion blocker になっている。

現在の評価:

- adapter 自体は存在し、hook install / parse / basic extraction は実装済み
- file-level attribution の経路はある
- pending-commit パターンも実装済み
- ただし upstream 側の event 発火条件と transcript schema が十分に固定できていない

高優先度の未確定事項:

- shell tool 名の確定
- `BeforeAgent` の発火頻度
- transcript JSON schema の実機確認
- project hash と transcript 探索経路の確定

判断:

- **現時点では `Preview` 維持が妥当**
- 実機検証が終わるまで `Supported` へは上げない

## 8. 推奨 Rollout 順

### Phase 1: Cursor promotion

Status: 完了。

目的:

- `Preview` 表記を外し、最初の non-Claude `Supported` agent を作る

やること:

- 実機 session 由来 fixture の追加または再確認
- README と website の `Cursor | Preview` を `Cursor | Supported` へ更新
- limitation と deferred item を docs に固定
- release note に「Git hooks 主体での正式サポート」を明記

exit criteria:

- common promotion gate を満たす
- maintainers が `beforeShellExecution` rewrite 未対応を blocker ではなく deferred と説明できる

### Phase 2: Codex CLI promotion

Status: 完了。

目的:

- transcript-driven agent として最初の正式サポートを確立する

やること:

- transcript path validation の hardening
- parser の fixture 強化
- shell-only change recovery の到達範囲を docs に明示
- `status` で Codex の capture 詳細を表示するか検討し、必要なら追加する
- README と website の `Codex CLI | Supported` を維持する

exit criteria:

- common promotion gate を満たす
- transcript-driven limitation が docs 上で十分説明されている
- parser 破損時の failure mode が安全側である

### Phase 3: Gemini CLI promotion

Status: 未完了。Gemini CLI は `Preview` を維持する。

目的:

- upstream 仕様の未確定事項を解消し、正式サポート判定を可能にする

やること:

- 実機 Gemini CLI で event 発火と payload shape を採取する
- shell tool 名を確定する
- `BeforeAgent` の発火頻度を確認する
- transcript schema と探索経路を確定し、必要なら parser を修正する
- 実機 fixture ベースの test を追加する
- promotion 判断時に README と website の Gemini CLI status を更新する

exit criteria:

- common promotion gate を満たす
- 高優先度の未確定事項が解消している
- maintainer が upstream schema 依存の前提を説明責任付きで受け入れられる

## 9. 個別タスクの優先順位

promotion の実務優先順位は次の通り。

1. Gemini CLI の実機検証
2. Gemini CLI の parser / docs 更新
3. Gemini CLI の public status 更新判断

Cursor と Codex CLI の public status は更新済みである。

## 10. Rollback 方針

promotion は reversible に行う。
次のいずれかが起きた場合、その agent の `Supported` 表記は戻す。

- 実機で normal `git commit` が安定しない
- upstream payload 変更で prompt / response / file attribution の前提が崩れる
- synthetic test は通るが、実 session fixture を更新すると regression が出る
- fallback 条件の説明よりも failure rate の方が目立つ

重要なのは、1 agent の rollback が他 agent に波及しないことだ。
したがって promotion と rollback は agent ごとに独立して扱う。

## 11. 完了条件

この計画が完了したと言えるのは、次の状態である。

- Cursor が `Supported`
- Codex CLI が `Supported`
- Gemini CLI は `Supported` になるか、または `Preview` 維持の理由が実機検証ベースで明文化されている
- README と website の support matrix が現在の運用実態と一致している
- support status と attribution fidelity の説明が分離されている

## 12. 現時点の推奨判断

2026-05-08 時点の推奨判断を短く固定する。

- **Cursor**: `Supported` 維持
- **Codex CLI**: `Supported` 維持
- **Gemini CLI**: 実機検証完了後に promotion

したがって、次に着手すべき具体的な仕事は Gemini CLI の実機検証である。
