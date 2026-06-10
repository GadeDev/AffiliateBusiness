/**
 * Automation schema migration (Phase 1).
 *
 * Idempotent. Works against both SQLite (local, DATABASE_URL unset) and
 * PostgreSQL/Neon (production, DATABASE_URL set). Run via:
 *   pnpm migrate
 * In CI it runs against production Neon by injecting DATABASE_URL.
 *
 * Note on deviation from SPEC_automation.md: the spec's `post_queue` referenced
 * `lps(id)`, but the real LP table is `lp_configs` keyed by a TEXT `slug`, so the
 * queue stores `lp_slug` instead. Also adds `offers.is_active` and
 * `sns_accounts.slug` which the CLI (`offer:disable`) and Secrets naming
 * (`TW_<SLUG>_*`) require.
 */
import { query } from '@affiliate/shared';

const isPg = !!process.env.DATABASE_URL;
const pk = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
const boolTrue = isPg ? 'BOOLEAN DEFAULT true' : 'INTEGER DEFAULT 1';
const tsDefault = isPg
  ? 'TIMESTAMP WITH TIME ZONE DEFAULT NOW()'
  : `TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`;

async function addColumn(table: string, coldef: string): Promise<void> {
  if (isPg) {
    await query.run(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${coldef}`);
  } else {
    try {
      await query.run(`ALTER TABLE ${table} ADD COLUMN ${coldef}`);
    } catch {
      /* column already exists */
    }
  }
}

async function main(): Promise<void> {
  console.log(`[migrate] dialect: ${isPg ? 'postgres' : 'sqlite'}`);

  await query.run(`
    CREATE TABLE IF NOT EXISTS genres (
      id          ${pk},
      slug        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      tone_prompt TEXT NOT NULL,
      is_active   ${boolTrue}
    )
  `);
  console.log('[migrate] genres ready');

  await query.run(`
    CREATE TABLE IF NOT EXISTS post_queue (
      id              ${pk},
      lp_slug         TEXT NOT NULL,
      sns_account_id  INTEGER NOT NULL,
      body            TEXT NOT NULL,
      scheduled_at    TEXT NOT NULL,
      status          TEXT DEFAULT 'pending',
      posted_tweet_id TEXT,
      error           TEXT,
      created_at      ${tsDefault}
    )
  `);
  console.log('[migrate] post_queue ready');

  await query.run(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id          ${pk},
      kind        TEXT NOT NULL,
      started_at  TEXT,
      finished_at TEXT,
      status      TEXT,
      detail      TEXT
    )
  `);
  console.log('[migrate] pipeline_runs ready');

  await addColumn('offers', `genre_slug TEXT`);
  await addColumn('offers', `source TEXT DEFAULT 'a8'`);
  await addColumn('offers', `priority INTEGER DEFAULT 0`);
  await addColumn('offers', isPg ? `is_active BOOLEAN DEFAULT true` : `is_active INTEGER DEFAULT 1`);
  console.log('[migrate] offers columns ready');

  await addColumn('sns_accounts', `slug TEXT`);
  await addColumn('sns_accounts', `genre_slug TEXT`);
  await addColumn('sns_accounts', `daily_post_cap INTEGER DEFAULT 2`);
  await addColumn('sns_accounts', `consecutive_failures INTEGER DEFAULT 0`);
  console.log('[migrate] sns_accounts columns ready');

  console.log('[migrate] done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
