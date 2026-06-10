/**
 * Shared LP generation + persistence. Used by both the admin manual form
 * (apps/admin/app/api/generate-lp) and the batch pipeline (pipeline/generate.ts),
 * so the two paths can never drift.
 */
import { generateLPContent, LPContent } from './claude';
import { query } from './db';

export interface GenerateAndSaveInput {
  title: string;
  description: string;
  targetAudience: string;
  offerId: string;
  keywords: string[];
  genre?: string | null;
}

export interface GenerateAndSaveResult {
  slug: string;
  content: LPContent;
}

function slugifyTitle(title: string): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug || slug.length < 3) slug = `lp-${Date.now().toString(36)}`;
  return slug;
}

/** Persist an already-generated LP to `lp_configs`. Returns the (collision-safe) slug. */
export async function saveLP(input: GenerateAndSaveInput, content: LPContent): Promise<string> {
  let slug = slugifyTitle(input.title);
  // Avoid PK collisions: append a suffix if the slug is taken.
  const existing = await query.get(`SELECT slug FROM lp_configs WHERE slug = ?`, [slug]);
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  await query.run(
    `INSERT INTO lp_configs (slug, title, description, config, target_audience, offer_id, content, keywords, genre)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      slug,
      input.title,
      input.description,
      '{}',
      input.targetAudience,
      input.offerId,
      JSON.stringify(content),
      JSON.stringify(input.keywords),
      input.genre ?? null,
    ]
  );

  return slug;
}

/** Generate LP content via Claude and persist it to `lp_configs`. Returns slug + content. */
export async function generateAndSaveLP(input: GenerateAndSaveInput): Promise<GenerateAndSaveResult> {
  const content = await generateLPContent({
    title: input.title,
    description: input.description,
    targetAudience: input.targetAudience,
    offerId: input.offerId,
    keywords: input.keywords,
  });
  const slug = await saveLP(input, content);
  return { slug, content };
}
