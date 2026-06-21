/**
 * Env bootstrap. MUST be imported before any module that pulls in the shared DB
 * layer, because that layer reads DATABASE_URL / DATABASE_PATH at import time.
 *
 * - Loads .env.local for local runs (CI injects env directly; dotenv won't override).
 * - Drops a placeholder DATABASE_URL (host literally "host") so local runs fall back
 *   to SQLite instead of trying to connect to a non-existent host.
 * - Defaults the SQLite path to the repo-root data/clicks.db when running from root.
 */
import { config as loadEnv } from 'dotenv';
import path from 'path';

loadEnv({ path: path.join(process.cwd(), '.env.local'), quiet: true });

export function requireCiEnv(names: string[], context: string): void {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`[${context}] Missing required GitHub Actions configuration: ${missing.join(', ')}`);
  }
}

const url = process.env.DATABASE_URL;
if (url) {
  let invalid = false;
  try {
    const host = new URL(url).hostname;
    if (!host || host === 'host' || host === 'localhost-placeholder') invalid = true;
  } catch {
    invalid = true;
  }
  if (invalid) {
    delete process.env.DATABASE_URL;
    console.warn('[env] DATABASE_URL looks like a placeholder; falling back to local SQLite');
  }
}

if (process.env.GITHUB_ACTIONS === 'true' && !process.env.DATABASE_URL) {
  throw new Error('[env] DATABASE_URL is required in GitHub Actions. Refusing to run against temporary SQLite.');
}

if (!process.env.DATABASE_URL && !process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = path.join(process.cwd(), 'data', 'clicks.db');
}
