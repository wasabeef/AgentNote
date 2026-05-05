# Prompt selection scoring design

## 目的

Prompt selection は、次の 2 つを同時に満たす必要があります。

- Commit に至る会話の流れを読めること。
- 古い quoted history、別 commit の edit、単なる session backlog を混ぜないこと。

これまでの boolean filter は「残す / 捨てる」を record 時点で決めるため、あとから表示密度を変えられません。`書くなら CONTRIBUTING` や `はい` のような短い prompt は、単体では情報量が少なくても、前後の会話の橋渡しとして必要なことがあります。逆に、すべて残すだけでは PR Report が長くなります。

そのため、今後は **prompt を言語非依存の構造 signal で scoring し、保存と表示を分離する** 方針にします。

## 結論

実装難易度は **中程度** です。

- Agent adapter の大きな変更は不要です。
- 主な変更は `packages/cli/src/core/record.ts` の prompt window selection と note schema の additive field 追加です。
- 将来 PR Report / Dashboard に表示 filter を追加する場合も、attribution や AI ratio には触れません。
- 既存 note 互換は保てます。`selection` がない note は従来通り表示できます。

一方で、単純な threshold 実装だけだと今回と同じ問題を繰り返すため、次の原則を守ります。

1. **record 時点で不可逆に捨てすぎない。**
2. **短い commit-to-commit window は会話の連続性を優先する。**
3. **scoring は表示密度のために使い、attribution には使わない。**
4. **keyword list は使わない。日本語 / 英語 / その他言語で同じ構造 signal を使う。**

## 実装 status

この design のうち、現在の実装では次を入れます。

- `interactions[].selection` に `schema`, `source`, `signals` だけを保存する。
- record 時点で `analyzePromptSelection()` / `toPersistedSelection()` を使い、score / role / level は保存しない。
- latest primary turn 後の tail prompt は `source: "tail"` として扱い、`prompt_scope: "tail"` で dedupe する。
- tail marker は `maxConsumedTurn` を進めない。
- bridge 判定は 2-pass で行い、hard-excluded されていない隣接 prompt がある短い prompt だけに `between_non_excluded_prompts` を付ける。
- quoted history、1 文字 prompt、別 commit の non-primary edit turn は current commit の note に保存しない。
- PR Report / Dashboard の prompt-only merge は、`selection` metadata を失わない。
- PR Report / CLI preview は `prompt_detail: compact|full` で表示密度を調整する。

Dashboard は詳細確認のため full trace を表示します。git note には安定した evidence だけを残すため、将来 threshold や preset を変えても migration は不要です。

## 現在の問題

### 問題 1: 点で拾う filter は会話が飛ぶ

`fileRefScore` や `textScore` が高い prompt だけを拾うと、次のような prompt が落ちます。

- `はい`
- `書くなら CONTRIBUTING`
- `ここで`
- `PR 作成して`

これらは単体では弱いですが、直前の response や次の commit action と合わせると意味があります。ユーザーは PR Report を読むとき、途中の会話が抜けると「なぜこの作業になったのか」がわからなくなります。

### 問題 2: すべて残すと長くなる

Full session backlog を残すと、古い PR summary、quoted prompt history、別 commit の作業まで混ざります。これは Dashboard では許容できても、PR Report では読みづらくなります。

### 問題 3: record 時に捨てると後で調整できない

`compact / full` のような表示設定を後から追加しても、git note に保存されていない prompt は復元できません。したがって、record 側は「残す候補を広めに保存し、selection evidence を付ける」必要があります。

## 対象外

- AI agent / LLM による意味判定。
- 言語別 keyword list。
- prompt score を AI ratio や line attribution に使うこと。
- 既存 note の migration。

## データモデル案

変更前の interaction は次の形でした。

```ts
type Interaction = {
  prompt: string;
  response: string | null;
  contexts?: InteractionContext[];
  files_touched?: string[];
  line_stats?: Record<string, { added: number; deleted: number }>;
  tools?: string[] | null;
};
```

additive に `selection` を追加します。

```ts
type PromptSelectionSignal =
  | "primary_edit_turn"
  | "exact_commit_path"
  | "commit_file_basename"
  | "diff_identifier"
  | "response_exact_commit_path"
  | "response_basename_or_identifier"
  | "commit_subject_overlap"
  | "list_or_checklist_shape"
  | "multi_line_instruction"
  | "inline_code_or_path_shape"
  | "substantive_prompt_shape"
  | "before_commit_boundary"
  | "between_non_excluded_prompts";

type InteractionSelection = {
  schema: 1;
  source: "primary" | "window" | "tail" | "fallback";
  signals: PromptSelectionSignal[];
};

type Interaction = {
  prompt: string;
  response: string | null;
  contexts?: InteractionContext[];
  files_touched?: string[];
  line_stats?: Record<string, { added: number; deleted: number }>;
  tools?: string[] | null;
  selection?: InteractionSelection;
};
```

`selection` は display-only metadata です。次には使いません。

- `ai_ratio`
- `files_touched`
- `line_stats`
- `attribution.method`
- consumed prompt state
- prompt count

`score`, `role`, `level` は保存しません。これらは renderer が `selection.source`, `selection.signals`, note contents, and current threshold から runtime に計算します。

理由:

- `level` は threshold を変えるだけで stale になります。
- `score` は weight / calibration を変えるだけで stale になります。
- `role` は classifier の優先順位を変えるだけで stale になります。

git note に保存するのは、record 時点で観測した比較的安定した evidence だけです。将来 threshold / weights / role classifier を変える場合は runtime resolver と tests を更新すればよく、git note migration は不要です。

`selection.source` は prompt が note に入った経路を表します。runtime role とは 1:1 対応しません。

| Source | 意味 | Runtime role の候補 |
| --- | --- | --- |
| `primary` | commit file の surviving edit / transcript primary から選ばれた prompt | `primary` |
| `window` | latest primary turn 以前の bounded commit window から選ばれた prompt | `direct_anchor`, `scope`, `anchored_bridge`, `bridge`, `background` |
| `tail` | latest primary turn 後の display-only tail として選ばれた prompt | `tail`, `direct_anchor`, `anchored_bridge`, `scope` |
| `fallback` | turn data や transcript primary が弱い場合の prompt-only fallback | `scope`, `direct_anchor`, `background` |

Renderer は `source` を provenance として扱い、runtime role は `signals` と interaction text から再解決します。

### Signal stability policy

`selection.signals` も schema の一部なので、何でも保存してよいわけではありません。保存する signal は **coarse, versioned, and evidence-like** なものに限定します。

保存してよい signal:

- record 時点で観測できた provenance / anchor を表すもの。
- weight や threshold を変えても意味が大きく変わらないもの。
- runtime resolver が「hint」として使え、必要なら interaction text から再計算できるもの。

保存しない signal:

- `score_over_75` のような threshold-dependent なもの。
- `medium_confidence` のような runtime level に近いもの。
- calibration 次第で意味が変わる細かい token count。

`signals` は絶対的な判定結果ではなく、schema version 付きの evidence hint です。将来 signal の意味を変える場合は `selection.schema` を上げ、runtime resolver は schema ごとに互換分岐します。

## Score の考え方

Score は「この prompt が commit narrative に必要か」を表します。言語の意味ではなく、構造 signal だけで計算します。

Score は単純な足し算だけで決めません。まず prompt の **role** を決め、その role の中で structural evidence を加点します。

理由は、`はい` のような bridge prompt と、commit file を実際に編集した primary prompt を同じ threshold だけで判定すると壊れやすいためです。bridge prompt は単体 score が低くて当然ですが、short commit window の中では残す価値があります。一方で primary prompt は短くても commit の causal evidence なので高く扱う必要があります。

### Scoring pipeline

1. Hard exclusion を先に判定する。
2. Prompt の role を決める。
3. Role ごとの base score を付ける。
4. Structural evidence で加点する。
5. Role ごとの上限 / 下限で score を clamp する。
6. `source` と `signals` を保存する。
7. `score`, `role`, `level` は renderer が runtime に決める。

Hard exclusion は score 以前の処理です。quoted history や detached one-character prompt は、score を付けずに保存候補から外します。

### Role-first score bands

Base / clamp / threshold は初期値です。直感だけで確定せず、PR #29 / #33 / #43 / BUGS PR 群の実データ simulation で calibration してから実装値として固定します。初期値の目的は、テスト fixture を書くための仮説を明確にすることです。

| Role | Base | Clamp | Level の基本 | 意味 |
| --- | ---: | --- | --- | --- |
| `primary` | 90 | 80-100 | `high` | commit file の surviving edit に直接つながる prompt |
| `direct_anchor` | 75 | 65-95 | `high` 寄り | full path / basename / diff identifier で commit と直接結びつく prompt |
| `scope` | 60 | 50-80 | `medium` 寄り | checklist、作業範囲、複数 file の整理など commit の目的を表す prompt |
| `tail` | 45 | 35-70 | `medium` または `low` | latest primary turn 後の説明、確認、PR 作成指示 |
| `anchored_bridge` | 45 | 40-65 | `medium` 寄り | 短い bridge だが file / identifier anchor を持つ prompt |
| `bridge` | 25 | 20-55 | `low` または `medium` | `はい`、`ここで` など、前後がないと意味が弱い prompt。短すぎない実質的な質問や相談は `medium` まで上げられる |
| `background` | 15 | 0-30 | `low` | short window 内にはあるが commit との構造 anchor が弱い prompt |

この band は「保存するかどうか」ではなく「表示密度でどう扱うか」の runtime 基準です。short commit window 内の `low` prompt は git note に保存し、`prompt_detail: full` で表示できるようにします。

### 推奨 threshold

初期値は次を候補にします。

| Score | Level | 表示 preset |
| ---: | --- | --- |
| `>= 75` | `high` | `compact`, `full` |
| `45..74` | `medium` | `compact`, `full` |
| `1..44` | `low` | `full` |
| `0` or hard excluded | 保存しない | なし |

ただし、threshold だけで最終判断しません。次の override を持たせます。

- `primary` は最低でも `high`。
- `direct_anchor` は最低でも `medium`、full path match なら `high`。
- `anchored_bridge` は `medium` まで上がれるが、`high` にはしない。短い bridge を compact 表示に出しすぎないため。
- `bridge` は通常 `low`。ただし `substantive_prompt_shape` がある場合だけ `medium` まで上げる。単体で `high` にはしない。
- `tail` は current commit への structural anchor がなければ `low`。`before_commit_boundary` や response evidence だけでは `medium` に上げず、prompt 側の path / identifier、inline code / path shape、または `substantive_prompt_shape` があれば `medium`。
- `background` は `full` 専用。PR Report default には出さない。

### Score resolution order

実装では次の順で決めます。これを固定しないと、同じ prompt が加点順序によって `medium` になったり `high` になったりします。

1. Hard exclusion を適用する。
2. `primary` を最優先で判定する。
3. exact path / diff identifier があれば `direct_anchor` にする。
4. short prompt が file / identifier anchor を持つ場合は `anchored_bridge` にする。
5. checklist / multi-line scope なら `scope` にする。
6. latest primary turn 後なら `tail` にする。
7. short prompt で前後に hard-excluded されていない prompt があるなら `bridge` にする。
8. それ以外は `background` にする。
9. Role base + evidence score を計算し、role clamp と override を適用する。
10. Persisted metadata には `source` と `signals` だけを保存する。

Role の優先順位は `primary > direct_anchor > anchored_bridge > scope > tail > bridge > background` です。

### Role classifier pseudocode

Role 判定は 2-pass にします。1-pass で bridge 以外を決め、2-pass で隣接関係を使って bridge を決めます。これにより「selected prompt があるなら bridge」という循環を避けます。

```ts
function classifyPrompt(candidate: PromptSelectionCandidate): PromptSelectionRole {
  if (isHardExcluded(candidate)) return "excluded";
  if (candidate.isPrimaryTurn) return "primary";
  if (hasExactCommitPath(candidate) || hasDiffIdentifier(candidate)) return "direct_anchor";
  if (isShortPrompt(candidate) && hasBridgeAnchorSignal(candidate)) {
    return "anchored_bridge";
  }
  if (hasScopeShape(candidate)) return "scope";
  if (candidate.isTail) return "tail";
  return "background";
}

function classifyBridgeCandidates(candidates: ScoredCandidate[]): void {
  for (const candidate of candidates) {
    if (candidate.role !== "background") continue;
    if (!isShortPrompt(candidate)) continue;
    if (hasAdjacentNonExcludedPrompt(candidate, candidates)) {
      candidate.role = "bridge";
    }
  }
}
```

Ordering details:

- primary turn より前の multi-line checklist は `scope` です。commit に至る作業範囲として `compact` に出せます。
- latest primary turn 後の exact path / diff identifier prompt は `direct_anchor` です。tail より具体的な current commit anchor を優先します。
- latest primary turn 後でも checklist / multi-line scope は `scope` です。tail 位置にあるだけで作業範囲の情報を弱めません。
- latest primary turn 後の basename-only prompt は `tail` です。response structural anchor がなければ `low` に留めます。
- short prompt が exact path / basename / diff identifier を持つ場合は `anchored_bridge` です。
- bridge 判定は 2-pass 目で行い、隣接 prompt は「selected」ではなく「hard excluded されていない prompt」として判定します。
- `hasAdjacentNonExcludedPrompt()` は前後どちらかに hard-excluded されていない prompt があれば true です。window の先頭や末尾でも、片側に会話が続いていれば bridge になれます。

### Persisted vs derived fields

| Field | 保存するか | 理由 |
| --- | --- | --- |
| `selection.source` | 保存する | `primary`, `window`, `tail`, `fallback` は record 時点の provenance であり、後から完全復元しにくい |
| `selection.signals` | 保存する | exact path / response anchor / checklist shape などの観測 evidence。weights を変えても再利用できる |
| `selection.schema` | 保存する | signal 名や source semantics を将来変える場合の互換分岐に使う |
| `score` | 保存しない | weights / calibration 変更で stale になる |
| `role` | 保存しない | classifier priority 変更で stale になる |
| `level` | 保存しない | threshold 変更で stale になる |

Renderer は保存済み evidence から `PromptRuntimeSelection` を作ります。runtime resolver は、git note に保存された `selection.source` / `selection.signals` と interaction text だけを入力にします。record 時点で commit files / diff identifiers 由来の evidence は `signals` に畳み込まれているため、renderer が commit metadata を再構築する必要はありません。

```ts
type PromptRuntimeSelection = {
  score: number;
  role:
    | "primary"
    | "direct_anchor"
    | "scope"
    | "tail"
    | "anchored_bridge"
    | "bridge"
    | "background";
  level: "low" | "medium" | "high";
};
```

Runtime resolver は保存済み `source` / `signals` と interaction text から role / score / level を再計算します。

```ts
function resolvePromptRuntimeSelection(
  selection: InteractionSelection | undefined,
  interaction: Interaction,
): PromptRuntimeSelection {
  if (!selection) return { score: 100, role: "primary", level: "high" };
  const role = resolvePromptRuntimeRole(selection.source, selection.signals, interaction.prompt);
  const score = scorePromptRuntime({ role, signals: selection.signals });
  return { score, role, level: resolvePromptRuntimeLevel({ score, role }) };
}

function resolvePromptRuntimeRole(
  source: InteractionSelection["source"],
  signals: PromptSelectionSignal[],
  prompt: string,
): PromptRuntimeSelection["role"] {
  if (source === "primary" || signals.includes("primary_edit_turn")) {
    return "primary";
  }
  if (signals.includes("exact_commit_path") || signals.includes("diff_identifier")) {
    return "direct_anchor";
  }
  if (isShortPrompt(prompt) && hasBridgeAnchorSignal(signals)) {
    return "anchored_bridge";
  }
  if (hasScopeSignal(signals)) return "scope";
  if (source === "tail") return "tail";
  if (isShortPrompt(prompt) && signals.includes("between_non_excluded_prompts")) {
    return "bridge";
  }
  return "background";
}
```

`scorePromptRuntime()` は role base、structural evidence 加点、role clamp、override をすべて適用した最終 score を返します。signal 加点だけを返す helper とは分け、runtime level の境界が実装者によってブレないようにします。

`hasScopeSignal()` は `list_or_checklist_shape` または `multi_line_instruction` を持つ場合に true とします。`source: "tail"` でもこれらの signal があれば `scope` に解決し、tail 位置にある作業範囲の指示を弱めません。

Source-specific notes:

- `source: "window"` は `direct_anchor`, `scope`, `anchored_bridge`, `bridge`, `background` に解決できます。
- `source: "tail"` は prompt 自体に exact path / diff identifier がある場合 `direct_anchor` に解決できます。それ以外は多くの場合 `tail` です。
- `source: "fallback"` は primary evidence が弱い prompt-only fallback entry に使います。将来 schema に primary signal を追加しない限り、`primary` にはしません。
- `selection` がない legacy interaction は後方互換のため runtime `high` として扱います。

Fallback と legacy の表示 policy:

- `fallback` entry は、旧挙動だと有用な prompt context がすべて失われる場合だけ git note に入れます。
- `fallback` は runtime `background` または `scope` を default にし、`primary` にはしません。
- `fallback` が `direct_anchor` になれるのは、interaction text 自体に exact path / diff identifier evidence がある場合だけです。
- `selection` がない legacy interaction は、古い data を突然隠さないため、すべての preset で表示します。
- legacy note が noisy すぎる場合は、将来 UI 側で legacy/no-selection indicator を足せます。ただし最初の scoring 実装では silently hide しません。

### Structural evidence weights

加点は language-neutral な構造 signal だけを使います。

| Evidence | Score | Notes |
| --- | ---: | --- |
| `primary_edit_turn` | role を `primary` にする | 加点ではなく role 決定 |
| exact commit file path | +30 | `packages/cli/package.json` など |
| commit file basename | +10 | `package.json` など。basename-only は常に exact path より弱い |
| diff identifier | +20 | 関数名、定数名、型名など |
| response has exact commit file path | +18 | short prompt の補助 evidence |
| response has basename / identifier | +10 | short prompt の補助 evidence |
| commit subject token overlap | +4 | tie-breaker 以上にしない |
| list / checklist shape | +10 | 作業範囲を表す可能性 |
| multi-line instruction | +6 | scope prompt の補助 |
| inline code / flag / path-like token | +6 | code-oriented prompt の補助 |
| substantive prompt shape | +12 | 短すぎない質問 / 相談 / 説明要求。keyword ではなく token 数・句読点・CJK/Hangul 文字数で判定 |
| immediately before commit boundary | +5 | tail prompt の補助 |
| between two non-excluded prompts | +8 | bridge prompt の補助 |

Negative evidence は score を下げるか、hard exclusion にします。

| Evidence | Effect | Notes |
| --- | --- | --- |
| quoted prompt history | hard exclude | 現在 commit の prompt ではなく過去会話の貼り付け |
| detached one-character prompt | hard exclude | `c` など |
| non-primary edit turn after latest primary | exclude from current commit unless later tail has current commit anchor | split commit 混入防止 |
| stale consumed prompt | hard exclude | previous commit で消費済み |
| long unanchored backlog | cap to `low` or exclude in long window | full session backlog 防止 |

### Basename policy

Basename は便利ですが、repository や言語によって「一般的なファイル名」は変わります。`README.md` や `package.json` のような static list を持つと保守対象が増え、特定 ecosystem に寄ります。

そのため Phase 1 では static generic basename list を持ちません。代わりに、basename-only match は常に exact path より弱い structural evidence として扱います。

- exact full path がある場合は強い `direct_anchor`。
- basename-only の場合は弱い `commit_file_basename`。
- basename-only だけで `high` にはしない。
- basename-only + diff identifier / commit subject overlap / prompt shape が揃れば `medium` までは許可する。

### Substantive prompt policy

`compact` は多くの repository で default として使われるため、厳しすぎると「途中の会話が抜けた」ように見えます。一方で、`commit push` や `PR 作成` のような操作指示だけを大量に出すと PR body が読みにくくなります。

その境界として `substantive_prompt_shape` を使います。これは言語 keyword ではなく、文字列の構造だけを見る signal です。

- whitespace 区切りがある言語では、十分な token 数がある prompt を実質的な相談として扱う。
- 短い質問は、一定以上の token 数と `?` / `？` がある場合だけ拾う。
- 日本語・中国語・韓国語のように whitespace token が少ない言語では、CJK/Hangul 文字数が十分ある場合、または 4 token 以上で CJK/Hangul を含む場合だけ拾う。
- runtime resolver でも prompt text から `substantive_prompt_shape` を再評価します。これにより、過去 note に signal が保存されていない場合でも、threshold 調整後の表示 preset を migration なしで改善できます。
- approval word や command word の辞書は持たない。`yes`, `はい`, `OK`, `commit push`, `create PR` のような短い操作指示は、この signal だけでは `medium` にしない。

`substantive_prompt_shape` は `bridge` と `tail` を `compact` に残すための補助です。ただし `high` にはせず、`medium` として扱います。

### Response evidence cap

Response / transcript は短い prompt の意味を補えますが、agent が「やる予定」と言っただけで実際には commit されないことがあります。そのため response evidence は次の cap を持ちます。

- response evidence だけでは `high` にしない。
- response evidence は補助 score として使うが、それだけでは `bridge` / `tail` を `medium` に上げない。prompt 側の path / identifier / inline code / substantive shape がある場合にだけ、流れを補強する。
- `high` にするには prompt 自体の exact path / diff identifier / primary edit turn が必要。

### Split commit policy

Short commit window でも、別 commit の primary edit を current commit に混ぜてはいけません。

latest primary turn 後に non-primary edit turn が現れた場合、その turn は current commit から除外します。その後の tail prompt は、current commit file / diff identifier を持つ場合だけ current commit に残します。anchor がない tail は、後続 commit の context として残しません。

つまり `full` は「commit-to-commit のすべて」ではなく、**hard noise と別 commit の primary edit を除いた full trace** です。

ここでの「除外」は、該当 turn の interaction を current commit の git note に保存しないという意味です。`selection.signals: []` や score 0 の interaction として保存しません。保存しないことで、後続 split commit がその turn を primary として再評価できます。

### Tail consumed-state policy

Tail prompt は `prompt_scope: "tail"` で `committed_pairs.jsonl` に記録しますが、`maxConsumedTurn` は進めません。これは後続 commit の primary edit を誤って消費済みにしないためです。

次 commit での扱い:

- `tailPromptIds` に含まれる prompt は、同じ role / same display-only tail としては再表示しません。
- ただし、その prompt の turn が次 commit の `primary` になった場合は再評価を許可します。tail marker は edit ownership を消費しないためです。
- 次 commit で `primary` にならない場合は、古い tail prompt を通常の `window` context として復活させません。commit / PR 作成のような boundary prompt が、後続 commit の compact 表示に混ざるのを防ぐためです。
- 未消費の tail prompt は、prompt 本文だけでなく response が current commit file / diff identifier に強く接続している場合も保持します。これは `自己レビューを5回やって` のように、prompt は短いが response が実際の verification / risk review を説明しているケースを落とさないためです。
- つまり tail marker は「同じ prompt を補足 tail として重複表示しない」ための dedupe であり、「その prompt を将来の commit から完全に除外する」ための consumed marker ではありません。

この distinction がないと、PR 作成直前の tail prompt が何度も出るか、逆に後続 split commit の primary prompt が失われます。

Regression では、過去 scope、次 commit での再解釈、prompt shape、response anchor、commit boundary、post-primary edit barrier、non-primary edit turn を組み合わせた 4,608 ケースの state-transition simulation を持ちます。単発の score だけでなく、前 commit の `prompt_scope: "tail"` が次 commit にどう効くか、response evidence で review tail を救えるかを検証対象にします。

### Runtime level 境界の直感

`high` は「これだけ読めば commit の理由が最低限わかる」です。primary edit prompt、明示的な file path / identifier 付き prompt、commit scope を直接指定する prompt が入ります。

`medium` は「これがあると流れが自然になる」です。final review、変更目的の説明要求、短すぎない質問・相談、prompt 側に file / identifier / inline code がある tail prompt が入ります。`commit push` や commit 許可だけの tail prompt は、response 側に path があっても `low` に留めます。

`low` は「full trace では残したいが、PR body default では省略できる」です。承認の bridge、短い位置指定、背景相談、commit-to-commit window の薄い prompt が入ります。

この境界により、`compact` は読みやすい PR Report、`full` は Dashboard / debugging 向けの完全寄り trace になります。

### Positive signals

| Signal | 例 | 理由 |
| --- | --- | --- |
| `primary_edit_turn` | commit file を実際に触った turn | Commit に直接つながるため最重要 |
| `before_commit_boundary` | commit 直前の final review / PR 作成指示 | edit ownership ではないが commit narrative には必要 |
| `exact_commit_path` | `packages/cli/package.json` | Commit file と直接対応 |
| `commit_file_basename` | `package.json` | path が省略されても対応できる |
| `diff_identifier` | `readMaxConsumedTurn` | diff 内の code identifier と対応 |
| `response_exact_commit_path` | response に exact commit file path がある | 短い prompt の意味を response から補える |
| `response_basename_or_identifier` | response に basename / identifier がある | short prompt の補助 evidence |
| `commit_subject_overlap` | commit subject と token が重なる | tie-breaker としてだけ使う |
| `list_or_checklist_shape` | 箇条書き、複数行の確認項目 | 作業 scope を表しやすい |
| `multi_line_instruction` | 複数行の作業指示 | scope prompt の補助 |
| `inline_code_or_path_shape` | inline code / flag / path-like token | code-oriented prompt の補助 |
| `substantive_prompt_shape` | `what about basename-only evidence?` / `今後の汎用性、調整も考えて...` | 短すぎない相談・質問を `compact` に残すための language-neutral 補助 |
| `between_non_excluded_prompts` | `ここで`、`はい` | 前後の non-excluded prompt / response と一体なら残す |

### Negative signals

| Signal | 例 | 理由 |
| --- | --- | --- |
| `quoted_history` | `🧑 Prompt` と `🤖 Response` を含む pasted history | 古い会話の再掲で、現在 commit の prompt ではない |
| `detached_tiny` | 1 文字の `c` | 単独では情報量が少ない |
| `old_consumed_window` | previous commit で window 消費済み | stale prompt の復活を防ぐ |
| `large_unanchored_backlog` | 長いが path / identifier がない古い相談 | full session backlog 化を防ぐ |

## Runtime level の意味

Runtime score から runtime に `level` を決めます。

ここでの `low / medium / high` は **prompt の重要度** です。表示設定の強さではありません。

| Level | 表示の考え方 | 主な用途 |
| --- | --- | --- |
| `high` | その commit の最小説明に必要 | PR Report の concise 表示 |
| `medium` | 会話の流れを自然にする | PR Report の default 候補 |
| `low` | Dashboard では見たいが PR body では省略してよい | Dashboard / detailed mode |

重要なのは、runtime level が `low` でも git note には残すことです。表示側が `low` を隠しても、Dashboard や将来の詳細表示で復元できます。

Level は保存済み schema ではなく、次のような pure function で導出します。

```ts
type PromptRuntimeLevel = "low" | "medium" | "high";

function resolvePromptRuntimeLevel(runtime: PromptRuntimeSelection): PromptRuntimeLevel {
  if (runtime.role === "primary") return "high";
  if (runtime.role === "bridge") return runtime.score >= 45 ? "medium" : "low";
  if (runtime.role === "anchored_bridge") return runtime.score >= 45 ? "medium" : "low";
  if (runtime.score >= 75) return "high";
  if (runtime.score >= 45) return "medium";
  return "low";
}
```

この関数は PR Report / Dashboard / CLI preview で共有します。将来 threshold を変える場合は、この function と tests を更新すればよく、git note migration は不要です。

## 表示 preset

設定名は `prompt_detail` です。

`prompt_detail` は **表示の細かさ** です。runtime level と同じ名前にしないことで、`low` が「全文表示」なのか「低重要度」なのか混乱するのを避けます。

| Preset | 表示するもの | 想定 |
| --- | --- | --- |
| `compact` | `high` + `medium` | PR Report default。短すぎず、操作だけの `low` は隠す |
| `full` | `high` + `medium` + `low` | Dashboard / debug / traceability 優先 |

整理すると次の対応です。

| Runtime level | `compact` | `full` |
| --- | --- | --- |
| `high` | 表示 | 表示 |
| `medium` | 表示 | 表示 |
| `low` | 非表示 | 表示 |

GitHub Action input は PR Report で `prompt_detail` として提供します。Dashboard は現在 full trace を見せる UI として扱い、必要になったら同じ preset を UI 側に追加します。

```yaml
with:
  prompt_detail: compact
```

CLI preview も同じ `--prompt-detail compact|full` を受け取り、local preview と GitHub Action の PR Report が一致するようにします。既存 workflow への安全弁として、`standard` は `compact` の legacy alias として解釈しますが、公開 docs には出しません。

## #43 の判断

PR #43 の prompt 群は、ユーザー目線では次の判断が自然です。

| Prompt | Role | Level | 残すべきか | 理由 |
| --- | --- | --- | --- | --- |
| `README にそんな詳細は必要か？` | `background` or `scope` | `low` | `full` で残す | Node requirement の置き場所を決める前段 |
| `github action の node 20 って deprecated...` | `scope` | `medium` | `compact` 以上で残す | Node 20 / Node 22 判断の根拠 |
| `README 要件は Node 22 以上にしなくていい？` | `scope` | `medium` | `compact` 以上で残す | README に書くかどうかの判断 |
| `はい` | `bridge` | `low` | `full` で残す | 単体では弱いが、直前の判断を承認する bridge |
| `この repository ... Node.js 22.12 以上 この明記は不要` | `direct_anchor` | `high` | `compact` でも残す | 直接の修正指示 |
| `書くなら CONTRIBUTING` | `anchored_bridge` | `medium` | `compact` 以上で残す | 修正先を指定する重要な bridge |
| `それぞれ変更目的教えて` | `tail` | `medium` | `compact` 以上で残す | 変更理由を確認しており PR narrative に必要 |
| `はい。PRまで作成して` | `tail` | `low` | `full` で残す | commit / PR 作成の boundary trigger だけなら `low`。response が exact commit path を持っていても単独では `medium` にしない |

つまり、今回のような短い commit-to-commit window では、score が低い bridge prompt も残した方が自然です。PR body を短くしたい場合だけ、表示 preset で隠します。

## 実装案

### Phase 1: scoring pure function

`record.ts` から切り出して pure function 化します。

```ts
type PromptSelectionCandidate = {
  prompt: string;
  response: string | null;
  turn: number;
  promptId?: string;
  isPrimaryTurn: boolean;
  isEditTurn: boolean;
  isTail: boolean;
  commitFiles: string[];
  commitSubject: string;
  diffIdentifiers: Set<string>;
};

type PromptSelectionAnalysis = {
  runtime: PromptRuntimeSelection;
  source: InteractionSelection["source"];
  signals: PromptSelectionSignal[];
  hardExcluded: boolean;
};

function analyzePromptSelection(candidate: PromptSelectionCandidate): PromptSelectionAnalysis;
function toPersistedSelection(analysis: PromptSelectionAnalysis): InteractionSelection | null;
```

`analyzePromptSelection()` は test / simulation のために runtime score を返しますが、`toPersistedSelection()` は `schema`, `source`, `signals` だけを git note 用に残します。`hardExcluded: true` の場合は `null` を返し、score 0 の placeholder interaction は保存しません。

`isTail` は caller が `turn > latestPrimaryTurn` から pre-compute します。classifier は `candidate.isTail` を見るだけにし、`latestPrimaryTurn` を直接参照しません。これにより unit test では git fixture なしに tail scenario を表現できます。

テストは git fixture なしで書けます。

### Phase 2: short commit window policy

Commit boundary があり、window が十分短い場合は、hard noise だけを落として連続 window を保存します。

- `quoted_history` は落とす。
- detached 1-character prompt は落とす。
- それ以外は保存し、`selection.source` / `selection.signals` を付ける。
- latest primary turn 後の prompt は `source: "tail"` として保存する。
- tail は `prompt_scope: "tail"` で consumed state に記録し、`maxConsumedTurn` には使わない。

これにより、後続 commit の attribution は壊さず、PR Report / Dashboard の文脈は自然になります。

### Phase 3: renderer filter

PR Report は、`selection.source` / `selection.signals` から runtime score / role / level を計算して表示を調整します。Dashboard は詳細確認の場なので、現時点では保存された full trace を表示します。

```ts
type PromptDetail = "compact" | "full";

function shouldRenderInteraction(
  interaction: Interaction,
  detail: PromptDetail,
) {
  const runtime = interaction.selection
    ? resolvePromptRuntimeSelection(interaction.selection, interaction)
    : { score: 100, role: "primary", level: "high" };
  const level = runtime.level;
  if (detail === "full") return true;
  return level !== "low";
}
```

Legacy note は `selection` がないため、従来通り表示します。

### Phase 4: Action / CLI input

- root `action.yml` に `prompt_detail` を追加します。
- default は `compact`。
- CLI `agent-note pr` に `--prompt-detail` を追加し、local preview と CI を一致させます。
- Dashboard は UI で切り替えられるなら将来 `compact` / `full` を追加できます。現時点では traceability 優先で full 相当です。

## テスト計画

### Simulation acceptance criteria

renderer preset を有効化する前に、PR #29 / #33 / #43 / BUGS PR 群の notes から simulation fixture を作ります。少なくとも次を満たすまで weights / thresholds を調整します。

- `compact` は primary / exact anchor / direct scope に加え、final review、変更目的確認、file-anchored bridge を含み、PR Report として自然に読める。
- `full` は hard noise と別 commit primary edit を除いた commit-to-commit trace を読める。
- PR #43 型では Node 20 / README / CONTRIBUTING の前段が `compact` または `full` に残る。
- Split commit 型では、別 commit の primary edit turn が current commit に混入しない。
- BUGS PR 型では「マージした、次の作業にうつって」系の short prompt が、必要なら context / adjacent evidence で補える。
- Prompt-only Codex 型では、transcript primary が弱くても fallback が noisy full-session backlog にならない。
- Claude / Cursor / Gemini 型では、existing attribution / files_touched / AI ratio が変わらない。

Simulation output は、各 fixture について `compact`, `full` の prompt list と runtime role / score / level を保存し、人間が確認できる形にします。

### Unit tests

- primary edit turn は常に high。
- file path / basename / diff identifier がある prompt は high 以上。
- response に structural anchor があるだけの短い prompt は low に留め、prompt 側の substantive shape や path がある場合だけ medium 以上。
- `はい` のような短い prompt は単独では low だが、short commit window 内の bridge なら保存される。
- `c` のような 1 文字 prompt は detached tiny として落ちる。
- quoted prompt history は score に関係なく落ちる。
- keyword list に依存しない。日本語 / 英語 / その他言語の approval word は特別扱いしない。

### Record tests

- PR #43 型: Node 20 / README / CONTRIBUTING の前段を含む short window が保存される。
- Split commit 型: tail prompt を保存しても、後続 commit の primary prompt が消費済みにならない。
- PR #29 型: long window は full backlog にならず、trimLongPromptWindow が効く。
- Prompt-only Codex 型: transcript-driven path でも同じ score が付く。
- Claude / Cursor / Gemini 型: session-driven path でも adapter 固有の attribution を変えない。

### Renderer tests

- `prompt_detail: compact` は runtime `level: "high"` と runtime `level: "medium"` を表示。
- `prompt_detail: full` は runtime `level: "low"` も含めて表示。
- legacy note は `selection` がなくても従来通り表示。
- `mergePromptOnlyDisplayInteractions()` が selection metadata を失わない。

## リスク

### Schema が少し増える

`interactions[].selection` が増えます。ただし additive なので既存 reader は無視できます。保存するのは stable evidence (`source`, `signals`, `schema`) だけにし、score / role / level は保存しません。

### Default 表示の選び方が難しい

PR Report default を短くしすぎると今回の違和感が戻ります。長くしすぎると PR body が読みにくくなります。最初は `compact` を default にし、Dashboard は詳細寄りにするのが安全です。

### Score を万能視しやすい

Score は「表示密度のための deterministic signal」であり、「意味理解」ではありません。迷う場合は record で残し、表示側で調整します。

## 推奨方針

最初の実装は次の順に進めます。

1. PR #29 / #33 / #43 / BUGS PR 群の notes を使って simulation fixture を作る。
2. Simulation fixture 上で initial weights / thresholds を 1 回 calibration する。
3. `InteractionSelection` を additive に追加する。
4. scoring pure function と unit test を追加する。
5. Short commit window を連続保存する policy に直す。
6. PR #43 相当の fixture で、前段が自然に残ることを確認する。
7. PR Report / Dashboard の表示 filter は後続 PR で入れる。

この順序なら、未検証の magic number を実装に固定せず、まず実データで score boundary を確認できます。そのうえで「途中の会話が抜ける」問題を解消しつつ、表示調整の土台を作れます。
