# Engineering Guidelines

このリポジトリでコードを書くときの実装ルールです。人間にも AI coding agent にも同じ基準で読めるように、判断基準をできるだけ明文化します。

`AGENTS.md` / `CLAUDE.md` は作業時の振る舞い、`CONTRIBUTING.md` は contributor の手順、このファイルはコードそのものの品質基準を扱います。

## 使い方

- 実装前に、触る領域の制約を確認する。
- PR review で判断が割れたら、このファイルを優先する。
- ルールを変えたくなったら、コード変更と同じ PR でこのファイルも更新する。
- 一時的な workaround はここに足さず、恒久ルールに昇格できるものだけを書く。

## 基本方針

- Source code、コメント、テスト名、CLI output は英語で書く。
- 明快さを優先し、過度な抽象化で処理の流れを隠さない。
- 構造変更と動作変更は分ける。リネーム、移動、整形だけの変更に挙動変更を混ぜない。
- GitHub Action / Dashboard workflow のような CI 上で動く処理は、失敗時にユーザーが原因を追えるログを残す。
- 現在の挙動を説明する情報は `docs/architecture.md` と `docs/knowledge/` に集約し、古い計画書を current rule として参照しない。

## 定数化

- magic number、event 名、state 名、branch 名、directory 名、Git ref、GitHub Actions output 名は名前付き定数にする。
- 1 つのファイル内だけで意味が閉じる値は、そのファイルの先頭に local constant として置く。
- 複数ファイルで同じ意味を持つ値だけを shared constant にする。共有化で依存関係が太る場合は、同名の local constant を許容する。
- 正規表現は `const` にするか、すぐ近くに意図が分かる名前を付ける。複雑な正規表現は短いコメントを添える。
- public API、schema field、persistent storage の値を変える場合は docs と tests を同時に更新する。

良い例:

```js
const EVENT_PULL_REQUEST = "pull_request";
const GITHUB_PAGES_BRANCH = "gh-pages";
```

避けたい例:

```js
if (eventName === "pull_request") {
  git(["fetch", "origin", "gh-pages"]);
}
```

## コメント

- コメントは「何をしているか」よりも「なぜ必要か」を説明する。
- exported function、workflow entry point、複雑な判定関数には TSDoc/JSDoc 形式の block comment を付ける。
- Agent Note の `📝 Context` として読まれても意味が通る短い英語コメントを優先する。
- obvious な代入や関数呼び出しにはコメントを付けない。
- fallback、heuristic、安全側の判断、永続化 boundary、外部 service 制約にはコメントを付ける。
- コメントと実装がズレると害が大きいので、挙動変更時は近くのコメントも必ず見直す。

良い例:

```js
/**
 * Merge the current dashboard snapshot into the durable gh-pages note store.
 *
 * The snapshot may contain only one PR, so the merge removes stale notes for
 * affected PRs and leaves every unrelated PR note in place.
 */
```

避けたい例:

```js
// Remove files.
rmSync(path, { force: true });
```

## Dashboard workflow

- `packages/dashboard/workflow/*.mjs` は GitHub Actions 上で直接実行されるため、環境変数、output、branch、path は定数名で意味を残す。
- `gh-pages/dashboard/notes/*.json` は Dashboard の durable store として扱う。PR build は partial snapshot なので、無関係な PR note を消してはいけない。
- Pages artifact を触る処理は workspace 内に閉じる。dynamic path や workspace 外 path は安全側に倒して skip する。
- Dashboard note JSON の上限や diff 上限は、Pages artifact size と UI 表示のための制約として定数化し、意図をコメントで残す。

## Tests

- Refactor だけでも、影響範囲の unit test を実行する。
- Dashboard workflow を触ったら `packages/dashboard` の test / build を確認する。
- PR Report rendering や Action input を触ったら `packages/pr-report` の test / build を確認する。
- CLI core / agent adapter を触ったら `packages/cli` の build、typecheck、lint、test を確認する。

## Commit messages and release notes

Release notes are generated from commits by `git-cliff`. Treat every commit
subject as public copy unless the commit type is intentionally internal.

- Use `feat:`, `fix:`, or `perf:` when users should see the change in the next release note.
- Use `docs:`, `test:`, `refactor:`, `ci:`, `chore:`, or `build:` for internal work that should normally stay out of release notes.
- If an internal-looking commit has public impact, add a body line: `Release note: <one clear user-facing sentence>`.
- If a public-looking commit should be hidden, add `Release note: skip`.
- Do not put release-worthy wording only in a PR title or merge commit. Merge commits, version bumps, and generated bundle sync commits are excluded from release notes.
- Avoid vague subjects such as `address review notes`, `sync generated bundle`, `polish docs`, or `fix tests`. Name the visible outcome instead.

Good commit body shape:

```text
Why
The PR report showed absorbed external review prompts in compact mode.

User impact
Compact PR reports now focus on prompts that directly explain the current change.

Verification
- npm -w packages/cli test
- npm -w packages/pr-report test

Release note: Compact PR reports now hide absorbed external review prompts.
```

Use `Release note: skip` for commits like version bumps, generated bundles,
test-only coverage, local refactors without behavior changes, and docs-only
maintenance that does not change user-facing guidance.
