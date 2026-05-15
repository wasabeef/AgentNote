# Prompt Context 表示設計

## 目的

Prompt Context は、PR Report や Dashboard で短い prompt や文脈が不足している prompt を読みやすくするための補助表示です。

答えたいことは次の 2 つです。

- この短い prompt は何を指していたのか。
- この prompt で何の作業を進めようとしていたのか。

一方で、次の値は絶対に変えません。

- attribution
- `files_touched`
- AI ratio
- prompt selection ownership
- git note を保存するかどうか

この機能は表示用 metadata であり、attribution の根拠ではありません。

## Context の種類

表示上はどちらも `📝 Context` に統一します。読み手から見ると、どちらも「短い prompt を理解するための補足」だからです。

内部 schema では `kind` と `source` で役割を分けます。

| kind | source | 役割 | 例 |
|---|---|---|---|
| `reference` | `previous_response` | 直前 response のどこを受けているかを示す | `この修正で改善できる？` の「この修正」 |
| `scope` | `current_response` | その prompt で何の作業を進めるかを示す | `次の作業にうつって` の作業範囲 |

表示例:

```md
📝 Context
次の対象は BUGS.md の作業順どおり PR 2「transcript / prompt pairing の安全性」です。

🧑 Prompt
マージしたので、次の BUGS PR 作業して
```

## やらないこと

AI model に context を要約させません。Context は保存済み session data から deterministic に再現できる必要があります。

自然言語の command / approval keyword から intent を推測しません。たとえば、次の文言を実装条件にはしません。

- `yes, do it`
- `はい、お願いします`
- `continue`
- `もう一度`
- `次へ`

これらの文言を test fixture に含めることはできます。ただし assertion の本質は、言語固有の wording ではなく structural anchor の有無に置きます。

広い概念一致だけでは Context を付けません。たとえば response が `more patterns`、`review from other angles`、`run more simulations` のような内容だけで、commit file や code symbol に繋がる anchor がない場合は Context を省略します。

Context は prompt selection を広げません。古い prompt を追加採用したり、`files_touched` を増やしたりしません。

## データモデル

現在の schema は `contexts[]` です。`context?: string` は過去 note 互換の legacy field として reader / renderer 側だけが読みます。

過去 note は `context?: string` だけを持つ場合があります。これは previous response 由来の `reference` context を 1 つだけ保存する形でした。

```ts
interface Interaction {
  prompt: string;
  response: string | null;
  context?: string;
  files_touched?: string[];
  line_stats?: Record<string, { added: number; deleted: number }>;
  tools?: string[] | null;
}
```

新規 note は次の `contexts[]` に寄せます。

```ts
interface InteractionContext {
  kind: "reference" | "scope";
  source: "previous_response" | "current_response";
  text: string;
}

interface Interaction {
  prompt: string;
  response: string | null;
  contexts?: InteractionContext[];
  files_touched?: string[];
  line_stats?: Record<string, { added: number; deleted: number }>;
  tools?: string[] | null;
}
```

既存 note の `context?: string` は読み取り時に次と同等に扱います。

```ts
{
  kind: "reference",
  source: "previous_response",
  text: context,
}
```

PR Report / Dashboard は `context?: string` と `contexts[]` の両方を読める必要があります。

正規化方針:

```ts
function normalizeInteractionContexts(interaction: Interaction): InteractionContext[] {
  const contexts = interaction.contexts ?? [];
  const legacy = interaction.context?.trim();
  if (!legacy) return contexts;
  if (contexts.some((context) => context.kind === "reference" && context.text.trim() === legacy)) {
    return contexts;
  }
  return [
    { kind: "reference", source: "previous_response", text: legacy },
    ...contexts,
  ];
}
```

新規 note では `context?: string` を重複保存しません。過去 note 互換のために reader / renderer 側だけが `context?: string` を `contexts[]` と同等に扱います。

## Structural Signal

Context selection は structural anchor だけを使います。

共通の強い anchor:

- exact changed file path
- changed file basename
- final commit diff に出てくる code-like identifier
- final commit diff に出てくる all-caps constant
- markdown file reference と issue / PR reference の組み合わせ
- issue / PR reference と scoped title の組み合わせ

code-like identifier の初期定義:

- camelCase / PascalCase: `/\b[A-Za-z_$]*[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*\b/`
- snake_case: `/\b[a-z][a-z0-9]*_[a-z][a-z0-9_]*[a-z0-9]\b/`
- all-caps constant / acronym: `/\b[A-Z][A-Z0-9_]{2,}\b/`

弱い anchor だけでは Context を付けません。

- commit subject の単語だけ
- generic implementation word
- language-specific approval / go-ahead word
- `PR #N` だけの reference
- short code span だけの reference
- Scope Context における changed file path だけの reference
- 広い概念一致

`commitSubjectTokens` は static な自然言語 stopword list では作りません。Conventional Commit の type や `add` / `update` / `remove` / `implement` のような generic implementation word など、構造的に弱いものだけを落とします。1 token だけでは Context の根拠にせず、同じ sentence 内で 2 token 以上が揃う場合だけ `scopedTitle` の補助 signal として扱います。

`reference` と `scope` では anchor の使い方が少し違います。`reference` は「直前 response のどこを見ればよいか」を示すため、changed file path / basename 単体でも十分な anchor になります。一方で `scope` は「何の作業だったか」を示すため、file path 単体では細部に寄りすぎます。Scope Context では file anchor を subject token、code identifier、scoped title、issue / PR reference などと組み合わせた場合だけ採用します。

## Reference Context

`reference` context は immediately previous response から抜き出します。

選択条件:

- current prompt が selected commit prompt window に含まれている。
- current prompt 自体には commit file または code symbol の強い anchor がない。
- immediately previous response が、同じ commit window の selected prompt としてすでに表示されていない。
- previous response に current commit へ繋がる file / code-symbol anchor がある。
- 抽出対象 paragraph が command / status output だけではない。

提案アルゴリズム:

1. changed file path / basename と final diff の code identifier から signature を作る。
2. immediately previous response を見る。
3. previous turn が同じ commit ですでに selected なら skip する。
4. current prompt が強い file / code-symbol anchor を持つなら skip する。
5. previous response の paragraph を signature と照合する。
6. file hit または code-symbol hit を持つ paragraph だけを候補にする。
7. 最も短く有用な excerpt を `{ kind: "reference", source: "previous_response" }` として保存する。

迷う場合は省略します。

## Scope Context

`scope` context は current response から抜き出します。

選択条件:

- selected interaction である。
- prompt が短い。
- prompt 自体に changed file path / basename / code-like identifier などの強い anchor がない。
- response が存在する。
- response の冒頭に scope として使える sentence がある。
- selected sentence が commit signature に繋がる structural anchor を持つ。

提案アルゴリズム:

1. current response を normalize する。
2. 先頭 10 non-empty lines だけを候補にする。
3. list item / blockquote marker を取り除く。
4. sentence boundary で先頭 4 sentence だけを残し、各 sentence と隣接 2 sentence window を候補にする。
5. local absolute path や broken code fence を含む sentence を候補から除外する。
6. structural anchor を持つ sentence だけを scoring する。
7. threshold 以上の最上位 sentence を `{ kind: "scope", source: "current_response" }` として保存する。

Scope scoring の初期仕様:

- `codeIdentifier` / `allCapsConstant` hit: `+2`
- `scopedTitle` hit: `+2`
- issue / PR reference と `scopedTitle` の組み合わせ: `+2`
- markdown file reference と issue / PR reference の組み合わせ: `+2`
- changed file path / basename hit: `+1`
- commit subject token hit: 1 token だけなら tie-breaker のみ。2 token 以上が同じ sentence にある場合は `scopedTitle` hit として扱う。

合格条件は `score >= 2` とします。ただし file path / basename だけで `2` 点に届くような合算は許可しません。Scope Context は作業範囲を示すため、少なくとも 1 つは file 以外の structural anchor、または file anchor と file 以外の anchor の組み合わせが必要です。これにより、`PR #N` だけ、changed file path だけ、generic subject token だけの sentence は落ちます。code identifier だけの sentence も局所的な implementation step に寄りやすいため、Scope Context では採用しません。`PR #N` と 1 つ以上の non-generic subject token が同じ sentence にある場合は、PR 番号単体ではなく scoped title 付きの参照として扱えます。

次は positive signal にしません。

- approval / go-ahead keyword
- action cue keyword
- operational / housekeeping keyword
- `PR #N` だけの reference
- code identifier だけの local implementation step
- short code span だけの reference
- changed file path だけの reference

### Scope Simulation

2026-04-30 に、直近の merged PR 30 件を対象に simulation data を作成しました。

取得元:

```bash
gh pr list --state merged --limit 30 --json number,title,url,mergedAt,body,commits
```

生成物:

```text
/tmp/agentnote-task-simulation/prs.json
/tmp/agentnote-task-simulation/simulate-task-structural.mjs
/tmp/agentnote-task-simulation/simulation-structural.json
/tmp/agentnote-task-simulation/simulation-structural.md
```

最終判断は PR body markdown ではなく、`git notes --ref=agentnote show <sha>` から読んだ JSON の `interactions[]` を基準にします。PR body markdown は response 内の quoted history を interaction として誤読しやすいためです。

集計結果:

| 項目 | 件数 |
|---|---:|
| PR | 30 |
| git note あり commit | 112 |
| interaction | 1489 |
| short / no-anchor prompt として検討 | 1246 |
| Scope Context excerpt 選択 | 178 |
| response なし interaction | 80 |

BUGS 修正 PR 5 件では、Scope Context が短い prompt の読みやすさを改善しました。

```md
#34
📝 Context: 作業順どおり、まずは PR 1 の `Dashboard diff 欠落表示` から着手します。
🧑 Prompt: ブランチ切って作業開始

#35
📝 Context: 次の対象は BUGS.md の作業順どおり PR 2「transcript / prompt pairing の安全性」です。
🧑 Prompt: マージしたので、次の BUGS PR 作業して

#36
📝 Context: BUGS.md の順番どおり、PR 3「generated artifact heuristic の false negative を減らす」に進みます。
🧑 Prompt: マージした、次の作業にうつって

#37
📝 Context: 次の順番は `BUGS.md` の PR 4「hook / shell command 周りの edge case」です。
🧑 Prompt: マージした、次の作業にうつって

#38
📝 Context: CDN import は消し、Dashboard 自身が安全な小型 Markdown renderer を持つ形です。
🧑 Prompt: これが最後かな
```

代表的な bad case:

```md
`y`、この repo の `PR #29` 自体で効かせたいなら、**この branch に commit / push しないと動きません**。
```

この sentence は `PR #29` を含みますが、Scope Context ではありません。keyword で `commit / push` を落とすのではなく、`PR #29` だけでは scoped title にならない、という structural rule で落とします。

## Paragraph / Sentence の扱い

Reference Context の paragraph は空行区切りで分割します。

Scope Context の sentence は先頭行から切り出します。

共通ルール:

- code fence は開始 fence と終了 fence が揃っていない場合は候補から除外する。
- Markdown heading だけの paragraph は候補から除外する。
- 末尾が `:` / `：` で終わる intro-only paragraph は候補から除外する。
- command / status output だけで structural anchor を持たない paragraph は候補から除外する。
- `/Users/...`、`/home/...`、`C:\...` のような local filesystem absolute path を含む excerpt は候補から除外する。
- repository-relative path や GitHub URL は表示してよい。

sentence boundary:

- 日本語: `。`, `！`, `？` を sentence boundary とする。
- 英語: `.`, `!`, `?` は whitespace または行末が続く場合だけ sentence boundary とする。
- backtick 内や filename 内の `.` は sentence boundary にしない。
- 日英混在文でも同じ rule を使う。例: `Dashboard markdown renderer を直します。It no longer imports from esm.sh.` は 2 sentence として扱う。

## 表示

`contexts[]` がある場合は、prompt の前に 1 つの `📝 Context` block として表示します。

```md
**📝 Context**
> ...
>
**🧑 Prompt**
> ...
>
**🤖 Response**
> ...
```

複数 context がある場合も `📝 Context` block は 1 つだけにし、`reference` を先、`scope` を後に並べます。

複数 context の本文は blank line で区切ります。`kind` label は表示しません。`reference` と `scope` の text が同じ場合は 1 件に dedupe します。表示ラベルを増やすと読み手に内部概念を理解させることになるため、UI はあくまで 1 つの `📝 Context` として扱います。

複数 context の長さ制御:

- `📝 Context` block 全体の保存上限は初期値 `900` characters とする。
- `reference` と `scope` の両方を full text で入れられる場合だけ両方表示する。
- 上限を超える場合、context text の途中では切らない。保存前の `composeInteractionContexts()` で selector の internal rank が高いものを優先し、同点なら `reference` を優先する。
- どちらも単独で上限に入らない場合は Context 自体を省略する。
- internal rank は git note に保存しない。PR Report / Dashboard は保存済み `contexts[]` をそのまま表示し、再 scoring しない。
- Dashboard は UI 側で collapse / expand してもよいが、git note に保存する text は短い excerpt のままにする。

表示ルール:

- internal turn number を表示しない。
- local filesystem path を表示しない。
- broken code fence を出さない。
- confusing な truncate をするくらいなら省略する。
- PR Report と Dashboard で表示順を揃える。

## 実装順

1. `InteractionContext` と `contexts?: InteractionContext[]` を追加する。
2. 既存 `context?: string` を読み取り時に `reference` context と同等に扱う。
3. `buildEntry()` が non-empty `contexts[]` を保持し、blank text を省略する test を追加する。
4. 既存 `selectInteractionContext()` は string-return のまま維持し、`toReferenceContext()` wrapper で `{ kind: "reference" }` に変換する。
5. `selectInteractionScopeContext()` を `interaction-context.ts` に追加し、これは最初から `InteractionContext | undefined` を返す。
6. `recordCommitEntry()` の interactions 組み立て後に `reference` / `scope` context を付与する。
7. `contexts[]` が attribution / files / AI ratio / prompt count に影響しない record-level test を追加する。
8. `packages/pr-report`、`agent-note pr`、Dashboard で `normalizeInteractionContexts()` 経由の `📝 Context` 統合表示にする。
9. README、docs、website locales を更新する。

## テスト計画

### Selector unit test

追加先:

```text
packages/cli/src/core/interaction-context.test.ts
```

Reference positive:

- current prompt に anchor がなく、previous response に changed file path がある場合は `reference` context を付ける。
- previous response に commit diff の code identifier がある場合は `reference` context を付ける。

Reference negative:

- previous response が概念一致だけの場合は Context を付けない。
- commit subject words だけでは Context を付けない。
- approval wording だけでは Context を付けない。
- current prompt がすでに changed file または code symbol を含む場合は Context を付けない。
- previous response が commit prompt window ですでに selected されている場合は Context を付けない。

Scope positive:

- BUGS PR #34 型: `ブランチ切って作業開始` に PR 1 scope sentence を付ける。
- BUGS PR #35 型: `次の BUGS PR 作業して` に PR 2 scope sentence を付ける。
- BUGS PR #38 型: `これが最後かな` に Dashboard markdown rendering scope sentence を付ける。
- English response: `I will implement the Dashboard markdown renderer without CDN imports.` を付ける。
- Mixed Japanese / English response: `Dashboard markdown renderer を直します。It no longer imports from esm.sh.` は sentence boundary を壊さず、`Dashboard markdown renderer` 側の sentence を候補にできる。

Scope negative:

- short go-ahead prompt だけでは付けない。
- `PR #N` だけを含む sentence には付けない。
- short code span だけを含む sentence には付けない。
- response が command/status output だけで、commit signature への structural anchor がない場合は付けない。
- prompt 自体に strong anchor がある場合は付けない。
- response がない場合は付けない。

### Entry / Record test

- `buildEntry()` が `contexts[]` を保持する。
- blank context は保存しない。
- legacy `context?: string` を読める。
- legacy `context?: string` と `contexts[]` が両方ある場合、同じ text を重複表示しない。
- `contexts[]` が `files_touched`, `ai_ratio`, `method`, prompt count を変えない。
- transcript response fallback でも `scope` context を付けられる。
- `reference` と `scope` が両方ある場合でも、長さ上限により prompt selection や attribution は変わらない。
- Claude / Codex / Cursor / Gemini の既存 record tests が通る。

### Report / Dashboard test

- PR Report で `📝 Context` が `🧑 Prompt` より前に出る。
- `contexts[]` がない場合は `📝 Context` を出さない。
- legacy `context?: string` も表示できる。
- `reference` と `scope` が両方ある場合も `📝 Context` block は 1 つだけ。
- `reference` と `scope` の両方がある場合、blank line 区切りで `reference` を先に表示する。
- `reference` と `scope` の text が同一の場合、1 件だけ表示する。
- 複数 context が上限を超える場合、途中 truncate せず低優先 context を落とす。
- Dashboard で同じ markdown renderer を通る。
- raw HTML は解釈しない。

## Documentation / Website

実装済みの公開説明は、README では短く、website では使う人向けに説明します。詳細な抽出条件はこの knowledge と `../architecture.md` に集約します。

反映対象:

- `README.md`
- `docs/knowledge/` の設計・調査メモ
- `website/src/content/docs/*/github-action.mdx`
- `website/src/content/docs/*/dashboard.mdx`
- `website/src/content/docs/*/how-it-works.mdx`

website では次を短く説明します。

- Prompt だけでは意味が分かりにくい場合、`📝 Context` が表示されることがある。
- Context は保存済み response から deterministic に抽出される。
- 抽出条件は structural anchor であり、approval keyword ではない。
- Context は attribution、`files_touched`、AI ratio に影響しない。
- Dashboard と PR Report の両方で同じ git note の `contexts[]` を表示する。

各 locale では同じ意味を保ち、言語ごとの keyword 例を仕様として説明しないようにします。

## 完了条件

- Context が deterministic である。
- Context が optional かつ backward-compatible である。
- Context によって attribution output が変わらない。
- `reference` / `scope` の違いが schema 上は明確で、UI では `📝 Context` に統一されている。
- Context selection に language-specific keyword list が不要である。
- Context が省略されても report が読みやすい。
