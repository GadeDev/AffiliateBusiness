# 自動運用ガイド

このドキュメントは、AffiliateBusinessを受託運用するための実務手順です。

方針は「日次作業をゼロに近づけ、受託者はSlackとステータスだけ見る」です。

## 運用の考え方

| 領域 | 自動化すること | 人が見ること |
|---|---|---|
| LP企画 | Claudeがジャンル別に企画 | クライアント方針とズレていないか |
| LP生成 | Claudeが本文生成、DB保存 | 週次で上位LPを確認 |
| ニュース反応 | RSSの見出しから独自コメントを生成 | 配信元が不適切でないか |
| X投稿 | キューから自動投稿 | 失敗/停止通知がないか |
| 計測 | クリックログを自動集計 | Slackレポートを見る |
| 改善提案 | 週次でClaudeが提案 | クライアント報告に使う |

## 自動実行スケジュール

GitHub Actionsで実行します。

| JST | Workflow | 内容 |
|---|---|---|
| 05:00 月曜 | `pipeline-generate.yml` | 稼働Xが3ジャンル以上なら、全体で最大3本のLP企画・生成・投稿キュー作成 |
| 06:00 毎日 | `pipeline-post.yml` | 朝投稿 |
| 12:00 毎日 | `pipeline-news.yml` | ジャンル別ニュースコメントを投稿キュー作成 |
| 12:15 毎日 | `pipeline-post.yml` | ニュースコメント投稿 |
| 20:00 毎日 | `pipeline-post.yml` | 夜投稿 |
| 21:00 毎日 | `report-daily.yml` | 日次Slackレポート |
| 08:00 月曜 | `report-weekly.yml` | 週次Slackレポート |

すべて `workflow_dispatch` 対応済みなので、GitHub画面から手動再実行できます。

LP定期生成には費用ガードがあります。稼働Xジャンルが3未満なら新規LPを作らず、Slackへ停止継続を通知します。3以上になった場合も、有効なXアカウントがあるジャンルだけを対象に、前回生成が古い順で最大3本に制限します。個別LPが必要な場合は `ops-lp-generate` を使うため、この定期上限には影響されません。

GitHub Actions上では、`DATABASE_URL` が未設定の場合は失敗させます。一時SQLiteで成功扱いになると、実際には本番運用されていないのに緑チェックだけ付くためです。

## 受託者の標準作業

### 毎日

1. Slackの日次レポートを見る
2. 失敗通知がなければ何もしない
3. 失敗通知があれば `pnpm ops:status` を実行するか、Codexに「運用状態を確認して」と依頼する

### 毎週

1. Slackの週次レポートを見る
2. クリック上位LP、ジャンル別クリック、改善提案をクライアント報告に転記する
3. 新しい案件URLや強化したいジャンルがあれば、オファー追加を依頼する

### 新しい案件を受け取った時

クライアントから以下を受け取ります。

| 必須 | 内容 |
|---|---|
| 案件名 | LPや管理用の名称 |
| アフィリエイトURL | リダイレクト先 |
| ジャンル | `career` / `investment` / `household` / `love` / `baseball` |
| 説明 | 誰向けで何を訴求する案件か |
| 優先度 | 強く回したい案件ほど大きい数字 |

Codexへの依頼例:

```text
新しいオファーを追加して、自動運用に乗せてください。
ジャンル: investment
案件名: ○○証券の無料口座開設
URL: https://example.com/aff
説明: 投資初心者向け。NISA開始前の比較検討層。
優先度: 5
```

## ステータス確認

```bash
cd /Users/yanagiho-mba/GrassrootsFootball/cloudflare/evil-base-battle/AffiliateBusiness
pnpm ops:status
```

このコマンドは読み取り専用です。表示された `次の対応` だけ見ればよいです。

主な表示:

| 表示 | 意味 |
|---|---|
| `OK` | 問題なし |
| `WARN` | すぐ止まるとは限らないが、設定推奨 |
| `NG` | 自動運用が止まる要因 |

## 初回セットアップ

### 1. DBマイグレーション

本番DBにスキーマを適用します。

```bash
pnpm migrate
```

GitHub Actions上では `migrate.yml` を手動実行してもよいです。

### 2. ジャンル投入

```bash
pnpm cli genre:seed
```

### 3. オファー登録

```bash
pnpm cli offer:add \
  --name "案件名" \
  --url "https://example.com/aff" \
  --genre career \
  --priority 5
```

### 4. SNSアカウント登録

GitHub Actionsの `ops-x-bootstrap` を使うのが推奨です。5ジャンル分をまとめて準備し、Secretsが4点揃ったアカウントだけ有効化します。

CLIで個別に登録・更新する場合:

```bash
pnpm cli account:ensure \
  --slug career_scope_jp \
  --genre career \
  --platform twitter \
  --daily-cap 2 \
  --active false
```

### 5. Secrets登録

GitHub Secretsに登録します。

```text
DATABASE_URL
ANTHROPIC_API_KEY
SLACK_WEBHOOK_URL
TW_CAREER_SCOPE_JP_API_KEY
TW_CAREER_SCOPE_JP_API_SECRET
TW_CAREER_SCOPE_JP_ACCESS_TOKEN
TW_CAREER_SCOPE_JP_ACCESS_SECRET
```

他ジャンルも同じ形式です。

GitHub Variablesには以下を登録します。

```text
WEB_BASE_URL=https://affiliate-web.yanagiho.workers.dev
```

### 6. X接続確認

Secrets登録後に、GitHub Actionsで以下を実行します。

1. `ops-x-bootstrap`
2. `ops-x-check`

`ops-x-check` は投稿せず、X APIの認証だけ確認します。成功後に `pipeline-generate` と `pipeline-post` を手動実行すると、本番の自動投稿導線を確認できます。

### 7. ニュースコメント自動投稿

昼の投稿は `pipeline-news.yml` がRSSから候補を集め、`pipeline-post.yml` が投稿します。

デフォルトでは以下を参照します。

| 配信元 | 用途 |
|---|---|
| PR TIMES | 企業発表、サービス、消費者向けトピック |
| NHKニュース | 社会・経済・スポーツなどの一般ニュース |

ニュース投稿は記事本文を取得しません。RSSのタイトル・配信元・URLから、各Xアカウントのジャンルに合う独自コメントを作ります。

配信元を増やしたい場合は、GitHub Variables に `NEWS_FEEDS_JSON` を登録します。

```json
[
  {
    "url": "https://example.com/rss.xml",
    "source": "Example News",
    "genres": ["investment", "household"],
    "keywords": ["投資", "保険"]
  }
]
```

初回確認だけ行いたい場合は、GitHub Actionsで `pipeline-news` を開き、`dry_run` をオンにして実行します。dry runではDBに書き込まず、投稿もされません。

## 障害対応

### LP生成が止まった

Slackに `LP定期生成は停止を継続` と表示された場合は正常な費用制御です。稼働Xジャンルが3未満の間は、既存LPを優先して新規生成しません。

確認するもの:

1. `ANTHROPIC_API_KEY`
2. Anthropic APIの残高
3. `pipeline-generate` のGitHub Actionsログ
4. `pipeline_runs` の `generate` 行

### X投稿が止まった

確認するもの:

1. X Developer PortalのAPI権限（Read and write）
2. `TW_<SLUG>_*` の4キー
3. GitHub Actionsの `ops-x-check`
4. `pnpm ops:status` の停止アカウント表示
5. 3連続失敗で停止している場合、修正後に `ops-x-bootstrap` を再実行する

### Slack通知が来ない

確認するもの:

1. `SLACK_WEBHOOK_URL`
2. GitHub Actionsの該当workflowが成功しているか
3. Slack側でWebhook投稿先チャンネルが削除されていないか

### 投稿キューが詰まっている

対応:

1. `pnpm ops:status` で期限超過pending数を見る
2. GitHub Actionsの `pipeline-post` を手動実行する
3. 失敗が続く場合はX APIキーを確認する

## クライアント報告テンプレート

週次報告は以下の形で十分です。

```text
今週の運用状況

- 生成LP数:
- X投稿数:
- クリック数:
- クリック上位LP:
- 伸びたジャンル:
- 来週の改善方針:
- 対応が必要な確認事項:
```

## やらないこと

規約違反や運用事故を避けるため、以下は自動化しません。

- A8.netなどASP管理画面への自動ログイン
- Xの非公式API、スクレイピング、自動フォロー/RT/リプライ
- ニュース記事本文の転載やスクレイピング
- 同じ投稿文の複数アカウント同時投稿
- アフィリエイト案件の自動提携申請

## 次の優先タスク

1. Xアカウント5件のDeveloper Portal承認
2. GitHub Secretsに `TW_<SLUG>_*` を登録
3. `ops-x-bootstrap` → `ops-x-check` を実行
4. 各ジャンルの有効オファー登録
5. `ops-status` が重大NGなしになる状態まで整える
6. `pipeline-generate` → `pipeline-post` を手動実行してSlack通知まで確認する
