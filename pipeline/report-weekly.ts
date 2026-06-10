/**
 * Phase 4: weekly analysis. Runs Mon 08:00 JST via CI.
 *
 *   last 7d vs prior 7d (top LPs / genre / hour / post pattern) -> Claude proposals -> Slack
 *
 * Test hooks:
 *  - REPORT_NOW=<ISO>  override "now"
 *  - REPORT_MOCK=1     skip Claude (deterministic fake proposals)
 */
import './_env';
import { startRun, finishRun } from './_shared';
import { query, postSlack, generateText, jstDateString } from '@affiliate/shared';

const MOCK = !!process.env.REPORT_MOCK;

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

async function main(): Promise<void> {
  const runId = await startRun('report');
  const now = nowDate();
  const day = 86400_000;
  const thisFrom = now.getTime() - 7 * day;
  const prevFrom = now.getTime() - 14 * day;

  try {
    const clicks = (await query.all(
      `SELECT clicked_at, utm_campaign, utm_source FROM click_logs`
    )) as any[];
    const lps = (await query.all(`SELECT slug, title, genre FROM lp_configs`)) as any[];
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
    ];

    let proposals: string;
    if (MOCK) {
      proposals = '1. (mock) 上位ジャンルへ予算集中\n2. (mock) 投稿時間を上位時間帯に寄せる\n3. (mock) 低クリックLPの文面を刷新';
    } else {
      const prompt =
        `あなたはアフィリエイト運用アナリストです。以下の週次集計を読み、来週の改善提案を3〜5項目、` +
        `日本語の箇条書き（番号付き、各1行）で出力してください。前置き・後置きは不要、提案のみ。\n\n` +
        statsLines.join('\n');
      proposals = (await generateText(prompt)).trim();
    }

    const text = ['📈 *週次分析レポート（JST）*', '', ...statsLines, '', '*来週の改善提案*', proposals].join('\n');
    await postSlack(text);

    const summary = {
      thisWeekClicks: thisWk.length,
      prevWeekClicks: prevWk.length,
      topLp,
      topGenre,
      mock: MOCK,
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
