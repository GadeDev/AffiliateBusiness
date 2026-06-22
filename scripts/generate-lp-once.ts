import '../pipeline/_env';
import { requireCiEnv } from '../pipeline/_env';
import { WEB_BASE_URL } from '../pipeline/_shared';
import { generateAndSaveLP, postSlack } from '@affiliate/shared';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseKeywords(value: string): string[] {
  return value
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  requireCiEnv(['DATABASE_URL', 'ANTHROPIC_API_KEY'], 'ops-lp-generate');

  const title = requiredEnv('LP_TITLE');
  const description = requiredEnv('LP_DESCRIPTION');
  const targetAudience = requiredEnv('LP_TARGET_AUDIENCE');
  const offerId = requiredEnv('LP_OFFER_ID');
  const keywords = parseKeywords(requiredEnv('LP_KEYWORDS'));
  const genre = process.env.LP_GENRE?.trim() || null;

  const result = await generateAndSaveLP({
    title,
    description,
    targetAudience,
    offerId,
    keywords,
    genre,
  });
  const url = `${WEB_BASE_URL}/lp/${result.slug}`;

  console.log(`LP_GENERATED_SLUG=${result.slug}`);
  console.log(`LP_URL=${url}`);

  await postSlack(`AffiliateBusiness: LPを生成しました\n${title}\n${url}`);
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ops-lp-generate] fatal:', err);
    await postSlack(`🚨 ops-lp-generate failed: ${message}`);
    process.exit(1);
  });
