# AffiliateBusiness 受託運用マニュアル

このシステムは、アフィリエイトLPの生成、X投稿、クリック計測、日次/週次レポートを自動化するための運用基盤です。

受託者が毎日細かく触る前提ではなく、**Slack通知とステータス確認を見て、止まった時だけ対応する**形を目指します。

## まず見るもの

通常は以下の3つだけ見れば十分です。

| 見るもの | 目的 |
|---|---|
| Slack通知 | 日次サマリ、週次レポート、異常通知の確認 |
| GitHub Actions | 自動生成、投稿、レポート処理の実行状況確認 |
| `pnpm ops:status` | 現在の運用準備・停止理由・次の対応確認 |

## 現在の自動運用

GitHub Actions cron により、以下が自動実行されます。

| 時刻 | 内容 | 実行ファイル |
|---|---|---|
| 毎日 05:00 JST | LP企画、LP生成、投稿キュー作成 | `pipeline/generate.ts` |
| 毎日 06:00 / 20:00 JST | X投稿キューの投稿 | `pipeline/post.ts` |
| 毎日 21:00 JST | 日次サマリをSlack通知 | `pipeline/report-daily.ts` |
| 毎週月曜 08:00 JST | 週次分析と改善提案をSlack通知 | `pipeline/report-weekly.ts` |

LPはDBから動的に配信されるため、LP生成のたびに手動デプロイする必要はありません。

GitHub Actionsでは、本番DBなどの必須設定がない場合は失敗させます。見かけ上だけ成功して実際には運用されていない、という状態を避けるためです。

## 受託者の定例作業

### 毎日

1. Slackの日次サマリを見る
2. 異常通知がなければ何もしない
3. 異常通知があれば、このリポジトリで以下を実行する

```bash
cd /Users/yanagiho-mba/GrassrootsFootball/cloudflare/evil-base-battle/AffiliateBusiness
pnpm ops:status
```

### 週1回

1. Slackの週次レポートを見る
2. クリック上位LP、伸びたジャンル、改善提案をクライアント報告に使う
3. 新しいアフィリエイト案件や訴求方針があれば、オファーとして追加する

### クライアントから新案件が来た時

オファー追加はCodexに依頼してください。依頼文はこの形で十分です。

```text
このアフィリエイト案件を運用に追加してください。
ジャンル: 転職
案件名: ○○転職エージェント
URL: https://example.com/affiliate
説明: 20代後半から30代向けの転職支援
優先度: 5
```

## 運用ステータス確認

```bash
pnpm ops:status
```

このコマンドはDBを書き換えません。以下を確認します。

- Claude APIキーがあるか
- Slack通知が設定されているか
- ジャンルごとに有効なオファーがあるか
- ジャンルごとに有効なXアカウントがあるか
- X APIキーが不足していないか
- 投稿キューが詰まっていないか
- 3連続失敗で停止したアカウントがないか
- 直近の自動実行が成功しているか

`次の対応` に表示された項目だけ処理すればよい設計です。

## 初回セットアップで必要なもの

以下は一度だけ設定します。値はリポジトリに書かず、GitHub Secrets / Cloudflare Secrets に登録します。

| 項目 | 用途 |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL |
| `ANTHROPIC_API_KEY` | LP企画・LP本文・投稿文生成 |
| `SLACK_WEBHOOK_URL` | 日次/週次/異常通知 |
| `WEB_BASE_URL` | 公開LPのベースURL |
| `TW_<SLUG>_API_KEY` | X投稿用APIキー |
| `TW_<SLUG>_API_SECRET` | X投稿用APIシークレット |
| `TW_<SLUG>_ACCESS_TOKEN` | X投稿用アクセストークン |
| `TW_<SLUG>_ACCESS_SECRET` | X投稿用アクセストークンシークレット |

Xアカウントのslug例:

| ジャンル | slug |
|---|---|
| 転職 | `CAREER_SCOPE_JP` |
| 投資 | `ASSET_BRIEF_JP` |
| 家計改善 | `KAKEI_RESET_NOTE` |
| 恋愛 | `LOVE_SIGNAL_EDIT` |
| 野球 | `BASEBALL_POINT_JP` |

## 管理コマンド

非エンジニア運用では、直接実行せずCodexに依頼する運用で問題ありません。

```bash
pnpm migrate
pnpm cli genre:seed
pnpm cli offer:list
pnpm cli account:list
pnpm ops:status
```

オファー追加例:

```bash
pnpm cli offer:add \
  --name "○○転職エージェント" \
  --url "https://example.com/affiliate" \
  --genre career \
  --priority 5
```

アカウント有効化例:

```bash
pnpm cli account:enable 1
```

## 自動運用の安全ルール

Xの規約違反を避けるため、以下は仕様として固定しています。

- 1アカウントは1ジャンル専属
- 同一・類似文面の複数投稿を避ける
- 1アカウント1日3投稿まで
- 相互RT、相互リプライ、相互フォローの自動化はしない
- 3連続失敗したアカウントは自動停止する
- 公式X API v2のみ使う

## クライアントへの報告材料

最低限、週次で以下をまとめれば運用報告になります。

| 項目 | 取得元 |
|---|---|
| 生成LP数 | Slack週次レポート |
| 投稿成功数/失敗数 | Slack日次/週次レポート |
| クリック数 | Slack日次/週次レポート、管理画面 |
| クリック上位LP | Slack週次レポート |
| 来週の改善提案 | Slack週次レポート |

## よくある停止理由

| 表示/症状 | 対応 |
|---|---|
| `ANTHROPIC_API_KEY 未設定` | GitHub SecretsにClaude APIキーを登録 |
| `SLACK_WEBHOOK_URL 未設定` | Slack Incoming Webhookを作成してGitHub Secretsに登録 |
| `X APIキーを登録する` | Twitter Developer Portal承認後、GitHub Secretsに4キーを登録 |
| `3連続失敗で停止中` | APIキー・権限を直してから `account:enable` |
| `有効オファーを登録する` | クライアントから案件URLを受け取り、オファー追加 |

## 本番URL

| アプリ | URL |
|---|---|
| LP公開 | https://affiliate-web.yanagiho.workers.dev |
| 管理画面 | https://affiliate-admin.yanagiho.workers.dev |

## 技術情報

詳しい実装状況は [CLAUDE.md](/Users/yanagiho-mba/GrassrootsFootball/cloudflare/evil-base-battle/AffiliateBusiness/CLAUDE.md) を参照してください。

全自動化の仕様は [SPEC_automation.md](/Users/yanagiho-mba/GrassrootsFootball/cloudflare/evil-base-battle/AffiliateBusiness/SPEC_automation.md) にあります。
