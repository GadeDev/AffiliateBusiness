# CLAUDE.md

## プロジェクト概要

AI運用型アフィリエイト事業基盤。LP・診断導線・クリック計測を一元管理するモノレポ。

> **重要: 実体のある作業ディレクトリ**
> `/Users/yanagiho-mba/GrassrootsFootball/cloudflare/evil-base-battle/AffiliateBusiness`
> `/Users/yanagiho-mba/iroiro/Affiliate/AffiliateBusiness` は別ディレクトリで、現在は本体ではない。

> **全自動化の正仕様: [`SPEC_automation.md`](./SPEC_automation.md)**
> 人の日次作業ゼロ化（LP自動企画→生成→投稿→計測レポート）を GitHub Actions cron で実現する。
> Phase 1（CLI/スキーマ）・Phase 2（`pipeline/generate.ts`）・Phase 3（`pipeline/post.ts`）・
> Phase 4（`pipeline/report-daily.ts` / `report-weekly.ts` + `.github/workflows/`）実装済み。
> 2026-07-06: 昼のニュースコメント投稿（`pipeline/news.ts` / `pipeline-news.yml`）を追加。
> X運用ガードレール（§2.1: 1アカウント=1ジャンル / 1日3投稿ハードキャップ / 重複文面禁止 /
> 3連続失敗で自動停止 / 公式API v2のみ）とシークレット管理（§2.2: 平文禁止、`TW_<SLUG>_*`）は緩和不可。

## 技術スタック

- **モノレポ**: pnpm workspaces + Turborepo
- **フレームワーク**: Next.js 15 (App Router)
- **言語**: TypeScript 5
- **スタイリング**: Tailwind CSS v3
- **DB（ローカル）**: SQLite (better-sqlite3)
- **DB（本番）**: PostgreSQL（Neon）— `@neondatabase/serverless` でEdge/Cloudflare対応
- **認証**: NextAuth.js v5 (beta)
- **AI**: Anthropic Claude API
- **SNS**: Twitter API v2
- **デプロイ**: Cloudflare Workers（`@opennextjs/cloudflare`）

## ポート割り当て

| アプリ | ポート | 役割 |
|--------|--------|------|
| apps/web | 3000 | LP・診断LP・クリックリダイレクト |
| apps/admin | 3001 | クリックログ管理ダッシュボード |
| services/redirect | 3002 | 独立リダイレクトサービス |

## 起動方法

```bash
cp .env.example .env.local  # 初回のみ（値を編集すること）
pnpm install                # 初回のみ
pnpm dev                    # 全アプリ同時起動
```

## 必須環境変数（.env.local）

| 変数名 | 用途 | 必須 |
|--------|------|------|
| `AUTH_SECRET` | NextAuth.js署名鍵（`openssl rand -base64 32`で生成） | 本番必須 |
| `ADMIN_USERNAME` | 管理画面ユーザー名（デフォルト: admin） | 任意 |
| `ADMIN_PASSWORD` | 管理画面パスワード（デフォルト: password） | 本番必須 |
| `ANTHROPIC_API_KEY` | Claude API（LP自動生成） | LP生成使用時 |
| `DATABASE_URL` | PostgreSQL接続文字列（未設定=SQLite） | 本番必須 |
| `TWITTER_API_KEY` 他 | Twitter API v2認証情報 | SNS投稿使用時 |
| `WEB_BASE_URL` | LP URLの生成に使用（admin側。`wrangler.toml` [vars] で設定） | 本番必須 |

## 重要ファイル

| ファイル | 役割 |
|---------|------|
| `packages/shared/src/types.ts` | 全型定義 (Offer, ClickLog, SNSAccount, LPConfig, DiagnosticConfig等) |
| `packages/shared/src/db.ts` | DB抽象化レイヤー（SQLite/PostgreSQL対応）+ `?`→`$N` 変換。SQLiteのデフォルトDBはワークスペースルートの `data/clicks.db` を自動検出 |
| `packages/shared/src/index.ts` | `db`, `query` を含む全エクスポート |
| `packages/shared/src/claude.ts` | Claude API統合（LP自動生成・投稿文生成、モデル: claude-sonnet-4-6） |
| `packages/shared/src/sns.ts` | SNS投稿機能（Twitter API v2・キャラクター別投稿生成） |
| `scripts/ops-status.ts` | 非エンジニア向け運用ステータス確認（読み取り専用） |
| `scripts/cli.ts` | オファー/アカウント/ジャンル管理CLI |
| `pipeline/generate.ts` | LP企画・LP生成・投稿キュー作成 |
| `pipeline/news.ts` | RSSメタデータからジャンル別ニュースコメントを生成・投稿キュー作成 |
| `pipeline/post.ts` | 投稿キュー処理・X投稿・失敗時停止 |
| `pipeline/report-daily.ts` | 日次Slackレポート |
| `pipeline/report-weekly.ts` | 週次Slackレポート・改善提案 |
| `.github/workflows/*.yml` | GitHub Actions cron 定期実行 |
| `packages/shared/src/data/offers.ts` | オファー一覧（DB管理。新規追加は管理画面から） |
| `packages/shared/src/data/lp.ts` | LP設定一覧（DB管理） |
| `packages/shared/src/data/shindan.ts` | 診断設定一覧（DB管理） |
| `apps/web/app/go/[offer_id]/route.ts` | クリックログ保存 + 302リダイレクト |
| `apps/web/app/components/Footer.tsx` | PR表記・免責・privacy（全ページ共通） |
| `apps/web/lib/db.ts` | `@affiliate/shared` から `db`, `query` を re-export |
| `apps/web/wrangler.toml` | Cloudflare Workers設定（web） |
| `apps/web/open-next.config.ts` | @opennextjs/cloudflare設定（web） |
| `apps/admin/app/auth.ts` | NextAuth.js認証（認証情報は環境変数 ADMIN_USERNAME/PASSWORD） |
| `apps/admin/app/page.tsx` | クリックログ一覧・集計ダッシュボード |
| `apps/admin/app/offers/page.tsx` | オファー管理UI（登録・削除・一覧） |
| `apps/admin/app/sns-accounts/page.tsx` | SNSアカウント管理（JSONインポート・APIキー設定・キャラ一覧） |
| `apps/admin/app/api/offers/route.ts` | オファーCRUD API（GET/POST/DELETE） |
| `apps/admin/app/api/sns-accounts/route.ts` | SNSアカウントCRUD API（GET/POST一括インポート/PUT APIキー更新） |
| `apps/admin/middleware.ts` | 認証ミドルウェア |
| `apps/admin/wrangler.toml` | Cloudflare Workers設定（admin） |
| `apps/admin/open-next.config.ts` | @opennextjs/cloudflare設定（admin） |

## DB

- パス: `data/clicks.db`（プロジェクトルート、gitignore済み）
- 環境変数 `DATABASE_PATH` で上書き可
- 2026-06-21修正: ルート実行/アプリ実行のどちらでもワークスペースルートを探索し、誤って `../../data/clicks.db` を作らない
- ローカル: SQLite (better-sqlite3)
- 本番: PostgreSQL（`DATABASE_URL` を設定すると自動切替）
- SQL は `?` プレースホルダーで統一（PostgreSQL向けに内部で `$N` 変換）
- テーブル:
  - `click_logs` (id, offer_id, clicked_at, ip, user_agent, referer, utm_*)
  - `lp_configs` (slug, title, description, config, target_audience, offer_id, content, keywords, genre, created_at, updated_at)
  - `sns_accounts` (id, platform, account_name, theme, character_name, character_role, character_bio, character_tone, post_format, cta_style, forbidden_expressions, visual_direction, api_key, api_secret, access_token, access_secret, is_active, created_at, updated_at)
  - `sns_posts` (id, lp_slug, platform, post_id, content, success, error_msg, created_at)
  - `shindan_configs` (slug, title, description, config, created_at, updated_at)
  - `news_items` (id, genre_slug, title, url, source, published_at, queued_at, created_at)
- apps/web が書き込み担当、apps/admin は読み書き両方
- sns_accounts への既存DBマイグレーション: ALTER TABLE で自動追加（db.ts内）

## Next.js 15 注意点

- dynamic routes の params は **Promise**: `const { slug } = await params`
- shared パッケージ: `transpilePackages: ['@affiliate/shared']`（ビルドステップ不要）
- `serverExternalPackages` は削除済み（Cloudflare Edge では無意味）
- `better-sqlite3` はローカル開発専用。`require()` で遅延ロードしてEdgeクラッシュを防止

## Cloudflare デプロイ

- ツール: `@opennextjs/cloudflare`（`@cloudflare/next-on-pages` は Next.js 15.5.x 非対応のため不採用）
- DB クライアント: `@neondatabase/serverless`（`pg` の代替。HTTP/WebSocket でEdge対応）
- ビルドコマンド（ローカル確認用）:
  ```bash
  pnpm --filter @affiliate/web cf:build
  pnpm --filter @affiliate/admin cf:build
  ```
- デプロイコマンド:
  ```bash
  cd apps/web && npx wrangler deploy
  cd apps/admin && npx wrangler deploy
  ```
- `open-next.config.ts` は @opennextjs/cloudflare v1.17 形式（`wrapper`/`converter`/`proxyExternalRequest`/`incrementalCache`/`tagCache`/`queue` + `edgeExternals` + `middleware.external`）
- `wrangler.toml` に `nodejs_compat` フラグを設定済み（twitter-api-v2 等のNode.js依存対応）
- 環境変数（secret）は `npx wrangler secret put <NAME>` で設定済み

## 法的対応

- 景表法：全ページに `Footer` コンポーネントでPR・広告表記を強制表示
- `apps/web/app/layout.tsx` の `<Footer />` を外さないこと

## P0 実装済み（2026-03-13 完了）

- [x] LP共通テンプレ (`/lp/[slug]`)
- [x] 診断LP汎用エンジン (`/shindan/[slug]`) — 選択肢ツリー型、前に戻る機能付き
- [x] クリックログ保存 + 302リダイレクト (`/go/[offer_id]`)
- [x] UTMパラメータの保存・リダイレクト先への引き継ぎ
- [x] PR表記・免責・プライバシー導線の共通化
- [x] pnpm install & TypeScript型チェック通過
- [x] GitHub push 完了

## P1 実装完了（2026-03-18 完了）

- [x] オファー・LP設定のDB管理 ← 完了
- [x] 管理画面認証（NextAuth.js） ← 完了
- [x] 本番デプロイ設定（Cloudflare Pages + 外部PostgreSQL） ← 完了
- [x] PostgreSQL対応（本番DB） ← 完了
- [x] Claude API連携によるLP自動生成 ← 完了
- [x] SNS投稿自動化基盤 ← 完了
- [x] 複数ジャンル・複数アカウント対応 ← 完了

## P2 実装完了（2026-03-19 完了）

- [x] SNSアカウントのキャラクター管理システム ← 完了
  - 5テーマ×2媒体=10アカウント構成（転職・投資・家計改善・恋愛・野球）
  - キャラクター9項目（name/role/bio/tone/post_format/cta_style/forbidden_expressions/visual_direction/theme）
  - ChatGPT生成JSONを管理画面から一括インポート
  - 各アカウントに個別APIキーを設定可能
  - LP生成時にClaude APIがキャラの口調・禁止表現を考慮して投稿文を自動生成
- [x] SNSアカウント管理UI（テーマ別カード表示・JSONインポート・APIキー設定モーダル）
- [x] README.md を非エンジニア向け運用マニュアルに全面改訂

## P3 進行中（2026-03-21 着手）

- [x] オファー管理UI（管理画面から追加・削除） ← 完了
- [x] Cloudflare Workers デプロイ設定（`@opennextjs/cloudflare` + `wrangler.toml`） ← 完了
- [x] PostgreSQL クライアントを Edge 対応（`pg` → `@neondatabase/serverless`）← 完了
- [x] Neon PostgreSQL 作成（ap-southeast-1 / PostgreSQL 17） ← 2026-04-05 完了
- [x] Cloudflare Workers デプロイ実行（web / admin） ← 2026-04-05 完了
- [x] `open-next.config.ts` を @opennextjs/cloudflare v1.17 形式に更新 ← 2026-04-05 完了
- [x] LP生成機能のバグ修正・運用開始 ← 2026-04-09 完了
  - Claude APIプロンプトにJSON構造を厳密指定（レスポンスのキー名揺れ・ネスト対応）
  - 日本語タイトルのスラッグ生成修正（空スラッグ防止）
  - `lp_configs.config` NOT NULL制約エラー修正
  - エラー詳細をAPIレスポンスに含めるよう改善
- [x] LPテンプレートのデザイン大幅改善 ← 2026-04-09 完了
  - グラデーション背景・装飾要素・信頼バー・ステップセクション追加
  - カード型レイアウト・アイコンバッジ・番号付きリスト対応
  - アニメーション付きCTAボタン
- [x] LP生成結果のURL表示修正（localhost→本番URL） ← 2026-04-09 完了
  - クライアント側でwindow.locationからadmin→webのURL変換
  - `WEB_BASE_URL` 環境変数を `wrangler.toml` [vars] に設定
- [x] `ADMIN_PASSWORD` を本番用に変更 ← 2026-04-09 完了
- [x] 転職テーマのLP作成・本番公開 ← 2026-04-09 完了
- [ ] 残り4テーマ分のLP作成（投資・家計改善・恋愛・野球。アフィリエイトリンク取得後）
- [ ] X (Twitter) アカウント作成・Developer Portal申請（x1〜x5@gade.jp で申請予定）
- [ ] SNSアカウントのAPIキー登録（Developer Portal承認後）
- [ ] Instagram Graph API 対応（画像生成・ストレージ含む。x6〜x10@gade.jp を使用予定）

## バグ修正履歴（2026-03-18）

以下の不具合を修正済み。コードは現在ビルド・型チェック通過状態。

| 修正内容 | 影響ファイル |
|---------|-------------|
| `packages/shared` が `db`/`query` をエクスポートしていなかった | `shared/src/index.ts` |
| `apps/*/lib/db.ts` の re-export が `default` を誤参照 | web/admin/redirect の `lib/db.ts` |
| PostgreSQL では `?` でなく `$N` プレースホルダーが必要 | `shared/src/db.ts` |
| SQLite スキーマに `sns_accounts` テーブルが未定義 | `shared/src/db.ts` |
| `lp_configs` SQLite スキーマに `target_audience` 等カラム欠落 | `shared/src/db.ts` |
| `apps/admin/app/page.tsx` のクリックログテーブル JSX が欠損 | `admin/app/page.tsx` |
| サブページの `LogoutButton` import パスが1段ずれていた | generate-lp / sns-history / genres / sns-accounts |
| Twitter クライアントがモジュールレベルで初期化されビルド失敗 | `shared/src/sns.ts` |
| `datetime('now')` が SQLite 専用（PostgreSQL 非互換） | `sns.ts`, `generate-lp/route.ts` |
| `is_active = 1` が PostgreSQL 非互換 | sns-accounts API, generate-lp route |
| 認証情報がハードコード | `admin/app/auth.ts` |
| Claude モデルが旧バージョン（`claude-3-sonnet-20240229`） | `shared/src/claude.ts` |

## SNSキャラクター設計（2026-03-19 確定）

ChatGPTで設計済み。5テーマ×2媒体=10アカウント。

| テーマ | X (Twitter) | Instagram |
|-------|------------|-----------|
| 転職 | @career_scope_jp「キャリスコ編集部」論理的・比較重視 | @career_map_studio「キャリア地図案内人」初心者向け・カルーセル |
| 投資 | @asset_brief_jp「アセット速報室」冷静・要点主義 | @money_palette_lab「まねー図解ラボ」先生風・図解 |
| 家計改善 | @kakei_reset_note「家計リセット編集室」実務的・切れ味 | @kurashi_seiri_book「くらし整えノート」寄り添い型 |
| 恋愛 | @love_signal_edit「恋愛シグナル編集部」観察的・辛口 | @relation_compass_room「関係コンパス」共感的・落ち着き |
| 野球 | @baseball_point_jp「野球観戦ポイント室」熱量あり冷静 | @baseball_view_studio「やきゅう見方スタジオ」初心者向け |

- 禁止表現・CTAスタイル・投稿フォーマットはDB管理（JSONインポート済み）
- Instagram は現在未対応（Graph API対応はP3）

## デプロイ情報（2026-04-05 時点）

| アプリ | 本番URL |
|-------|---------|
| web | https://affiliate-web.yanagiho.workers.dev |
| admin | https://affiliate-admin.yanagiho.workers.dev |

- **Neon PostgreSQL**: ap-southeast-1（シンガポール）/ PostgreSQL 17 / プロジェクト名: AB_GADE
- **Cloudflare Workers**: affiliate-web / affiliate-admin
- **admin 環境変数（secret設定済み）**: `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_USERS`, `ANTHROPIC_API_KEY`
- **admin 環境変数（wrangler.toml [vars]）**: `WEB_BASE_URL`
- **web 環境変数（secret設定済み）**: `DATABASE_URL`

## 認証（2026-04-09 更新）

- 複数ユーザー対応済み（`ADMIN_USERS` 環境変数にJSON配列で管理）
- 旧形式（`ADMIN_USERNAME`/`ADMIN_PASSWORD`）にもフォールバック対応
- ログイン画面からデフォルト認証情報の表示を削除済み
- 本番パスワード変更済み（2026-04-09）: admin + hakamagi の2アカウント

## プロジェクト状態（2026-07-14 時点）

✅ **GitHub Actions cron ベースの全自動化パイプライン実装済み**
✅ **CLI/DBスキーマ/マイグレーション実装済み**（`pnpm migrate`, `pnpm cli`）
✅ **LP企画→LP生成→投稿キュー作成実装済み**（`pnpm pipeline:generate`）
✅ **ジャンル別ニュースコメント→投稿キュー作成実装済み**（`pnpm pipeline:news`）
✅ **投稿キュー→X投稿→失敗管理実装済み**（`pnpm pipeline:post`）
✅ **日次/週次Slackレポート実装済み**
✅ **X運用ガードレール実装済み**（1ジャンル1アカウント、1日3投稿上限、類似文面チェック、3連続失敗停止）
✅ **非エンジニア向け運用ステータス確認追加**（`pnpm ops:status`）
✅ **ローカルSQLiteのDBパス誤参照を修正**（ルート実行でも `data/clicks.db` を見る）
✅ **GitHub Actionsの空回り成功を防止**（CIでは `DATABASE_URL` なしの一時SQLite実行を拒否）
✅ **README / docs/operations.md を受託運用向けに更新**
✅ **LP生成費用ガード実装済み**（月曜週1回、稼働Xが3ジャンル未満なら停止、全体3本上限）
✅ **週次レポート根拠強化**（X稼働数・投稿成否・停止理由を掲載、改善提案のClaude API課金を廃止）
✅ **X障害通知強化**（安全なAPIエラー詳細を1回目からSlack通知、停止中アカウントも認証確認可能）

⚠️ **次に必要な作業（優先順）**
1. 停止中5アカウントのX APIエラー詳細を取得
2. HTTP 403のアプリ権限とGitHub Secretsの組み合わせを修正
3. 1アカウントずつ実投稿確認し、成功したものだけ有効化
4. 稼働Xが3ジャンル以上になったら、既存LP 89件への送客を再開
5. Instagram Graph API 対応（x6〜x10@gade.jp を使用予定）

## GitHub Actions 自動運用（2026-07-14 更新）

運用の詳細は `docs/operations.md` を参照。

| タスク | 頻度 | 状態 | 備考 |
|--------|------|------|------|
| LP企画・生成・投稿キュー作成 | 月曜 05:00 JST | 実装済み | 稼働X 3ジャンル以上、全体3本上限 / `pipeline-generate.yml` |
| ニュースコメントキュー作成 | 毎日 12:00 JST | 実装済み | `pipeline-news.yml` |
| X投稿 | 毎日 06:00 / 12:15 / 20:00 JST | 実装済み | `pipeline-post.yml` |
| 日次Slackレポート | 毎日 21:00 JST | 実装済み | `report-daily.yml` |
| 週次Slackレポート | 月曜 08:00 JST | 実装済み | X稼働状況を含む定型分析（Claude課金なし） / `report-weekly.yml` |
| DBマイグレーション | 手動 | 実装済み | `migrate.yml` |

## 非エンジニア運用方針（2026-06-21 追加）

- 受託者は基本的に Slack 通知と `pnpm ops:status` だけを見る
- 新規案件・APIキー・障害対応はCodexに自然文で依頼すればよい
- 自動化は規約違反を避けるため、ASP自動ログイン、Xスクレイピング、相互RT/リプライ等は実装しない
- クライアント報告は週次Slackレポートの生成LP数・投稿数・クリック数・改善提案を転記する

## SNS用メールアドレス（2026-04-09 確定）

- X (Twitter): x1@gade.jp 〜 x5@gade.jp（5テーマ分）
- Instagram: x6@gade.jp 〜 x10@gade.jp（将来用）

📚 **ドキュメント**
- README.md: 非エンジニア向け運用マニュアル
- CLAUDE.md: 技術仕様・実装状況（本ファイル）
- docs/architecture.md: アーキテクチャ設計
- docs/operations.md: GitHub Actions 自動運用ガイド
- SPEC_automation.md: 全自動化の正仕様
