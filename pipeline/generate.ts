/**
 * Phase 2: batch generation pipeline. Runs once a day (05:00 JST via CI).
 *
 *   plan (Claude) -> generate LP (Claude) -> save -> queue morning/evening posts
 *
 * Idempotent: if a successful `generate` run already happened today (JST), it exits.
 * Set PIPELINE_MOCK=1 to skip all Claude/network calls (deterministic fake content)
 * for offline testing of the DB/queue/similarity/idempotency flow.
 *
 * Deploy note: LPs are served dynamically from the DB by apps/web (/lp/[slug]), so
 * no static rebuild/redeploy is needed after generation. The Worker reads new rows
 * immediately.
 */
import './_env';
import { isPg, WEB_BASE_URL, hasSucceededToday, startRun, finishRun } from './_shared';
import {
  query,
  generateLPPlans,
  saveLP,
  generateAndSaveLP,
  generateCharacterPost,
  isTooSimilar,
  postSlack,
  todayJstAtUtc,
  daysAgoUtc,
  type LPPlan,
  type SNSAccount,
} from '@affiliate/shared';

const MOCK = !!process.env.PIPELINE_MOCK;
const PLANS_PER_GENRE = Number(process.env.PLANS_PER_GENRE || 1);
const SIMILARITY_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD || 0.6);
const SIMILARITY_MAX_RETRIES = 2;

interface GenreRow {
  slug: string;
  name: string;
  tone_prompt: string;
}
interface OfferRow {
  id: string;
  name: string;
  description?: string | null;
}

async function recentLpTitles(genreSlug: string): Promise<string[]> {
  const since = daysAgoUtc(30);
  const rows = (await query.all(
    `SELECT title FROM lp_configs WHERE genre = ? AND created_at >= ? ORDER BY created_at DESC`,
    [genreSlug, since]
  )) as any[];
  return rows.map((r) => r.title).filter(Boolean);
}

async function recentQueueBodies(): Promise<string[]> {
  const since = daysAgoUtc(30);
  const rows = (await query.all(
    `SELECT body FROM post_queue WHERE created_at >= ?`,
    [since]
  )) as any[];
  return rows.map((r) => r.body).filter(Boolean);
}

function mockPlan(genre: GenreRow, offers: OfferRow[]): LPPlan {
  const offer = offers[0];
  const stamp = Date.now().toString(36);
  return {
    title: `${genre.name}の見直しガイド ${stamp}`,
    description: `${genre.name}に関する${offer.name}を活用した実践ガイド。`,
    target: `${genre.name}に関心がある読者`,
    keywords: [genre.slug, genre.name, 'ガイド'],
    offer_id: offer.id,
  };
}

function mockLpContent(plan: LPPlan) {
  return {
    title: plan.title,
    headline: plan.title,
    subheadline: plan.description,
    heroImageDescription: 'mock hero',
    sections: [
      { title: 'ポイント', content: `${plan.description}\nmockセクション本文。` },
    ],
    footer: 'mock footer',
  };
}

function mockPostBody(plan: LPPlan, url: string, variant: 'morning' | 'evening'): string {
  const prefix = variant === 'morning' ? 'おはようございます。' : 'お疲れさまです。';
  return `${prefix}${plan.title} ${url} #${plan.keywords[0] ?? ''}`;
}

async function buildPostBody(
  account: SNSAccount,
  plan: LPPlan,
  lpUrl: string,
  variant: 'morning' | 'evening'
): Promise<string> {
  if (MOCK) return mockPostBody(plan, lpUrl, variant);
  return generateCharacterPost(
    account,
    {
      title: plan.title,
      description: plan.description,
      url: lpUrl,
      hashtags: plan.keywords,
      targetAudience: plan.target,
    },
    variant
  );
}

async function main(): Promise<void> {
  if (await hasSucceededToday('generate')) {
    console.log('[generate] already succeeded today (JST); skipping for idempotency.');
    return;
  }

  const runId = await startRun('generate');
  const summary = { genres: 0, lps: 0, queued: 0, skipped: 0, errors: [] as string[] };

  try {
    const genres = (await query.all(
      `SELECT slug, name, tone_prompt FROM genres WHERE is_active ${isPg ? '= true' : '= 1'}`
    )) as GenreRow[];

    for (const genre of genres) {
      summary.genres++;
      try {
        const offers = (await query.all(
          `SELECT id, name, description FROM offers
           WHERE genre_slug = ? AND is_active ${isPg ? '= true' : '= 1'}
           ORDER BY priority DESC`,
          [genre.slug]
        )) as OfferRow[];

        if (offers.length === 0) {
          console.log(`[generate] genre ${genre.slug}: no active offers, skipping`);
          continue;
        }

        const recentTitles = await recentLpTitles(genre.slug);
        const validOfferIds = new Set(offers.map((o) => o.id));

        const plans: LPPlan[] = MOCK
          ? Array.from({ length: PLANS_PER_GENRE }, () => mockPlan(genre, offers))
          : await generateLPPlans(genre.name, genre.tone_prompt, offers, recentTitles, PLANS_PER_GENRE);

        // The genre's dedicated account (1 account = 1 genre).
        const account = (await query.get(
          `SELECT * FROM sns_accounts WHERE genre_slug = ? AND is_active ${isPg ? '= true' : '= 1'} LIMIT 1`,
          [genre.slug]
        )) as SNSAccount | null;

        for (const plan of plans) {
          // Coerce an invalid offer_id back into the valid set.
          const offerId = validOfferIds.has(plan.offer_id) ? plan.offer_id : offers[0].id;

          let slug: string;
          if (MOCK) {
            slug = await saveLP(
              {
                title: plan.title,
                description: plan.description,
                targetAudience: plan.target,
                offerId,
                keywords: plan.keywords,
                genre: genre.slug,
              },
              mockLpContent(plan)
            );
          } else {
            const res = await generateAndSaveLP({
              title: plan.title,
              description: plan.description,
              targetAudience: plan.target,
              offerId,
              keywords: plan.keywords,
              genre: genre.slug,
            });
            slug = res.slug;
          }
          summary.lps++;
          const lpUrl = `${WEB_BASE_URL}/lp/${slug}`;
          console.log(`[generate] LP created: ${lpUrl} (genre=${genre.slug})`);

          if (!account) {
            console.log(`[generate] genre ${genre.slug}: no active account, LP queued for posting skipped`);
            continue;
          }

          for (const [variant, hourJst] of [
            ['morning', 6],
            ['evening', 20],
          ] as const) {
            let body = await buildPostBody(account, plan, lpUrl, variant);
            let corpus = await recentQueueBodies();
            let attempts = 0;
            while (isTooSimilar(body, corpus, SIMILARITY_THRESHOLD) && attempts < SIMILARITY_MAX_RETRIES) {
              attempts++;
              console.log(`[generate] ${genre.slug}/${variant}: too similar, regenerating (#${attempts})`);
              body = await buildPostBody(account, plan, lpUrl, variant);
              corpus = await recentQueueBodies();
            }
            const tooSimilar = isTooSimilar(body, corpus, SIMILARITY_THRESHOLD);
            const status = tooSimilar ? 'skipped' : 'pending';
            const scheduledAt = todayJstAtUtc(hourJst);

            await query.run(
              `INSERT INTO post_queue (lp_slug, sns_account_id, body, scheduled_at, status)
               VALUES (?, ?, ?, ?, ?)`,
              [slug, (account as any).id, body, scheduledAt, status]
            );
            if (tooSimilar) {
              summary.skipped++;
              console.log(`[generate] ${genre.slug}/${variant}: queued as SKIPPED (similarity)`);
            } else {
              summary.queued++;
              console.log(`[generate] ${genre.slug}/${variant}: queued for ${scheduledAt}`);
            }
          }
        }
      } catch (genreErr) {
        const msg = `genre ${genre.slug}: ${genreErr instanceof Error ? genreErr.message : String(genreErr)}`;
        summary.errors.push(msg);
        console.error('[generate]', msg);
      }
    }

    const status = summary.errors.length === 0 ? 'success' : 'partial';
    await finishRun(runId, status, summary);
    console.log('[generate] summary:', JSON.stringify(summary));
    if (status === 'partial') {
      await postSlack(`⚠️ LP生成パイプライン partial: ${summary.errors.length}件のジャンルで失敗\n${summary.errors.join('\n')}`);
    }
  } catch (err) {
    await finishRun(runId, 'failed', { error: err instanceof Error ? err.message : String(err), summary });
    await postSlack(`🚨 LP生成パイプライン failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[generate] fatal:', err);
    process.exit(1);
  });
