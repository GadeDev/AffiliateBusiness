import { Pool } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

const isProduction = !!process.env.DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;

let db: any;
let isPostgres = false;

function findWorkspaceRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (
      fs.existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(current, 'turbo.json'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

if (isProduction && DATABASE_URL) {
  // PostgreSQL for production (Neon serverless - Edge/Cloudflare compatible)
  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  // Create tables if not exist
  pool.query(`
    CREATE TABLE IF NOT EXISTS click_logs (
      id           SERIAL PRIMARY KEY,
      offer_id     TEXT    NOT NULL,
      clicked_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ip           TEXT,
      user_agent   TEXT,
      referer      TEXT,
      utm_source   TEXT,
      utm_medium   TEXT,
      utm_campaign TEXT,
      utm_term     TEXT,
      utm_content  TEXT
    )
  `);

  pool.query(`
    CREATE TABLE IF NOT EXISTS offers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      url         TEXT NOT NULL,
      description TEXT,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  pool.query(`
    CREATE TABLE IF NOT EXISTS lp_configs (
      slug        TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      config      TEXT NOT NULL,
      target_audience TEXT,
      offer_id    TEXT,
      content     TEXT,
      keywords    TEXT,
      genre       TEXT,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  pool.query(`
    CREATE TABLE IF NOT EXISTS shindan_configs (
      slug        TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      config      TEXT NOT NULL,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  pool.query(`
    CREATE TABLE IF NOT EXISTS sns_accounts (
      id                   SERIAL PRIMARY KEY,
      platform             TEXT NOT NULL,
      account_name         TEXT NOT NULL,
      theme                TEXT,
      character_name       TEXT,
      character_role       TEXT,
      character_bio        TEXT,
      character_tone       TEXT,
      post_format          TEXT,
      cta_style            TEXT,
      forbidden_expressions TEXT,
      visual_direction     TEXT,
      api_key              TEXT,
      api_secret           TEXT,
      access_token         TEXT,
      access_secret        TEXT,
      is_active            BOOLEAN DEFAULT true,
      created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  pool.query(`
    CREATE TABLE IF NOT EXISTS sns_posts (
      id          SERIAL PRIMARY KEY,
      lp_slug     TEXT NOT NULL,
      platform    TEXT NOT NULL,
      post_id     TEXT,
      content     TEXT NOT NULL,
      success     BOOLEAN NOT NULL,
      error_msg   TEXT,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  pool.query(`
    CREATE TABLE IF NOT EXISTS genres (
      id          SERIAL PRIMARY KEY,
      slug        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      tone_prompt TEXT NOT NULL,
      is_active   BOOLEAN DEFAULT true
    )
  `);

  pool.query(`
    CREATE TABLE IF NOT EXISTS post_queue (
      id              SERIAL PRIMARY KEY,
      lp_slug         TEXT NOT NULL,
      sns_account_id  INTEGER NOT NULL,
      body            TEXT NOT NULL,
      scheduled_at    TEXT NOT NULL,
      status          TEXT DEFAULT 'pending',
      posted_tweet_id TEXT,
      error           TEXT,
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id          SERIAL PRIMARY KEY,
      kind        TEXT NOT NULL,
      started_at  TEXT,
      finished_at TEXT,
      status      TEXT,
      detail      TEXT
    )
  `);

  // Additive columns (idempotent via IF NOT EXISTS)
  pool.query(`ALTER TABLE offers ADD COLUMN IF NOT EXISTS genre_slug TEXT`);
  pool.query(`ALTER TABLE offers ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'a8'`);
  pool.query(`ALTER TABLE offers ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0`);
  pool.query(`ALTER TABLE offers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
  pool.query(`ALTER TABLE sns_accounts ADD COLUMN IF NOT EXISTS slug TEXT`);
  pool.query(`ALTER TABLE sns_accounts ADD COLUMN IF NOT EXISTS genre_slug TEXT`);
  pool.query(`ALTER TABLE sns_accounts ADD COLUMN IF NOT EXISTS daily_post_cap INTEGER DEFAULT 2`);
  pool.query(`ALTER TABLE sns_accounts ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0`);

  db = pool;
  isPostgres = true;
} else {
  // SQLite for development (better-sqlite3 is loaded lazily to avoid import errors on Vercel)
  const DB_PATH =
    process.env.DATABASE_PATH ?? path.join(findWorkspaceRoot(process.cwd()), 'data', 'clicks.db');

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
  const sqliteDb = new BetterSqlite3(DB_PATH);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS click_logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_id     TEXT    NOT NULL,
      clicked_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      ip           TEXT,
      user_agent   TEXT,
      referer      TEXT,
      utm_source   TEXT,
      utm_medium   TEXT,
      utm_campaign TEXT,
      utm_term     TEXT,
      utm_content  TEXT
    )
  `);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS offers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      url         TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS lp_configs (
      slug            TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      description     TEXT,
      config          TEXT,
      target_audience TEXT,
      offer_id        TEXT,
      content         TEXT,
      keywords        TEXT,
      genre           TEXT,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  // Migrate existing lp_configs tables (ignore errors if columns already exist)
  for (const col of ['target_audience TEXT', 'offer_id TEXT', 'content TEXT', 'keywords TEXT', 'genre TEXT']) {
    try { sqliteDb.exec(`ALTER TABLE lp_configs ADD COLUMN ${col}`); } catch {}
  }

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS shindan_configs (
      slug        TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      config      TEXT NOT NULL, -- JSON
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS sns_accounts (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      platform              TEXT NOT NULL,
      account_name          TEXT NOT NULL,
      theme                 TEXT,
      character_name        TEXT,
      character_role        TEXT,
      character_bio         TEXT,
      character_tone        TEXT,
      post_format           TEXT,
      cta_style             TEXT,
      forbidden_expressions TEXT,
      visual_direction      TEXT,
      api_key               TEXT,
      api_secret            TEXT,
      access_token          TEXT,
      access_secret         TEXT,
      is_active             INTEGER DEFAULT 1,
      created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  // Migrate existing sns_accounts tables
  for (const col of [
    'theme TEXT', 'character_name TEXT', 'character_role TEXT', 'character_bio TEXT',
    'character_tone TEXT', 'post_format TEXT', 'cta_style TEXT',
    'forbidden_expressions TEXT', 'visual_direction TEXT',
  ]) {
    try { sqliteDb.exec(`ALTER TABLE sns_accounts ADD COLUMN ${col}`); } catch {}
  }

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS sns_posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      lp_slug     TEXT NOT NULL,
      platform    TEXT NOT NULL,
      post_id     TEXT,
      content     TEXT NOT NULL,
      success     INTEGER NOT NULL, -- 0 or 1
      error_msg   TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS genres (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      slug        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      tone_prompt TEXT NOT NULL,
      is_active   INTEGER DEFAULT 1
    )
  `);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS post_queue (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      lp_slug         TEXT NOT NULL,
      sns_account_id  INTEGER NOT NULL,
      body            TEXT NOT NULL,
      scheduled_at    TEXT NOT NULL,
      status          TEXT DEFAULT 'pending',
      posted_tweet_id TEXT,
      error           TEXT,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL,
      started_at  TEXT,
      finished_at TEXT,
      status      TEXT,
      detail      TEXT
    )
  `);

  // Additive columns (ignore errors if column already exists)
  for (const stmt of [
    `ALTER TABLE offers ADD COLUMN genre_slug TEXT`,
    `ALTER TABLE offers ADD COLUMN source TEXT DEFAULT 'a8'`,
    `ALTER TABLE offers ADD COLUMN priority INTEGER DEFAULT 0`,
    `ALTER TABLE offers ADD COLUMN is_active INTEGER DEFAULT 1`,
    `ALTER TABLE sns_accounts ADD COLUMN slug TEXT`,
    `ALTER TABLE sns_accounts ADD COLUMN genre_slug TEXT`,
    `ALTER TABLE sns_accounts ADD COLUMN daily_post_cap INTEGER DEFAULT 2`,
    `ALTER TABLE sns_accounts ADD COLUMN consecutive_failures INTEGER DEFAULT 0`,
  ]) {
    try { sqliteDb.exec(stmt); } catch {}
  }

  db = sqliteDb;
  isPostgres = false;
}

// Convert ? placeholders to $1, $2, ... for PostgreSQL
function toPgSql(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryablePgError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|timeout|503|502|504|ECONNRESET|connection|network|terminated/i.test(message);
}

async function pgQuery(sql: string, params: any[] = []) {
  const pgSql = toPgSql(sql);
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await db.query(pgSql, params);
    } catch (error) {
      lastError = error;
      if (!isRetryablePgError(error) || attempt === 3) break;
      await wait(attempt * 150);
    }
  }

  throw lastError;
}

// Unified query interface (use ? placeholders in all SQL)
export const query = {
  all: async (sql: string, params: any[] = []) => {
    if (isPostgres) {
      const res = await pgQuery(sql, params);
      return res.rows;
    } else {
      return db.prepare(sql).all(...params);
    }
  },
  get: async (sql: string, params: any[] = []) => {
    if (isPostgres) {
      const res = await pgQuery(sql, params);
      return res.rows[0] || null;
    } else {
      return db.prepare(sql).get(...params);
    }
  },
  run: async (sql: string, params: any[] = []) => {
    if (isPostgres) {
      return await pgQuery(sql, params);
    } else {
      return db.prepare(sql).run(...params);
    }
  },
};

export default db;
