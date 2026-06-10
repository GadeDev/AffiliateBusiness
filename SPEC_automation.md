# AffiliateBusiness 全自動化 実装仕様書

> 対象リポジトリ: `github.com/yanagiho/AffiliateBusiness`
> 本書は Claude Code に渡して実装させるための仕様書。フェーズ順に実装し、各フェーズの受け入れ条件を満たしてから次へ進むこと。
> 楽天連携は本仕様の対象外（Phase 5 として将来追加。本書ではインターフェースだけ予約）。

---

## 0. ゴール

現状「人が管理画面で1件ずつLPを作り、投稿する」運用を、**人の日次作業ゼロ**にする。

毎日の自動フロー:

```
[GitHub Actions cron]
 ├ 05:00 JST  ジャンル別にLP企画を自動立案（Claude API）
 ├ 05:10      LP本文生成 → DB登録 → Cloudflare Workers へ自動デプロイ
 ├ 06:00 /20:00  各ジャンル専属Xアカウントから固有文面で自動投稿
 ├ 21:00      日次サマリ（生成LP数 / 投稿数 / クリック数）を Slack 通知
 └ 月曜 08:00  週次分析レポート（伸びたLP / 構文 / 時間帯 + 改善提案）を Slack 通知
```

人の作業: Slack を眺める。異常通知が来たときだけ対応。

---

## 1. 現状（前提）— リポジトリ実地確認済み 2026-06-10

- モノレポ: pnpm + Turborepo / Next.js 15 (App Router) / TypeScript 5
- `apps/` 配下: LPサイト(localhost:3000) + 管理画面(localhost:3001)。**いずれもローカル起動前提で本番未デプロイ**
- `services/redirect`: Cloudflare Workers（デプロイ済: `affiliate-web.yanagiho.workers.dev`）。クリックリダイレクトのみ
- DB: ローカル SQLite (`data/clicks.db`)。本番 PostgreSQL は「想定」のみで未構築
- LP生成: 管理画面フォーム → Claude API (claude-sonnet-4-6)
- X投稿: LP生成時に同時実行（Twitter API v2、env は `TWITTER_*` の1アカウント分のみ）
- 未実装: オファー管理UI、SNSアカウント追加UI（DB直接操作が必要）
- リポジトリ直下に `CLAUDE.md` あり → 本仕様書実装開始時に `CLAUDE.md` から `SPEC_automation.md` への参照を追記すること

---

## Phase 0: 本番ホスティング（最優先・これがないと全自動化は成立しない）

現状LPは localhost でしか配信されておらず、PCを閉じると誰もアクセスできない。以下を実装:

1. **LPサイト (`apps/` のLP側) を Cloudflare Workers へデプロイ**
   - `@opennextjs/cloudflare` を使用して Next.js を Workers 上で動かす（もしくは LP配信部分だけ軽量Workerに切り出してもよい。実装コストが低い方を選択）
   - 独自ドメインは任意。当面 `*.workers.dev` でよい
2. **DBを Cloudflare D1 へ移行**（LPサイト・redirect Worker・GitHub Actions の三者から接続できることが選定理由。Neon PostgreSQL でも可）
   - 既存 `data/clicks.db` のスキーマ＋データを移行するスクリプトを `scripts/migrate/` に作成
   - ローカル開発は `wrangler d1 --local` で継続
3. **管理画面は当面ローカル運用のまま**（自動化後は管理画面を開く頻度が激減するため、本番化はスコープ外。ただし接続先DBはD1に統一）
4. redirect Worker のクリック書き込み先も D1 に統一

受け入れ条件: PCを閉じた状態で、外部からLPが閲覧でき、クリックがD1に記録される。

---

## 2. 重要な制約（実装時に必ず守る）

### 2.1 X（Twitter）運用ガードレール
これらは仕様であり、緩和するオプションを作らないこと。

1. **1アカウント = 1ジャンル専属**。アカウントとジャンルは `sns_accounts.genre` で1対1に固定する
2. **同一・類似文面の複数アカウント投稿を禁止**。投稿前に直近30日の全アカウント投稿文と比較し、類似度が高い場合（後述）は再生成する
3. 投稿頻度上限: **1アカウントあたり1日3投稿まで**（デフォルト2）。設定値の上限をコードでハードキャップする
4. アカウント間の相互RT・相互リプライ・相互フォロー機能は実装しない
5. 投稿失敗が同一アカウントで3回連続したら、そのアカウントを自動停止（`is_active=false`）して Slack へ通知
6. 全投稿は公式 Twitter API v2 経由のみ。スクレイピング・非公式エンドポイントは使用禁止

> 背景: Xの規約は複数アカウントによる重複投稿・協調的な増幅を禁止している。違反するとアカウント凍結だけでなくアフィリ収益の土台ごと失う。受託案件のため、規約準拠は機能要件と同格。

### 2.2 シークレット管理
- すべて GitHub Actions Secrets / Cloudflare Secrets で管理。リポジトリ・DBに平文で置かない
- Xの5アカウント分キーは `TW_<ACCOUNT_SLUG>_API_KEY` 形式で命名（後述 §7）

---

## 3. フェーズ構成（実装順）

| Phase | 内容 | 成果物 |
|---|---|---|
| 0 | 本番ホスティング（LPサイトWorkers化 + D1移行） | 常時公開されるLPサイト + 本番DB |
| 1 | 運用基盤: CLI化 + オファー/アカウント管理 | `scripts/` 配下のCLIコマンド群 |
| 2 | バッチ生成パイプライン | `pipeline/generate.ts`（企画→生成→デプロイ） |
| 3 | マルチアカウント投稿スケジューラ | `pipeline/post.ts` + 投稿キュー |
| 4 | 計測・レポート | 日次サマリ / 週次分析 Slack 通知 |
| 5 | （予約）楽天API連携 | 本書では未実装。`OfferSource` 抽象だけ用意 |

---

## Phase 1: 運用基盤

### 1-1. DBスキーマ拡張

既存スキーマに以下を追加（マイグレーションスクリプトを `scripts/migrate/` に作成。SQLite/PostgreSQL 両対応）:

```sql
-- ジャンルマスタ（5ジャンル）
CREATE TABLE genres (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,        -- 例: business, beauty, gadget, lifestyle, learning
  name TEXT NOT NULL,
  tone_prompt TEXT NOT NULL,        -- このジャンルの文体指示（Claude へ渡す）
  is_active BOOLEAN DEFAULT 1
);

-- sns_accounts に列追加
ALTER TABLE sns_accounts ADD COLUMN genre_slug TEXT REFERENCES genres(slug);
ALTER TABLE sns_accounts ADD COLUMN daily_post_cap INTEGER DEFAULT 2;  -- ハードキャップ3
ALTER TABLE sns_accounts ADD COLUMN consecutive_failures INTEGER DEFAULT 0;
ALTER TABLE sns_accounts ADD COLUMN is_active BOOLEAN DEFAULT 1;

-- offers に列追加
ALTER TABLE offers ADD COLUMN genre_slug TEXT REFERENCES genres(slug);
ALTER TABLE offers ADD COLUMN source TEXT DEFAULT 'a8';   -- 将来 'rakuten' を追加
ALTER TABLE offers ADD COLUMN priority INTEGER DEFAULT 0; -- 企画立案時の重み

-- 投稿キュー
CREATE TABLE post_queue (
  id INTEGER PRIMARY KEY,
  lp_id INTEGER NOT NULL REFERENCES lps(id),
  sns_account_id INTEGER NOT NULL REFERENCES sns_accounts(id),
  body TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,       -- ISO 8601
  status TEXT DEFAULT 'pending',    -- pending / posted / failed / skipped
  posted_tweet_id TEXT,
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 生成ジョブ履歴（冪等性・監査用）
CREATE TABLE pipeline_runs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,               -- generate / post / report
  started_at TEXT, finished_at TEXT,
  status TEXT,                      -- success / partial / failed
  detail TEXT                       -- JSON
);
```

### 1-2. 管理CLI（管理UIの代替。UIは作らない＝工数削減）

`scripts/cli.ts` を作り、`pnpm cli <command>` で実行:

- `offer:add --name --url --genre --source a8` / `offer:list` / `offer:disable <id>`
- `account:add --slug --genre --daily-cap 2`（APIキーはenv参照、DBには slug のみ）
- `account:list` / `account:enable <id>` / `account:disable <id>`
- `genre:seed`（5ジャンルの初期データ投入。tone_prompt 込み）

受け入れ条件: README記載の「UI未実装でDB直接操作が必要」だった操作がすべてCLIで完結する。

---

## Phase 2: バッチ生成パイプライン

### 2-1. `pipeline/generate.ts`

1日1回実行。処理:

1. **企画立案**: ジャンルごとに、アクティブなオファー一覧 + 過去30日のLPタイトル一覧を Claude に渡し、「既存と重複しない新規LP企画を N 件（デフォルト各ジャンル1件）」JSON で出力させる
   - 出力スキーマ: `{ title, description, target, keywords[], offer_id }`
   - System prompt で「JSONのみ返す」ことを強制し、`JSON.parse` 失敗時は1回だけリトライ
2. **LP生成**: 既存のLP生成ロジックを関数として切り出し（`lib/lp-generator.ts`）、企画JSONを入力に本文生成 → DB登録
3. **デプロイ**: LPは DB/Workers KV から動的配信されている前提を確認し、静的ビルドが必要な構成なら `wrangler deploy` を Actions 内で実行
4. **投稿文生成**: LPごとに、担当ジャンルのアカウント向け投稿文を **朝用・夜用の2パターン**生成し `post_queue` に積む（scheduled_at = 当日06:00 / 20:00 JST）
   - 類似度チェック: 投稿文と直近30日の `post_queue.body` 全件を比較。簡易実装として trigram 一致率 > 0.6 で再生成（最大2回、ダメなら skipped）
5. `pipeline_runs` に記録。失敗時は Slack 通知

冪等性: 同日2回実行されても重複生成しないこと（当日分の pipeline_runs を確認してスキップ）。

### 2-2. 既存フォーム生成との共存

管理画面の手動生成機能は残す（共通の `lib/lp-generator.ts` を呼ぶだけにリファクタ）。

受け入れ条件: `pnpm pipeline:generate` 1コマンドで「5ジャンル分のLPが生成・公開され、投稿キューに10件（5ジャンル×2）積まれる」。

---

## Phase 3: 投稿スケジューラ

### 3-1. `pipeline/post.ts`

06:00 / 20:00 JST に実行。処理:

1. `post_queue` から `status=pending AND scheduled_at <= now` を取得
2. アカウントごとに当日投稿数を集計し、`daily_post_cap`（最大3）を超える分は `skipped`
3. Twitter API v2 で投稿。アカウントごとのキーは env から `TW_<SLUG>_*` を解決
4. 成功: `posted` + tweet_id 記録、`consecutive_failures=0`
5. 失敗: `failed` + error 記録、`consecutive_failures++`。3到達でアカウント `is_active=false` + Slack 緊急通知
6. レート配慮: アカウント間の投稿は60〜180秒のランダム間隔を空ける

### 3-2. 既存「LP生成時に即投稿」の扱い

即投稿は廃止し、すべてキュー経由に統一（投稿履歴・失敗管理を一元化するため）。

受け入れ条件: キューに積まれた投稿が時刻どおりに各専属アカウントから投稿され、SNS履歴画面（既存）で確認できる。

---

## Phase 4: 計測・レポート

### 4-1. 日次サマリ（21:00 JST）

`pipeline/report-daily.ts`:
- 当日の 生成LP数 / 投稿数(成功・失敗) / LP別クリック数 / 流入元別クリック数 を集計
- Slack Incoming Webhook へ整形投稿

### 4-2. 週次分析（月曜 08:00 JST）

`pipeline/report-weekly.ts`:
- 過去7日と前週の比較: クリック上位LP、ジャンル別、時間帯別、投稿文パターン別（post_queue と clicks を tweet_id / lp_id で結合）
- 集計結果を Claude に渡し、「来週の改善提案」を3〜5項目生成
- Slack へ投稿（数値テーブル + 提案）

受け入れ条件: ダミーデータ投入スクリプト（`scripts/seed-demo.ts`）で動作確認できること。

---

## GitHub Actions ワークフロー

`.github/workflows/` に以下を作成。タイムゾーンは UTC 指定なので JST−9h で書くこと:

```yaml
# pipeline-generate.yml  … cron: '0 20 * * *'   (05:00 JST)
# pipeline-post.yml      … cron: '0 21 * * *' と '0 11 * * *' (06:00 / 20:00 JST)
# report-daily.yml       … cron: '0 12 * * *'   (21:00 JST)
# report-weekly.yml      … cron: '0 23 * * 0'   (月曜 08:00 JST)
```

共通要件:
- `workflow_dispatch` を必ず付ける（手動再実行用）
- ジョブ失敗時は Slack へ通知（`if: failure()`）
- DB接続は Phase 0 で構築した D1（`wrangler d1 execute` / REST API 経由）または Neon の `DATABASE_URL` を Secrets から注入する

---

## 環境変数 / Secrets 一覧

```
ANTHROPIC_API_KEY
DATABASE_URL                     # Neon等のPostgreSQL接続文字列（推奨）
CLOUDFLARE_API_TOKEN             # wrangler deploy 用
SLACK_WEBHOOK_URL

# Xアカウント（5組）。<SLUG> は sns_accounts.slug と一致させる
TW_<SLUG>_API_KEY
TW_<SLUG>_API_SECRET
TW_<SLUG>_ACCESS_TOKEN
TW_<SLUG>_ACCESS_SECRET
```

---

## 実装しないこと（明示的スコープ外）

- 楽天ROOM・楽天アフィリ管理画面への自動アクセス（規約違反のため）
- A8.net 提携申請・リンク取得の自動化（同上。オファー登録は CLI 手動）
- アカウント間の相互エンゲージメント機能
- 投稿文の同報（同一文面の複数アカウント投稿）

---

## Phase 5（予約）: 楽天連携インターフェース

`offers.source = 'rakuten'` と、`lib/offer-sources/` に `OfferSource` インターフェースだけ定義しておく:

```ts
interface OfferSource {
  slug: string;                          // 'a8' | 'rakuten'
  fetchCandidates?(genre: string): Promise<OfferCandidate[]>; // 楽天APIで実装予定
}
```

楽天ウェブサービスAPI（ランキング/商品検索）連携は別仕様書で定義する。

---

## 受け入れテスト（全体）

1. クリーンな環境で `pnpm install && pnpm cli genre:seed` → 5ジャンル投入
2. オファー5件・アカウント5件を CLI 登録
3. `pnpm pipeline:generate` → LP5件公開 + キュー10件
4. `pnpm pipeline:post`（時刻モックで実行）→ 各アカウント1投稿
5. クリックを数件発生させ `pnpm pipeline:report-daily` → Slack にサマリ着信
6. 同一文面を意図的にキューへ2件入れた場合、2件目が skipped になる
7. 投稿失敗を3回モックすると該当アカウントが自動停止し Slack 通知が来る
