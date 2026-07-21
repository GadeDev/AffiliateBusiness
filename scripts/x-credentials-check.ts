import '../pipeline/_env';
import { TwitterApi } from 'twitter-api-v2';
import { formatTwitterError, query, type SNSAccount } from '@affiliate/shared';

type TwitterKeys = {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
};

function on(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function prefixFor(slug: string): string {
  return `TW_${slug.toUpperCase()}`;
}

function hasValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveTwitterKeys(account: SNSAccount): { keys?: TwitterKeys; missing: string[] } {
  const slug = String(account.slug || '');
  const prefix = slug ? prefixFor(slug) : '';
  const fromEnv = (suffix: string): string | undefined => (prefix ? process.env[`${prefix}_${suffix}`] : undefined);
  const values = {
    appKey: fromEnv('API_KEY') || account.api_key || process.env.TWITTER_API_KEY,
    appSecret: fromEnv('API_SECRET') || account.api_secret || process.env.TWITTER_API_SECRET,
    accessToken: fromEnv('ACCESS_TOKEN') || account.access_token || process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: fromEnv('ACCESS_SECRET') || account.access_secret || process.env.TWITTER_ACCESS_SECRET,
  };
  const missing = [
    ['API_KEY', values.appKey],
    ['API_SECRET', values.appSecret],
    ['ACCESS_TOKEN', values.accessToken],
    ['ACCESS_SECRET', values.accessSecret],
  ]
    .filter(([, value]) => !hasValue(value))
    .map(([suffix]) => (prefix ? `${prefix}_${suffix}` : `TWITTER_${suffix}`));

  if (missing.length > 0) return { missing };
  return { keys: values as TwitterKeys, missing: [] };
}

async function main(): Promise<void> {
  const onlySlug = process.env.X_CHECK_SLUG;
  const includeInactive = process.env.X_CHECK_INCLUDE_INACTIVE === '1';
  const rows = (await query.all(
    `SELECT id, slug, platform, account_name, api_key, api_secret, access_token, access_secret, is_active
     FROM sns_accounts
     WHERE platform = 'twitter'
     ORDER BY genre_slug, id`
  )) as SNSAccount[];

  const accounts = rows.filter((account) => {
    if (onlySlug && account.slug !== onlySlug) return false;
    return !!onlySlug || includeInactive || on(account.is_active);
  });

  if (accounts.length === 0) {
    throw new Error('X認証チェック対象の有効アカウントがありません。ops-x-bootstrap をSecrets登録後に再実行してください。');
  }

  let failed = 0;
  for (const account of accounts) {
    const slug = String(account.slug || `account-${account.id}`);
    const { keys, missing } = resolveTwitterKeys(account);
    if (!keys) {
      failed++;
      console.error(`[x-check] NG ${slug}: missing ${missing.join(', ')}`);
      continue;
    }

    try {
      const client = new TwitterApi(keys);
      const me = await client.v2.me();
      console.log(`[x-check] OK ${slug}: @${me.data.username} (${me.data.id})`);
    } catch (error) {
      failed++;
      console.error(`[x-check] NG ${slug}: ${formatTwitterError(error)}`);
    }
  }

  if (failed > 0) {
    throw new Error(`X認証チェックに ${failed} 件失敗しました。`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[x-check] failed:', formatTwitterError(err));
    process.exit(1);
  });
