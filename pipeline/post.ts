/**
 * Phase 3: multi-account posting scheduler. Runs 06:00 / 20:00 JST via CI.
 *
 *   pending posts due now -> enforce daily cap -> post to each genre's account
 *
 * Guardrails (SPEC §2.1):
 *  - daily_post_cap hard-capped at 3
 *  - 3 consecutive failures auto-disables the account (is_active=false) + Slack alert
 *  - 60–180s random gap between accounts to avoid bursty behavior
 *
 * Test hooks:
 *  - POST_NOW=<ISO>     override "now" (time mock; acceptance test #4)
 *  - POST_MOCK=success  simulate successful posts without calling Twitter
 *  - POST_MOCK=fail     simulate failures (acceptance test #7)
 *  - POST_NO_SLEEP=1    skip the inter-account delay (tests)
 */
import { requireCiEnv } from './_env';
import { isPg, startRun, finishRun } from './_shared';
import { query, postTweetText, postSlack, jstDateString, type SNSAccount } from '@affiliate/shared';

const DAILY_CAP_HARD_LIMIT = 3;
const FAILURE_DISABLE_THRESHOLD = 3;
const MOCK = process.env.POST_MOCK; // 'success' | 'fail' | undefined
const NO_SLEEP = !!process.env.POST_NO_SLEEP || !!MOCK;

interface QueueRow {
  id: number;
  lp_slug: string;
  sns_account_id: number;
  body: string;
  scheduled_at: string;
}

function bool(v: boolean): boolean | number {
  return isPg ? v : v ? 1 : 0;
}

function nowIso(): string {
  return process.env.POST_NOW || new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function postedTodayCount(accountId: number): Promise<number> {
  const today = jstDateString(new Date(nowIso()));
  const rows = (await query.all(
    `SELECT scheduled_at FROM post_queue WHERE sns_account_id = ? AND status = 'posted'`,
    [accountId]
  )) as any[];
  return rows.filter((r) => jstDateString(new Date(r.scheduled_at)) === today).length;
}

async function recordFailure(account: SNSAccount, error: string): Promise<void> {
  const next = (account.consecutive_failures ?? 0) + 1;
  const slug = account.slug ?? account.account_name;
  await query.run(`UPDATE sns_accounts SET consecutive_failures = ? WHERE id = ?`, [next, (account as any).id]);
  if (next >= FAILURE_DISABLE_THRESHOLD) {
    await query.run(`UPDATE sns_accounts SET is_active = ? WHERE id = ?`, [bool(false), (account as any).id]);
    await postSlack(
      `🚨 SNSアカウント自動停止: slug=${slug} が${FAILURE_DISABLE_THRESHOLD}回連続で投稿失敗したため停止しました。\n理由: ${error}`
    );
  } else {
    await postSlack(`⚠️ X投稿失敗: slug=${slug} (${next}/${FAILURE_DISABLE_THRESHOLD})\n理由: ${error}`);
  }
}

async function recordSuccess(account: SNSAccount): Promise<void> {
  if ((account.consecutive_failures ?? 0) !== 0) {
    await query.run(`UPDATE sns_accounts SET consecutive_failures = 0 WHERE id = ?`, [(account as any).id]);
  }
}

async function main(): Promise<void> {
  requireCiEnv(['SLACK_WEBHOOK_URL'], 'pipeline-post');

  const runId = await startRun('post');
  const summary = { due: 0, posted: 0, failed: 0, skipped: 0, accounts: 0 };

  try {
    const due = (await query.all(
      `SELECT id, lp_slug, sns_account_id, body, scheduled_at
       FROM post_queue
       WHERE status = 'pending' AND scheduled_at <= ?
       ORDER BY sns_account_id, scheduled_at`,
      [nowIso()]
    )) as QueueRow[];
    summary.due = due.length;

    // Group by account.
    const byAccount = new Map<number, QueueRow[]>();
    for (const row of due) {
      if (!byAccount.has(row.sns_account_id)) byAccount.set(row.sns_account_id, []);
      byAccount.get(row.sns_account_id)!.push(row);
    }

    let firstAccount = true;
    for (const [accountId, rows] of byAccount) {
      const account = (await query.get(`SELECT * FROM sns_accounts WHERE id = ?`, [accountId])) as SNSAccount | null;
      if (!account) {
        for (const r of rows) {
          await query.run(`UPDATE post_queue SET status = 'skipped', error = ? WHERE id = ?`, ['account missing', r.id]);
          summary.skipped++;
        }
        continue;
      }
      const active = account.is_active === true || account.is_active === 1;
      if (!active) {
        for (const r of rows) {
          await query.run(`UPDATE post_queue SET status = 'skipped', error = ? WHERE id = ?`, ['account inactive', r.id]);
          summary.skipped++;
        }
        continue;
      }

      // Inter-account delay to avoid coordinated bursts.
      if (!firstAccount && !NO_SLEEP) {
        await sleep((60 + Math.floor(Math.random() * 121)) * 1000);
      }
      firstAccount = false;
      summary.accounts++;

      const cap = Math.min(account.daily_post_cap ?? 2, DAILY_CAP_HARD_LIMIT);
      let postedToday = await postedTodayCount(accountId);

      for (const r of rows) {
        if (postedToday >= cap) {
          await query.run(`UPDATE post_queue SET status = 'skipped', error = ? WHERE id = ?`, [
            `daily cap ${cap} reached`,
            r.id,
          ]);
          summary.skipped++;
          continue;
        }

        let result;
        if (MOCK === 'success') {
          result = { success: true, postId: `mock-${r.id}`, postText: r.body };
        } else if (MOCK === 'fail') {
          result = { success: false, error: 'mock failure' };
        } else {
          result = await postTweetText(account, r.body);
        }

        if (result.success) {
          await query.run(`UPDATE post_queue SET status = 'posted', posted_tweet_id = ?, error = NULL WHERE id = ?`, [
            (result as any).postId ?? null,
            r.id,
          ]);
          await recordSuccess(account);
          postedToday++;
          summary.posted++;
          console.log(`[post] account #${accountId} posted queue #${r.id} (tweet ${(result as any).postId})`);
        } else {
          await query.run(`UPDATE post_queue SET status = 'failed', error = ? WHERE id = ?`, [
            (result as any).error ?? 'unknown',
            r.id,
          ]);
          const error = (result as any).error ?? 'unknown';
          await recordFailure(account, error);
          // refresh account counters for subsequent rows
          account.consecutive_failures = (account.consecutive_failures ?? 0) + 1;
          summary.failed++;
          console.error(`[post] account #${accountId} FAILED queue #${r.id}: ${(result as any).error}`);
        }
      }
    }

    await finishRun(runId, summary.failed > 0 ? 'partial' : 'success', summary);
    console.log('[post] summary:', JSON.stringify(summary));
  } catch (err) {
    await finishRun(runId, 'failed', { error: err instanceof Error ? err.message : String(err), summary });
    await postSlack(`🚨 投稿パイプライン failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[post] fatal:', err);
    process.exit(1);
  });
