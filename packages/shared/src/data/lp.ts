import type { LPConfig } from '../types';
import { query } from '../db';

// Function to get all LP configs
export async function getLPConfigs(): Promise<LPConfig[]> {
  const rows = await query.all('SELECT slug, title, description, config FROM lp_configs');
  return rows.map((row: any) => JSON.parse(row.config)) as LPConfig[];
}

// Function to get LP config by slug
export async function getLPConfigBySlug(slug: string): Promise<LPConfig | null> {
  const row = await query.get(
    'SELECT slug, title, description, config, target_audience, offer_id, content, keywords, genre FROM lp_configs WHERE slug = ?',
    [slug]
  ) as any;

  if (!row) return null;

  // If Claude generated content exists, use it
  if (row.content) {
    const content = JSON.parse(row.content);
    return {
      slug: row.slug,
      title: row.title,
      description: row.description,
      genre: row.genre,
      hero: {
        headline: content.headline,
        subheadline: content.subheadline,
        cta: '今すぐ申し込む',
        offer_id: row.offer_id,
      },
      content: content,
    };
  }

  // Otherwise, use the legacy config format
  return JSON.parse(row.config);
}

// For backward compatibility, keep the old array but load from DB
// Note: This will be empty in production until we call getLPConfigs()
export const lpConfigs: LPConfig[] = [];
