# 自動運用ガイド

このドキュメントは、AffiliateBusinessを受託運用するための実務手順です。

方針は「日次作業をゼロに近づけ、受託者はSlackとステータスだけ見る」です。

## 運用の考え方

| 領域 | 自動化すること | 人が見ること |
|---|---|---|
| LP企画 | Claudeがジャンル別に企画 | クライアント方針とズレていないか |
| LP生成 | Claudeが本文生成、DB保存 | 週次で上位LPを確認 |
| X投稿 | キューから自動投稿 | 失敗/停止通知がないか |
| 計測 | クリックログを自動集計 | Slackレポートを見る |
| 改善提案 | 週次でClaudeが提案 | クライアント報告に使う |

## 自動実行スケジュール

GitHub Actionsで実行します。

| JST | Workflow | 内容 |
|---|---|---|
| 05:00 毎日 | `pipeline-generate.yml` | LP企画、LP生成、投稿キュー作成 |
| 06:00 毎日 | `pipeline-post.yml` | 朝投稿 |
| 20:00 毎日 | `pipeline-post.yml` | 夜投稿 |
| 21:00 毎日 | `report-daily.yml` | 日次Slackレポート |
| 08:00 月曜 | `report-weekly.yml` | 週次Slackレポート |

すべて `workflow_dispatch` 対応済みなので、GitHub画面から手動再実行できます。

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

```bash
pnpm cli account:add \
  --slug career_scope_jp \
  --genre career \
  --platform twitter \
  --daily-cap 2
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

## 障害対応

### LP生成が止まった

確認するもの:

1. `ANTHROPIC_API_KEY`
2. Anthropic APIの残高
3. `pipeline-generate` のGitHub Actionsログ
4. `pipeline_runs` の `generate` 行

### X投稿が止まった

確認するもの:

1. Twitter Developer PortalのAPI権限
2. `TW_<SLUG>_*` の4キー
3. `pnpm ops:status` の停止アカウント表示
4. 3連続失敗で停止している場合、修正後に `pnpm cli account:enable <id>`

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
- 同じ投稿文の複数アカウント同時投稿
- アフィリエイト案件の自動提携申請

## 次の優先タスク

1. GitHub Secrets / Variables の不足確認
2. Xアカウント5件のDeveloper Portal承認
3. 各ジャンルの有効オファー登録
4. `pnpm ops:status` が重大NGなしになる状態まで整える
5. GitHub Actionsを手動実行してSlack通知まで確認する
