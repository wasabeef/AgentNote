# Agent Note 公開記事の投稿戦略

Agent Note 公開記事をどこに投稿するか、どの順番で広げるかをまとめます。

## 対象記事

- 日本語: `docs/blog/agent-note-launch.ja.md`
- 英語: `docs/blog/agent-note-launch.en.md`

日本語版と英語版は、構成と主張を揃えます。ただし、各言語で自然に読めるように細かい言い回しは調整して構いません。

## 投稿の目的

- Agent Note の使い方よりも、なぜ必要なのかを伝える
- Agent Note の立ち位置を明確にする
- Git-native な Commit / Pull Request Review の文脈記録ツールとして見せる
- PR Report、Dashboard、AI Review Tool 向け Hidden Comment、`agent-note why` の価値が伝わるようにする
- 細かいセットアップ手順は README と Documentation に任せる

## 日本語記事

### 第一候補: wasabeef.jp

日本語記事の canonical は `wasabeef.jp` にするのがよいです。

理由:

- 自分の資産として記事が残る
- 個人の問題意識や開発背景を書きやすい
- 使い方記事ではなく「なぜ作ったか」の記事なので、個人ブログとの相性が良い

### 第二候補: Zenn

Zenn には転載、または少し調整した版を投稿します。

理由:

- 日本の開発者に届きやすい
- OSS、AI Coding Tool、開発ワークフローの話題と相性が良い
- Qiita よりも、思想や背景を含む記事を載せやすい

追記するなら、以下のような一文を入れます。

```md
この記事は Agent Note 公開記事として、wasabeef.jp にも掲載しています。
```

### 今回は主戦場にしない: Qiita

今回の公開記事をそのまま Qiita に載せる優先度は低いです。

Qiita には、後日もっと実用寄りの記事を書く方が合います。

- `agent-note init` から PR Report まで
- GitHub Action で Dashboard を公開する
- `agent-note why` で行の背景を追う

## 英語記事

### 第一候補: DEV Community

英語記事は DEV Community に投稿するのがよいです。

理由:

- OSS Developer Tool の読者がいる
- GitHub の外にも届きやすい
- README だけでは伝わりにくい背景や設計思想を書きやすい

canonical URL を設定できる場合は、公開後の安定 URL を指定します。

### 任意: Hashnode

Hashnode は任意です。

もう 1 つ英語圏の配信面を増やしたい場合だけ使います。使う場合は DEV Community と内容を揃え、可能なら canonical URL を設定します。

## 告知導線

記事全文を貼る場所と、短い告知で流す場所を分けます。

短い告知を出す候補:

- GitHub README
- GitHub Release
- X
- Hacker News
- AI Coding Workflow の話題が合う Reddit community

## 告知文案

### X / Short Post

```text
I released Agent Note.

It records the prompts, responses, changed files, AI Ratio, and review context behind AI-assisted commits using Git notes.

The goal is simple: make AI-written code reviewable after the coding session is gone.

https://github.com/wasabeef/AgentNote
```

### Hacker News

タイトル案:

```text
Show HN: Agent Note – Git notes for AI coding sessions
```

本文案:

```text
Agent Note is a CLI and GitHub Action that records prompts, responses, changed files, and AI Ratio for AI-assisted commits using Git notes.

It adds PR Reports, Dashboard views, hidden reviewer context for AI review tools, and a `why` command that connects `git blame` to the Agent Note attached to the blamed commit.
```

## メッセージの軸

どこに投稿しても、以下の軸はぶらさないようにします。

- Agent Note は Git-native
- Agent Note は Commit と Pull Request Review に集中している
- Agent Note は Hosted Service ではない
- Agent Note は authorship や code quality を証明するものではない
- AI Ratio は推定値であり、判定ではない
- Prompt / Response / Context はレビュー材料であり、人間のレビューを置き換えるものではない

## 後続記事の候補

公開記事のあとに書けそうな記事:

- 実用編: `agent-note init` から PR Report まで
- GitHub Pages で Dashboard を公開する
- Copilot / CodeRabbit / Devin / Greptile に Hidden Reviewer Context を読ませる
- `agent-note why`: 1 行のコードから AI との会話に戻る
- Agent Note と Entire の違い
