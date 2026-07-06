/**
 * Operator-friendly status check.
 *
 * This command does not mutate data. It summarizes the pieces a non-engineer
 * needs to know before trusting the automated operation.
 */
import '../pipeline/_env';
import { query, jstDateString } from '@affiliate/shared';

type Row = Record<string, any>;

function on(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function n(value: unknown): number {
  return Number(value ?? 0);
}

function ok(label: string): string {
  return `OK   ${label}`;
}

function warn(label: string): string {
  return `WARN ${label}`;
}

function miss(label: string): string {
  return `NG   ${label}`;
}

function hasEnv(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  const placeholders = ['ここに', 'your-', 'replace-with', '...', 'your-web-domain', 'hooks.slack.com/services/...'];
  return !placeholders.some((placeholder) => value.includes(placeholder));
}

function twitterEnvPrefix(slug: string): string {
  return `TW_${slug.toUpperCase()}`;
}

async function count(table: string): Promise<number> {
  const row = (await query.get(`SELECT COUNT(*) AS c FROM ${table}`)) as Row;
  return n(row?.c);
}

async function main(): Promise<void> {
  const today = jstDateString();
  const now = new Date().toISOString();

  const [genres, offers, accounts, queue, runs] = await Promise.all([
    query.all(`SELECT slug, name, is_active FROM genres ORDER BY slug`) as Promise<Row[]>,
    query.all(`SELECT id, name, genre_slug, is_active FROM offers ORDER BY genre_slug, id`) as Promise<Row[]>,
    query.all(
      `SELECT id, slug, platform, genre_slug, daily_post_cap, consecutive_failures, is_active
       FROM sns_accounts ORDER BY genre_slug, id`
    ) as Promise<Row[]>,
    query.all(
      `SELECT id, status, scheduled_at, sns_account_id, lp_slug, error
       FROM post_queue ORDER BY scheduled_at DESC, id DESC LIMIT 50`
    ) as Promise<Row[]>,
    query.all(
      `SELECT id, kind, started_at, finished_at, status, detail
       FROM pipeline_runs ORDER BY id DESC LIMIT 8`
    ) as Promise<Row[]>,
  ]);

  const activeGenres = genres.filter((g) => on(g.is_active));
  const activeOffers = offers.filter((o) => on(o.is_active));
  const activeAccounts = accounts.filter((a) => on(a.is_active));
  const inactiveAccounts = accounts.filter((a) => !on(a.is_active));
  const pending = queue.filter((q) => q.status === 'pending');
  const duePending = pending.filter((q) => String(q.scheduled_at) <= now);
  const failedQueue = queue.filter((q) => q.status === 'failed');
  const todayRuns = runs.filter((r) => r.started_at && jstDateString(new Date(r.started_at)) === today);

  const issues: string[] = [];
  const checks: string[] = [];

  checks.push(hasEnv('DATABASE_URL') ? ok('本番DB DATABASE_URL が環境変数にあります') : warn('DATABASE_URL なし。ローカルSQLiteを見ています'));
  checks.push(hasEnv('ANTHROPIC_API_KEY') ? ok('Claude APIキーあり') : miss('ANTHROPIC_API_KEY 未設定。LP自動生成は動きません'));
  checks.push(hasEnv('SLACK_WEBHOOK_URL') ? ok('Slack通知あり') : warn('SLACK_WEBHOOK_URL 未設定。異常通知はコンソール出力のみです'));
  checks.push(hasEnv('WEB_BASE_URL') || hasEnv('NEXT_PUBLIC_BASE_URL') ? ok('LP公開URLあり') : warn('WEB_BASE_URL 未設定。デフォルトworkers.devを使います'));

  if (!hasEnv('ANTHROPIC_API_KEY')) issues.push('GitHub Secrets に ANTHROPIC_API_KEY を登録する');
  if (!hasEnv('SLACK_WEBHOOK_URL')) issues.push('GitHub Secrets に SLACK_WEBHOOK_URL を登録する');

  for (const genre of activeGenres) {
    const genreOffers = activeOffers.filter((o) => o.genre_slug === genre.slug);
    const genreAccounts = activeAccounts.filter((a) => a.genre_slug === genre.slug);
    if (genreOffers.length === 0) issues.push(`${genre.name} (${genre.slug}) の有効オファーを登録する`);
    if (genreAccounts.length === 0) issues.push(`${genre.name} (${genre.slug}) の有効Xアカウントを登録/有効化する`);
  }

  for (const account of activeAccounts) {
    const slug = String(account.slug || '');
    if (!slug) {
      issues.push(`SNSアカウント #${account.id} にslugを設定する`);
      continue;
    }
    const prefix = twitterEnvPrefix(slug);
    const missingKeys = ['API_KEY', 'API_SECRET', 'ACCESS_TOKEN', 'ACCESS_SECRET'].filter(
      (suffix) => !hasEnv(`${prefix}_${suffix}`)
    );
    if (account.platform === 'twitter' && missingKeys.length > 0) {
      issues.push(`${slug} のX APIキーをGitHub Secretsに登録する (${prefix}_*)`);
    }
  }

  for (const account of inactiveAccounts) {
    if (n(account.consecutive_failures) >= 3) {
      issues.push(`${account.slug ?? `account#${account.id}`} が3連続失敗で停止中。APIキー確認後に account:enable する`);
    }
  }

  if (duePending.length > 0) issues.push(`期限超過の投稿キューが ${duePending.length} 件あります。pipeline:post を確認する`);
  if (failedQueue.length > 0) issues.push(`失敗投稿が直近 ${failedQueue.length} 件あります。X API権限・キーを確認する`);

  console.log(`AffiliateBusiness 運用ステータス (${today} JST)`);
  console.log('');
  console.log('基本チェック');
  for (const line of checks) console.log(`- ${line}`);

  console.log('');
  console.log('データ件数');
  console.log(`- genres: ${await count('genres')} / offers: ${await count('offers')} / LP: ${await count('lp_configs')}`);
  console.log(`- SNS accounts: ${await count('sns_accounts')} / queue: ${await count('post_queue')} / news: ${await count('news_items')} / clicks: ${await count('click_logs')}`);

  console.log('');
  console.log('ジャンル別の運用準備');
  for (const genre of activeGenres) {
    const genreOffers = activeOffers.filter((o) => o.genre_slug === genre.slug).length;
    const genreAccounts = activeAccounts.filter((a) => a.genre_slug === genre.slug).length;
    const state = genreOffers > 0 && genreAccounts > 0 ? 'OK' : 'NG';
    console.log(`- ${state} ${genre.name} (${genre.slug}): offers=${genreOffers}, active_accounts=${genreAccounts}`);
  }

  console.log('');
  console.log('投稿キュー');
  const byStatus = new Map<string, number>();
  for (const row of queue) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  if (byStatus.size === 0) {
    console.log('- queueなし');
  } else {
    for (const [status, total] of [...byStatus.entries()].sort()) console.log(`- ${status}: ${total}`);
  }
  if (duePending.length > 0) console.log(`- 期限超過pending: ${duePending.length}`);

  console.log('');
  console.log('直近の自動実行');
  if (runs.length === 0) {
    console.log('- 実行履歴なし');
  } else {
    for (const run of runs.slice(0, 5)) {
      console.log(`- #${run.id} ${run.kind} ${run.status} started=${run.started_at ?? '-'} finished=${run.finished_at ?? '-'}`);
    }
  }
  if (todayRuns.length === 0) console.log('- 今日の実行履歴はまだありません');

  console.log('');
  if (issues.length === 0) {
    console.log('次の対応: なし。自動運用を継続できます。');
  } else {
    console.log('次の対応');
    for (const item of [...new Set(issues)]) console.log(`- ${item}`);
  }
}

main().catch((err) => {
  console.error('[ops-status] failed:', err);
  process.exit(1);
});
