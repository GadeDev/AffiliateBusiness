/**
 * Phase 4: daily summary. Runs 21:00 JST via CI.
 *
 *   LPs created today / posts (ok+fail) / clicks per LP / clicks per source -> Slack
 *
 * Click attribution (see apps/web/app/components/LPTemplate.tsx):
 *   utm_campaign = LP slug, utm_source = traffic source.
 *
 * Test hooks:
 *  - REPORT_NOW=<ISO>  override "now" (acceptance test #5)
 */
import { requireCiEnv } from './_env';
import { startRun, finishRun } from './_shared';
import { query, postSlack, jstDateString } from '@affiliate/shared';

function nowDate(): Date {
  return new Date(process.env.REPORT_NOW || new Date().toISOString());
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

async function main(): Promise<void> {
  requireCiEnv(['SLACK_WEBHOOK_URL'], 'report-daily');

  const runId = await startRun('report');
  const today = jstDateString(nowDate());

  try {
    const lps = (await query.all(`SELECT slug, title, created_at, genre FROM lp_configs`)) as any[];
    const lpsToday = lps.filter((r) => r.created_at && jstDateString(new Date(r.created_at)) === today);

    const posts = (await query.all(
      `SELECT status, scheduled_at FROM post_queue WHERE status IN ('posted','failed','skipped')`
    )) as any[];
    const postsToday = posts.filter((r) => r.scheduled_at && jstDateString(new Date(r.scheduled_at)) === today);
    const posted = postsToday.filter((r) => r.status === 'posted').length;
    const failed = postsToday.filter((r) => r.status === 'failed').length;
    const skipped = postsToday.filter((r) => r.status === 'skipped').length;

    const clicks = (await query.all(
      `SELECT clicked_at, utm_campaign, utm_source, offer_id FROM click_logs`
    )) as any[];
    const clicksToday = clicks.filter((r) => r.clicked_at && jstDateString(new Date(r.clicked_at)) === today);

    const byLp = new Map<string, number>();
    const bySource = new Map<string, number>();
    for (const c of clicksToday) {
      const lp = c.utm_campaign || '(unknown)';
      const src = c.utm_source || '(direct)';
      byLp.set(lp, (byLp.get(lp) ?? 0) + 1);
      bySource.set(src, (bySource.get(src) ?? 0) + 1);
    }

    const topLp = [...byLp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topSrc = [...bySource.entries()].sort((a, b) => b[1] - a[1]);

    const lines = [
      `📊 *日次サマリ ${today}（JST）*`,
      ``,
      `• 生成LP: *${fmt(lpsToday.length)}*件`,
      `• 投稿: 成功 *${fmt(posted)}* / 失敗 *${fmt(failed)}* / スキップ *${fmt(skipped)}*`,
      `• クリック: *${fmt(clicksToday.length)}*件`,
    ];
    if (topLp.length) {
      lines.push(``, `*LP別クリック*`);
      for (const [lp, n] of topLp) lines.push(`  - ${lp}: ${fmt(n)}`);
    }
    if (topSrc.length) {
      lines.push(``, `*流入元別クリック*`);
      for (const [src, n] of topSrc) lines.push(`  - ${src}: ${fmt(n)}`);
    }

    const text = lines.join('\n');
    await postSlack(text);

    const summary = {
      date: today,
      lps: lpsToday.length,
      posted,
      failed,
      skipped,
      clicks: clicksToday.length,
    };
    await finishRun(runId, 'success', summary);
    console.log('[report-daily]', JSON.stringify(summary));
  } catch (err) {
    await finishRun(runId, 'failed', { error: err instanceof Error ? err.message : String(err) });
    await postSlack(`🚨 日次レポート failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[report-daily] fatal:', err);
    process.exit(1);
  });
