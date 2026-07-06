/**
 * News commentary pipeline. Runs around noon JST and queues one timely,
 * original X comment per active genre account.
 *
 * This intentionally does not scrape article bodies. It uses RSS metadata
 * (title/source/link/published_at) and writes an original short comment to
 * reduce copyright and compliance risk.
 *
 * Test hooks:
 *  - NEWS_MOCK=1       skip network/Claude and use deterministic feed items
 *  - NEWS_DRY_RUN=1    generate/log candidates without writing to DB
 *  - NEWS_FORCE=1      ignore same-day idempotency
 *  - NEWS_FEEDS_JSON   optional JSON array of feed configs
 */
import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { requireCiEnv } from './_env';
import { hasSucceededToday, isPg, startRun, finishRun } from './_shared';
import {
  daysAgoUtc,
  generateText,
  isTooSimilar,
  postSlack,
  query,
  type SNSAccount,
} from '@affiliate/shared';

interface GenreRow {
  slug: string;
  name: string;
  tone_prompt: string;
}

interface AccountRow extends SNSAccount {
  genre_name: string;
  tone_prompt: string;
}

interface FeedConfig {
  url: string;
  source?: string;
  genres?: string[];
  keywords?: string[];
}

interface NewsItem {
  genreSlug: string;
  title: string;
  url: string;
  source: string;
  publishedAt?: string | null;
}

const MOCK = flag('NEWS_MOCK');
const DRY_RUN = flag('NEWS_DRY_RUN');
const FORCE = flag('NEWS_FORCE');
const SIMILARITY_THRESHOLD = Number(process.env.NEWS_SIMILARITY_THRESHOLD || 0.6);
const MAX_AGE_DAYS = Number(process.env.NEWS_MAX_AGE_DAYS || 7);
const FEED_TIMEOUT_MS = Number(process.env.NEWS_FEED_TIMEOUT_MS || 12000);

const DEFAULT_FEEDS: FeedConfig[] = [
  { url: 'https://prtimes.jp/index.rdf', source: 'PR TIMES' },
  {
    url: 'https://www3.nhk.or.jp/rss/news/cat0.xml',
    source: 'NHKニュース',
    genres: ['career', 'investment', 'household', 'baseball'],
  },
];

const GENRE_KEYWORDS: Record<string, string[]> = {
  career: ['転職', '採用', '求人', 'キャリア', '賃上げ', '人材', 'リスキリング', '働き方'],
  investment: ['投資', '資産運用', '株価', '為替', '金利', 'nisa', '証券', 'fx', '日経平均', '金融'],
  household: ['家計', '保険', '火災保険', '節約', '電気代', '住宅ローン', '値上げ'],
  love: ['恋愛', '婚活', 'マッチングアプリ', '結婚'],
  baseball: ['野球', 'プロ野球', 'npb', '高校野球', 'mlb', '大谷', '阪神', '巨人', '球団'],
};

function flag(name: string): boolean {
  const value = process.env[name];
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return text(obj['#text'] ?? obj['@_href'] ?? obj.href ?? obj.url);
  }
  return '';
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function parseDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function slugHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function configuredFeeds(): FeedConfig[] {
  const raw = process.env.NEWS_FEEDS_JSON;
  if (!raw) return DEFAULT_FEEDS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('NEWS_FEEDS_JSON must be an array');
    const feeds = parsed
      .map((feed) => ({
        url: typeof feed?.url === 'string' ? feed.url : '',
        source: typeof feed?.source === 'string' ? feed.source : undefined,
        genres: Array.isArray(feed?.genres) ? feed.genres.map(String) : undefined,
        keywords: Array.isArray(feed?.keywords) ? feed.keywords.map(String) : undefined,
      }))
      .filter((feed) => feed.url);
    return feeds.length > 0 ? feeds : DEFAULT_FEEDS;
  } catch (err) {
    throw new Error(`NEWS_FEEDS_JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/rss+xml, application/rdf+xml, application/xml, text/xml, */*',
        'User-Agent': 'AffiliateBusiness/1.0; RSS metadata only',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseFeedItems(xml: string, feed: FeedConfig): Array<Omit<NewsItem, 'genreSlug'>> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
  });
  const parsed = parser.parse(xml);

  const rssItems = asArray(parsed?.rss?.channel?.item);
  const rdfItems = asArray(parsed?.RDF?.item);
  const atomEntries = asArray(parsed?.feed?.entry);

  const items: Array<Omit<NewsItem, 'genreSlug'>> = [];
  for (const item of rssItems) {
    const title = text(item?.title);
    const url = normalizeUrl(text(item?.link));
    if (!title || !url) continue;
    items.push({
      title,
      url,
      source: feed.source || text(parsed?.rss?.channel?.title) || hostname(url),
      publishedAt: parseDate(text(item?.pubDate ?? item?.date)),
    });
  }
  for (const item of rdfItems) {
    const title = text(item?.title);
    const url = normalizeUrl(text(item?.link));
    if (!title || !url) continue;
    items.push({
      title,
      url,
      source: feed.source || hostname(url),
      publishedAt: parseDate(text(item?.date ?? item?.pubDate)),
    });
  }
  for (const entry of atomEntries) {
    const title = text(entry?.title);
    const link = asArray(entry?.link).find((l) => text(l)) ?? entry?.link;
    const url = normalizeUrl(text(link));
    if (!title || !url) continue;
    items.push({
      title,
      url,
      source: feed.source || text(parsed?.feed?.title) || hostname(url),
      publishedAt: parseDate(text(entry?.updated ?? entry?.published)),
    });
  }

  return items;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'news';
  }
}

function matchesGenre(item: Omit<NewsItem, 'genreSlug'>, feed: FeedConfig, genre: GenreRow): boolean {
  if (feed.genres && !feed.genres.includes(genre.slug)) return false;
  const keywords = [...(GENRE_KEYWORDS[genre.slug] ?? []), ...(feed.keywords ?? [])].map((kw) =>
    kw.toLowerCase()
  );
  if (keywords.length === 0) return false;
  const haystack = `${item.title} ${item.source} ${item.url}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw));
}

function isFresh(item: NewsItem): boolean {
  if (!item.publishedAt) return true;
  return item.publishedAt >= daysAgoUtc(MAX_AGE_DAYS);
}

function mockItems(genres: GenreRow[]): NewsItem[] {
  return genres.map((genre) => ({
    genreSlug: genre.slug,
    title: `${genre.name}の最新ニュースで確認したい比較ポイント`,
    url: `https://example.com/news/${genre.slug}-${Date.now().toString(36)}`,
    source: 'mock-news',
    publishedAt: new Date().toISOString(),
  }));
}

async function collectNews(genres: GenreRow[]): Promise<{ items: NewsItem[]; errors: string[] }> {
  if (MOCK) return { items: mockItems(genres), errors: [] };

  const feeds = configuredFeeds();
  const items: NewsItem[] = [];
  const errors: string[] = [];

  for (const feed of feeds) {
    try {
      const xml = await fetchWithTimeout(feed.url);
      const parsedItems = parseFeedItems(xml, feed);
      for (const genre of genres) {
        for (const item of parsedItems) {
          if (!matchesGenre(item, feed, genre)) continue;
          items.push({ ...item, genreSlug: genre.slug });
        }
      }
      console.log(`[news] feed ${feed.source || feed.url}: ${parsedItems.length} items`);
    } catch (err) {
      const msg = `${feed.source || feed.url}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`[news] feed failed: ${msg}`);
    }
  }

  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    const key = `${item.genreSlug}:${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));
  return { items: deduped, errors };
}

async function recentQueueBodies(accountId: number): Promise<string[]> {
  const since = daysAgoUtc(14);
  const rows = (await query.all(
    `SELECT body FROM post_queue
     WHERE created_at >= ? AND sns_account_id = ?
     ORDER BY created_at DESC LIMIT 100`,
    [since, accountId]
  )) as any[];
  return rows.map((r) => r.body).filter(Boolean);
}

async function alreadyQueuedOrSeen(item: NewsItem): Promise<boolean> {
  const row = await query.get(`SELECT id FROM news_items WHERE url = ? LIMIT 1`, [item.url]);
  return !!row;
}

function genreGuardrail(genreSlug: string): string {
  switch (genreSlug) {
    case 'investment':
      return '投資助言、利益保証、元本保証、確実に儲かる表現は禁止。条件確認とリスク理解を促す。';
    case 'household':
      return '保険や家計について、必ず安くなる、最安保証、誰でも得する等の断定は禁止。比較条件を確認する姿勢にする。';
    case 'love':
      return '必ず出会える、絶対モテる、性的・過激な煽りは禁止。読者の判断を尊重する。';
    case 'baseball':
      return '勝敗断定、賭博、ギャンブル誘導は禁止。観戦の見方や楽しみ方に寄せる。';
    default:
      return '断定しすぎず、読者が自分で確認できる材料を出す。';
  }
}

async function buildNewsPost(account: AccountRow, item: NewsItem): Promise<string> {
  if (MOCK) {
    return limitPost(
      `${item.source}の見出しから、${account.genre_name}で見落としやすい確認点を整理。${item.title}。背景、条件、読者側の判断材料を分けて見たいところです。\n${item.url}`,
      item.url
    );
  }

  const prompt = `あなたは「${account.character_name}」というXアカウントの中の人です。

キャラクター設定:
- 役割: ${account.character_role}
- 口調: ${account.character_tone}
- 投稿フォーマット: ${account.post_format}
- 禁止表現: ${account.forbidden_expressions}

ジャンル: ${account.genre_name}
ジャンル方針: ${account.tone_prompt}
追加ルール: ${genreGuardrail(account.genre_slug || '')}

以下のニュースRSSメタデータに対して、X向けの短い独自コメントを作成してください。

ニュース:
- タイトル: ${item.title}
- 配信元: ${item.source}
- URL: ${item.url}
- 公開日時: ${item.publishedAt || '不明'}

必須条件:
- 本文のみ出力。説明や引用符は不要
- 180〜240文字程度、最大280文字以内
- URLを必ず含める
- 記事本文は読んでいない前提なので「記事を読むと」「詳しく読むと」と断定しない
- タイトルを丸写しせず、見出しから読み取れる論点へのコメントにする
- そのジャンル固有の論点を必ず1つ入れ、他ジャンルでも使える汎用文にしない
- アフィリエイトLPへの直接誘導は入れない。ニュースへの自然なコメントにする
- 煽り、断定、保証、誇大表現は禁止`;

  return limitPost((await generateText(prompt)).trim(), item.url);
}

function limitPost(body: string, url: string): string {
  let text = body.replace(/^["'「『]+|["'」』]+$/g, '').trim();
  if (!text.includes(url)) {
    text = `${text}\n${url}`;
  }
  if (text.length <= 280) return text;

  const withoutUrl = text.replace(url, '').trim();
  const reserve = url.length + 2;
  const maxBody = Math.max(40, 280 - reserve);
  return `${withoutUrl.slice(0, maxBody - 3).trim()}...\n${url}`;
}

async function queueNewsPost(account: AccountRow, item: NewsItem, body: string): Promise<void> {
  const now = new Date().toISOString();
  const lpSlug = `news-${item.genreSlug}-${slugHash(item.url)}`;
  await query.run(
    `INSERT INTO news_items (genre_slug, title, url, source, published_at, queued_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [item.genreSlug, item.title, item.url, item.source, item.publishedAt ?? null, now]
  );
  await query.run(
    `INSERT INTO post_queue (lp_slug, sns_account_id, body, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?)`,
    [lpSlug, (account as any).id, body, now, 'pending']
  );
}

async function main(): Promise<void> {
  requireCiEnv(MOCK ? ['SLACK_WEBHOOK_URL'] : ['ANTHROPIC_API_KEY', 'SLACK_WEBHOOK_URL'], 'pipeline-news');

  if (!FORCE && !DRY_RUN && (await hasSucceededToday('news'))) {
    console.log('[news] already succeeded today (JST); skipping for idempotency.');
    return;
  }

  const runId = DRY_RUN ? 0 : await startRun('news');
  const summary = {
    accounts: 0,
    candidates: 0,
    queued: 0,
    skipped: 0,
    dryRun: DRY_RUN,
    errors: [] as string[],
  };

  try {
    const genres = (await query.all(
      `SELECT slug, name, tone_prompt FROM genres WHERE is_active ${isPg ? '= true' : '= 1'}`
    )) as GenreRow[];
    const accounts = (await query.all(
      `SELECT sa.*, g.name AS genre_name, g.tone_prompt
       FROM sns_accounts sa
       JOIN genres g ON g.slug = sa.genre_slug
       WHERE sa.is_active ${isPg ? '= true' : '= 1'}`
    )) as AccountRow[];
    const { items, errors } = await collectNews(genres);
    summary.errors.push(...errors);
    summary.candidates = items.length;

    for (const account of accounts) {
      summary.accounts++;
      const genreSlug = account.genre_slug || '';
      const candidates = items.filter((item) => item.genreSlug === genreSlug && isFresh(item));
      if (candidates.length === 0) {
        summary.skipped++;
        console.log(`[news] ${genreSlug}: no fresh candidate`);
        continue;
      }

      let queued = false;
      for (const item of candidates) {
        if (await alreadyQueuedOrSeen(item)) continue;
        const body = await buildNewsPost(account, item);
        const corpus = await recentQueueBodies((account as any).id);
        if (isTooSimilar(body, corpus, SIMILARITY_THRESHOLD)) {
          summary.skipped++;
          console.log(`[news] ${genreSlug}: skipped similar candidate ${item.url}`);
          continue;
        }

        if (DRY_RUN) {
          console.log(`[news] DRY RUN ${genreSlug}: ${body}`);
        } else {
          await queueNewsPost(account, item, body);
        }
        summary.queued++;
        queued = true;
        console.log(`[news] ${genreSlug}: queued ${item.source} ${item.url}`);
        break;
      }
      if (!queued) summary.skipped++;
    }

    const status = summary.errors.length > 0 ? 'partial' : 'success';
    if (!DRY_RUN) await finishRun(runId, status, summary);
    console.log('[news] summary:', JSON.stringify(summary));
    if (status === 'partial') {
      await postSlack(`⚠️ ニュース投稿パイプライン partial: ${summary.errors.length}件のRSS取得に失敗\n${summary.errors.join('\n')}`);
    }
  } catch (err) {
    if (!DRY_RUN) {
      await finishRun(runId, 'failed', { error: err instanceof Error ? err.message : String(err), summary });
    }
    await postSlack(`🚨 ニュース投稿パイプライン failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[news] fatal:', err);
    process.exit(1);
  });
