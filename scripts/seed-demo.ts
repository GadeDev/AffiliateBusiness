/**
 * Phase 4: demo data seeder for report verification (acceptance test #5).
 *
 * Inserts a handful of click_logs for today (JST) across existing LPs so that
 * report-daily / report-weekly have something to aggregate. Safe to run multiple
 * times (rows are additive). Local SQLite only by default.
 *
 *   pnpm seed-demo
 */
import '../pipeline/_env';
import { query, jstDateString } from '@affiliate/shared';

const SOURCES = ['lp', 'x', 'direct'];

async function main(): Promise<void> {
  const lps = (await query.all(`SELECT slug, offer_id FROM lp_configs LIMIT 5`)) as any[];
  if (lps.length === 0) {
    console.error('[seed-demo] no LPs found. Run pnpm pipeline:generate first.');
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  let inserted = 0;
  for (const lp of lps) {
    const n = 2 + Math.floor(Math.random() * 6); // 2-7 clicks per LP
    for (let i = 0; i < n; i++) {
      const source = SOURCES[i % SOURCES.length];
      await query.run(
        `INSERT INTO click_logs (offer_id, clicked_at, ip, user_agent, referer, utm_source, utm_medium, utm_campaign)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [lp.offer_id ?? 'demo', nowIso, '127.0.0.1', 'seed-demo', '', source, 'hero', lp.slug]
      );
      inserted++;
    }
  }
  console.log(`[seed-demo] inserted ${inserted} demo clicks for ${jstDateString()} across ${lps.length} LPs.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-demo] fatal:', err);
  process.exit(1);
});
