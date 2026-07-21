/**
 * Phase 4: weekly analysis. Runs Mon 08:00 JST via CI.
 *
 *   last 7d vs prior 7d + X delivery health -> deterministic proposals -> Slack
 *
 * Test hooks:
 *  - REPORT_NOW=<ISO>  override "now"
 */
import { requireCiEnv } from './_env';
import { startRun, finishRun } from './_shared';
import { query, postSlack } from '@affiliate/shared';
import { buildWeeklyProposals } from './report-weekly-policy';

function nowDate(): Date {
  return new Date(process.env.REPORT_NOW || new Date().toISOString());
}

/** JST hour (0-23) of an ISO timestamp. */
function jstHour(iso: string): number {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).getUTCHours();
}

function windowFilter(rows: any[], field: string, fromMs: number, toMs: number): any[] {
  return rows.filter((r) => {
    const v = r[field];
    if (!v) return false;
    const t = new Date(v).getTime();
    return t >= fromMs && t < toMs;
  });
}

function on(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function main(): Promise<void> {
  requireCiEnv(['SLACK_WEBHOOK_URL'], 'report-weekly');

  const runId = await startRun('report');
  const now = nowDate();
  const day = 86400_000;
  const thisFrom = now.getTime() - 7 * day;
  const prevFrom = now.getTime() - 14 * day;

  try {
    const [clicks, lps, accounts, queue] = (await Promise.all([
      query.all(`SELECT clicked_at, utm_campaign, utm_source FROM click_logs`),
      query.all(`SELECT slug, title, genre FROM lp_configs`),
      query.all(
        `SELECT id, slug, platform, consecutive_failures, is_active
         FROM sns_accounts ORDER BY id`
      ),
      query.all(
        `SELECT id, sns_account_id, status, scheduled_at, error
         FROM post_queue ORDER BY scheduled_at DESC, id DESC`
      ),
    ])) as [any[], any[], any[], any[]];
    const genreBySlug = new Map(lps.map((l) => [l.slug, l.genre]));

    const thisWk = windowFilter(clicks, 'clicked_at', thisFrom, now.getTime());
    const prevWk = windowFilter(clicks, 'clicked_at', prevFrom, thisFrom);

    const byLp = new Map<string, number>();
    const byGenre = new Map<string, number>();
    const byHour = new Map<number, number>();
    for (const c of thisWk) {
      const lp = c.utm_campaign || '(unknown)';
      byLp.set(lp, (byLp.get(lp) ?? 0) + 1);
      const g = genreBySlug.get(lp) || '(unknown)';
      byGenre.set(g, (byGenre.get(g) ?? 0) + 1);
      const h = jstHour(c.clicked_at);
      byHour.set(h, (byHour.get(h) ?? 0) + 1);
    }

    const topLp = [...byLp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topGenre = [...byGenre.entries()].sort((a, b) => b[1] - a[1]);
    const topHour = [...byHour.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const wow = prevWk.length === 0 ? null : ((thisWk.length - prevWk.length) / prevWk.length) * 100;
    const xAccounts = accounts.filter((account) => account.platform === 'twitter' && account.slug);
    const activeAccounts = xAccounts.filter((account) => on(account.is_active));
    const stoppedAccounts = xAccounts.filter(
      (account) => !on(account.is_active) && Number(account.consecutive_failures ?? 0) >= 3
    );
    const thisWeekQueue = windowFilter(queue, 'scheduled_at', thisFrom, now.getTime());
    const postedThisWeek = thisWeekQueue.filter((row) => row.status === 'posted').length;
    const failedThisWeek = thisWeekQueue.filter((row) => row.status === 'failed').length;
    const latestErrorByAccount = new Map<number, string>();
    for (const row of queue) {
      if (row.status === 'failed' && row.error && !latestErrorByAccount.has(row.sns_account_id)) {
        latestErrorByAccount.set(row.sns_account_id, String(row.error).slice(0, 300));
      }
    }

    const statsLines = [
      `• 今週クリック: *${thisWk.length}* / 前週: ${prevWk.length}` +
        (wow === null ? '' : ` (${wow >= 0 ? '+' : ''}${wow.toFixed(0)}%)`),
      ``,
      `*クリック上位LP*`,
      ...(topLp.length ? topLp.map(([lp, n]) => `  - ${lp}: ${n}`) : ['  (なし)']),
      ``,
      `*ジャンル別*`,
      ...(topGenre.length ? topGenre.map(([g, n]) => `  - ${g}: ${n}`) : ['  (なし)']),
      ``,
      `*時間帯別（JST, 上位）*`,
      ...(topHour.length ? topHour.map(([h, n]) => `  - ${String(h).padStart(2, '0')}:00台: ${n}`) : ['  (なし)']),
      ``,
      `*X送客状況*`,
      `  - 稼働中アカウント: ${activeAccounts.length}/${xAccounts.length}`,
      `  - 今週の投稿: 成功 ${postedThisWeek} / 失敗 ${failedThisWeek}`,
      ...(stoppedAccounts.length
        ? [`  - 自動停止: ${stoppedAccounts.map((account) => account.slug).join(', ')}`]
        : ['  - 自動停止: なし']),
      ...stoppedAccounts
        .map((account) => {
          const error = latestErrorByAccount.get(account.id);
          return error ? `  - 最新エラー ${account.slug}: ${error}` : null;
        })
        .filter((line): line is string => !!line),
    ];

    const proposals = buildWeeklyProposals({
      activeAccounts: activeAccounts.length,
      totalAccounts: xAccounts.length,
      stoppedSlugs: stoppedAccounts.map((account) => account.slug),
      postedThisWeek,
      failedThisWeek,
      thisWeekClicks: thisWk.length,
      prevWeekClicks: prevWk.length,
      lpCount: lps.length,
    })
      .map((proposal, index) => `${index + 1}. ${proposal}`)
      .join('\n');

    const text = ['📈 *週次分析レポート（JST）*', '', ...statsLines, '', '*来週の改善提案*', proposals].join('\n');
    await postSlack(text);

    const summary = {
      thisWeekClicks: thisWk.length,
      prevWeekClicks: prevWk.length,
      topLp,
      topGenre,
      xAccounts: { active: activeAccounts.length, total: xAccounts.length, stopped: stoppedAccounts.length },
      posts: { posted: postedThisWeek, failed: failedThisWeek },
    };
    await finishRun(runId, 'success', summary);
    console.log('[report-weekly]', JSON.stringify(summary));
  } catch (err) {
    await finishRun(runId, 'failed', { error: err instanceof Error ? err.message : String(err) });
    await postSlack(`🚨 週次レポート failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[report-weekly] fatal:', err);
    process.exit(1);
  });
