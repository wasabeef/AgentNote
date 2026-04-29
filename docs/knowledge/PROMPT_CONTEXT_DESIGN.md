# Prompt Context 表示設計

## 目的

Prompt Context は、PR Report や Dashboard で短い prompt や文脈が不足している prompt を読みやすくするための補助表示です。

答えたいことは次の 2 つです。

- この短い prompt は何を指していたのか。
- 直前の response のどこを見れば、その prompt の意味が分かるのか。

一方で、次の値は絶対に変えません。

- attribution
- `files_touched`
- AI ratio
- prompt selection ownership
- git note を保存するかどうか

この機能は表示用 metadata であり、attribution の根拠ではありません。

## やらないこと

自然言語の command keyword から intent を推測しません。

たとえば、次の文言を実装条件にはしません。

- `yes, do it`
- `はい、お願いします`
- `continue`
- `もう一度`

これらの文言を test fixture に含めることはできます。ただし assertion の本質は、言語固有の wording ではなく structural anchor の有無に置きます。

AI model に context を要約させません。Context は保存済み session data から deterministic に再現できる必要があります。

広い概念一致だけでは Context を付けません。たとえば previous response が `more patterns`、`review from other angles`、`run more simulations` のような内容だけで、commit file や code symbol に繋がる anchor がない場合は Context を省略します。

## データモデル

`Interaction` に optional な `context` field を追加する想定です。

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

安全な Context が見つからない場合、`context` field は出しません。

既存 reader は `context` が存在しない note をそのまま扱える必要があります。

## 実装の形

selector は `recordCommitEntry()` から分離し、git fixture なしで test できる pure function にします。

想定 module は次です。

```text
packages/cli/src/core/interaction-context.ts
```

想定 public function は次です。

```ts
type ContextCandidate = {
  prompt: string;
  previousResponse: string | null;
  previousTurnSelected: boolean;
};

type CommitContextSignature = {
  changedFiles: string[];
  changedFileBasenames: string[];
  codeIdentifiers: Set<string>;
  commitSubjectTokens: string[];
};

function selectInteractionContext(
  candidate: ContextCandidate,
  signature: CommitContextSignature,
): string | undefined;
```

`recordCommitEntry()` は selected prompt entries、paired responses、commit files、commit subject、final diff を selector に渡します。返ってきた値があれば `buildEntry()` の前に `interaction.context` へ書き込みます。

previous response は `events.jsonl` の response / stop event を優先し、不足している場合は読み込み済み transcript interaction の response で補完します。これにより Claude / Cursor / Gemini の hook response 経路だけでなく、Codex の transcript response 経路でも同じ判定になります。

PR Report と Dashboard は Context を再計算しません。git note に保存された `context` field を表示するだけにします。

`previousResponse` が `null` の場合、selector は必ず `undefined` を返します。

`previousTurnSelected` は selector の外で計算します。ここでの previous は selected prompt entries の直前ではなく、session / transcript 上の直前 turn を指します。その直前 turn が今回の selected commit prompt window に含まれている場合、`previousTurnSelected: true` として Context を付けません。理由は、その文脈がすでに `🧑 Prompt` / `🤖 Response` として表示されるためです。

selector に raw `diffText` は渡しません。大きな commit で diff が巨大になることを避けるため、呼び出し側で必要な structural signal だけを抽出して `CommitContextSignature` に渡します。

## 選択方針

Context selection は conservative にします。

Context を付けるのは、次の条件をすべて満たす場合だけです。

- current prompt が、すでに selected commit prompt window に含まれている。
- current prompt 自体には commit file または code symbol の強い anchor がない。
- immediately previous response が、同じ commit window の selected prompt としてすでに表現されていない。
- previous response に current commit へ繋がる強い anchor がある。
- 抽出対象 paragraph が `working tree is clean`、CI status、local-only command output のような operational noise ではない。

強い anchor は structural なものに限定します。

- exact changed file path
- changed file basename
- commit diff に出てくる code-like identifier。例: `isQuotedPromptHistory`
- commit diff に出てくる all-caps constant

code-like identifier の初期定義は次に限定します。正規表現自体に判別条件を持たせ、実装側で別の意味に解釈されないようにします。

- camelCase / PascalCase: `/\b[A-Za-z_$]*[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*\b/`
- snake_case: `/\b[a-z][a-z0-9]*_[a-z][a-z0-9_]*[a-z0-9]\b/`
- all-caps constant: `/\b[A-Z][A-Z0-9_]{3,}\b/`

抽出時には `prompt`、`commit`、`test`、`context` のような generic word を除外します。`JSON`、`YAML`、`HTML`、`HTTP`、`TODO` のような一般 acronym も strong anchor にしません。camelCase を `prompt` / `window` のような普通語へ分割して strong anchor として扱ってはいけません。strong anchor は原則として full identifier match です。

弱い anchor だけでは Context を付けません。

- commit subject の単語
- `prompt`、`commit`、`test`、`context` のような generic implementation word
- language-specific approval / go-ahead word
- 広い概念一致

commit subject は auxiliary score としては使ってよいですが、file anchor または code-symbol anchor なしで Context を付けてはいけません。

## 提案アルゴリズム

まず commit signature を作ります。

1. changed file path と basename を集める。
2. final commit diff から code-like identifier を抽出し、`Set<string>` にする。
3. commit subject token を auxiliary hint として抽出する。

各 selected interaction について次を行います。

1. immediately previous response を見る。
2. previous turn が同じ commit ですでに selected なら skip する。
3. current prompt が強い file / code-symbol anchor を持つなら skip する。
4. previous response の paragraph を commit signature と照合する。
5. file hit または code-symbol hit を持つ paragraph だけを候補にする。
6. operational-noise paragraph を落とす。
7. 最も短く有用な excerpt を `interaction.context` として保存する。

迷う場合は Context を省略します。

### Paragraph の定義

paragraph は空行区切りで分割します。

code fence は paragraph 内に含めてもよいですが、開始 fence と終了 fence が揃っていない paragraph は候補から除外します。code block の途中で truncate して fence を壊すくらいなら、その paragraph は採用しません。

Markdown heading だけの paragraph、`追加で見た観点:` のように末尾が `:` / `：` で終わる intro-only paragraph、`working tree` や CI status だけを示す operational paragraph は候補から除外します。

`/Users/...`、`/home/...`、`C:\...` のような local filesystem absolute path を含む paragraph も候補から除外します。repository-relative path や GitHub URL は表示してよいですが、local machine 固有の path は Context に残しません。

### Excerpt の選択規則

候補 paragraph が複数ある場合は、次の順で選びます。

1. exact changed file path hit を含む paragraph
2. changed file basename hit を含む paragraph
3. code identifier hit を含む paragraph
4. commit subject token hit は tie-breaker のみに使う
5. 同点なら response 内で先に出た paragraph を選ぶ

Context は最大 2 paragraphs までにします。ただし合計文字数が上限を超える場合は、paragraph の途中で切らず、収まる paragraph だけを残します。1 paragraph も安全に残せない場合は `undefined` を返します。

初期上限は PR Report 向けに `min(900, previousResponse.length)` characters 程度を想定します。つまり Context は抽出元の previous response より長くしません。Dashboard は UI 側でさらに collapse / expand できますが、保存する `context` 自体は短い excerpt にします。

## 実装順

1. selector を pure function として追加し、unit test を書く。
2. `Interaction` に `context?: string` を追加し、`buildEntry()` の test を追加する。
3. `context` を追加しても attribution output が変わらないことを unit test で確認する。
4. `recordCommitEntry()` に selector を接続する。
5. Context が `files_touched`、prompt count、AI ratio に影響しないことを record-level test で確認する。
6. PR Report と CLI PR output で `context` を表示する。
7. note schema と PR output が安定してから Dashboard 表示を追加する。
8. UI 表示が固まってから README、docs、website の各 locale を更新する。

## 表示

`context` が存在する場合は、prompt の直前に表示します。

```md
> **📝 Context**
> ...
>
> **🧑 Prompt**
> ...
>
> **🤖 Response**
> ...
```

表示ルールは次です。

- multi-line blockquote を維持する。
- internal turn number を表示しない。
- local filesystem path を表示しない。
- broken code fence を出さない。
- Context は抽出元の previous response より短く保つ。
- confusing な truncate をするくらいなら省略する。

file reference は、repository URL と commit SHA が取れる場合は repository-relative link または pinned GitHub link にします。

## テスト計画

### Selector の unit test

pure selector test file を追加します。

```text
packages/cli/src/core/interaction-context.test.ts
```

確認する case は次です。

- current prompt に anchor がなく、previous response に changed file path がある場合は Context を付ける。
- previous response に commit diff の code identifier がある場合は Context を付ける。
- previous response が概念一致だけの場合は Context を付けない。
- commit subject words だけでは Context を付けない。
- approval wording だけでは Context を付けない。
- current prompt がすでに changed file または code symbol を含む場合は Context を付けない。
- previous response が commit prompt window ですでに selected されている場合は Context を付けない。
- operational-noise paragraph を落とす。
- broken code fence を避ける。
- `previousResponse` が `null` の場合は `undefined` を返す。
- exact file path hit を basename hit より優先し、basename hit を code identifier hit より優先する。
- commit subject token は tie-breaker としてだけ使う。

重要なのは、test name を言語カテゴリではなく structural condition で書くことです。

良い例:

```text
does not attach context when the previous response has no commit-file or code-symbol anchor
does not attach context based only on short go-ahead wording
attaches context when the previous response has a commit-file anchor and the current prompt lacks one
```

避ける例:

```text
does not attach context for Japanese approval prompts
does not attach context for conceptual Japanese prompts
```

### Entry schema の unit test

`packages/cli/src/core/entry.test.ts` で確認します。

- `buildEntry()` が `interaction.context` を保持する。
- `context` がない場合は field を出さない。
- `context` を追加しても attribution、files、AI ratio、method が変わらない。

### Record の integration test

`packages/cli/src/core/record.test.ts` で確認します。

- previous response に commit-file anchor がある short prompt では git note に `interaction.context` が保存される。
- previous response に file / code-symbol anchor がない short prompt では git note に `interaction.context` が保存されない。
- 同じ case で `files_touched`、prompt count、AI ratio が変わらない。
- Claude、Codex、Cursor、Gemini の既存 record path は `context` がなくても通り続ける。

### Report rendering の test

`packages/pr-report/src/report.ts` の test で確認します。

- `📝 Context` が `🧑 Prompt` の前に表示される。
- `context` がない場合は `📝 Context` を表示しない。
- multi-line Context の blockquote formatting を維持する。
- Markdown table に影響する文字を escape する、または table 外で扱う。
- local filesystem path を出さない。

`packages/cli/src/commands/pr.test.ts` で確認します。

- `agent-note pr` の prompts section に Context が表示される。
- `agent-note pr --json` に raw `context` field が含まれる。

### Documentation / Website の更新

実装と表示が固まるまでは、website の各 locale を先に厚く更新しません。仕様が揺れている段階で翻訳を増やすと、後続変更のコストが高くなるためです。

更新対象は次を想定します。

- `README.md`
- `docs/knowledge/` の設計・調査メモ
- `website/src/content/docs/*/github-action.mdx`
- `website/src/content/docs/*/dashboard.mdx`
- `website/src/content/docs/*/mechanism.mdx` または同等の仕組み説明ページ

website では次だけを短く説明します。

- Prompt だけでは意味が分かりにくい場合、`📝 Context` が表示されることがある。
- Context は previous response から deterministic に抽出される。
- 抽出条件は changed file や code symbol への structural anchor であり、approval keyword ではない。
- Context は attribution、`files_touched`、AI ratio に影響しない。
- Dashboard と PR Report の両方で同じ git note の `interaction.context` を表示する。

各 locale では同じ意味を保ち、言語ごとの keyword 例を仕様として説明しないようにします。表示 screenshot は PR Report / Dashboard の UI が安定してから更新します。

## 回帰 fixture

PR #33 のような case を fixture として使います。

Context が付く case:

- current prompt: `本当にこの修正で改善できるのか`
- previous response が `record.ts`、`record.test.ts`、`docs/TODO.md`、または `isQuotedPromptHistory` に言及している。
- 期待値: Context が付く。

Context を省略する case:

- current prompt: `もう一度、色々なパターンのデータ作って`
- previous response は広い simulation / review category だけを説明しており、changed file path や code identifier を含まない。
- 期待値: Context が省略される。

approval wording の例:

- `yes, do it`
- `はい、お願いします`
- `继续`
- `sí, hazlo`

期待される挙動は current prompt の言語や wording ではなく、previous response に structural anchor があるかどうかで決まる必要があります。

## 完了条件

- Context が deterministic である。
- Context が optional かつ backward-compatible である。
- Context によって attribution output が変わらない。
- previous response に current commit への強い structural anchor がある場合だけ Context が付く。
- Context selection に language-specific keyword list が不要である。
- Context が省略されても report が読みやすい。
