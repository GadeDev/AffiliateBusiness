/**
 * Management CLI (replaces the admin UI for ops tasks).
 *   pnpm cli <command> [--flags]
 *
 * Commands:
 *   genre:seed
 *   offer:add --name --url --genre [--id] [--description] [--source a8] [--priority 0]
 *   offer:list
 *   offer:disable <id> | offer:enable <id>
 *   account:add --slug --genre [--platform twitter] [--name] [--daily-cap 2]
 *   account:list
 *   account:enable <id> | account:disable <id>
 *
 * Local runs use SQLite (DATABASE_URL unset); production uses Neon.
 * SNS API keys are NOT stored in the DB — only the account `slug`. Keys are
 * resolved at post time from env vars `TW_<SLUG>_*` (see Phase 3).
 */
import { query } from '@affiliate/shared';

const isPg = !!process.env.DATABASE_URL;
const DAILY_CAP_HARD_LIMIT = 3;

/** Bind a boolean portably: Postgres wants a real boolean, SQLite wants 0/1. */
function bool(v: boolean): boolean | number {
  return isPg ? v : v ? 1 : 0;
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = 'true';
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const v = flags[name];
  if (!v || v === 'true') {
    console.error(`Missing required flag: --${name}`);
    process.exit(1);
  }
  return v;
}

const GENRE_SEED: Array<{ slug: string; name: string; tone_prompt: string }> = [
  {
    slug: 'career',
    name: '転職',
    tone_prompt:
      '論理的で比較を重視する文体。煽らず、メリット/デメリットを淡々と整理する。読者は現職に不満を持つ20-30代社会人。誇大表現・断定的な収入保証は禁止。',
  },
  {
    slug: 'investment',
    name: '投資',
    tone_prompt:
      '冷静で要点主義の文体。リスクとリターンを必ず併記する。読者は資産形成を始めたい初心者。元本保証・確実に儲かる等の表現は絶対禁止。',
  },
  {
    slug: 'household',
    name: '家計改善',
    tone_prompt:
      '実務的で生活に寄り添う文体。具体的な金額・手順を示す。読者は固定費を見直したい主婦/共働き世帯。不安を過度に煽らない。',
  },
  {
    slug: 'love',
    name: '恋愛',
    tone_prompt:
      '観察的でやや辛口だが共感ベースの文体。読者は出会い/関係改善を求める20-30代。誇張した成功体験・性的表現は禁止。',
  },
  {
    slug: 'baseball',
    name: '野球',
    tone_prompt:
      '熱量がありつつ冷静に観戦ポイントを語る文体。読者は野球観戦を深めたい初心者〜中級者。断定的な勝敗予想・賭博誘導は禁止。',
  },
];

async function genreSeed(): Promise<void> {
  for (const g of GENRE_SEED) {
    const existing = await query.get(`SELECT slug FROM genres WHERE slug = ?`, [g.slug]);
    if (existing) {
      await query.run(`UPDATE genres SET name = ?, tone_prompt = ?, is_active = ? WHERE slug = ?`, [
        g.name,
        g.tone_prompt,
        bool(true),
        g.slug,
      ]);
      console.log(`updated genre: ${g.slug} (${g.name})`);
    } else {
      await query.run(
        `INSERT INTO genres (slug, name, tone_prompt, is_active) VALUES (?, ?, ?, ?)`,
        [g.slug, g.name, g.tone_prompt, bool(true)]
      );
      console.log(`inserted genre: ${g.slug} (${g.name})`);
    }
  }
}

async function genreExists(slug: string): Promise<boolean> {
  const row = await query.get(`SELECT slug FROM genres WHERE slug = ?`, [slug]);
  return !!row;
}

async function offerAdd(flags: Record<string, string>): Promise<void> {
  const name = requireFlag(flags, 'name');
  const url = requireFlag(flags, 'url');
  const genre = requireFlag(flags, 'genre');
  const description = flags.description && flags.description !== 'true' ? flags.description : null;
  if (!(await genreExists(genre))) {
    console.error(`Unknown genre: ${genre}. Run "pnpm cli genre:seed" or check genre:list.`);
    process.exit(1);
  }
  const source = flags.source && flags.source !== 'true' ? flags.source : 'a8';
  const priority = flags.priority && flags.priority !== 'true' ? parseInt(flags.priority, 10) || 0 : 0;
  let id = flags.id && flags.id !== 'true' ? flags.id : slugify(name);
  if (!id || id.length < 3) id = `${genre}-${Date.now().toString(36)}`;

  await query.run(
    `INSERT INTO offers (id, name, url, description, genre_slug, source, priority, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, url, description, genre, source, priority, bool(true)]
  );
  console.log(`added offer: ${id} (${name}) [genre=${genre}, source=${source}]`);
}

async function offerList(): Promise<void> {
  const rows = (await query.all(
    `SELECT id, name, genre_slug, source, priority, is_active FROM offers ORDER BY priority DESC, id`
  )) as any[];
  if (rows.length === 0) {
    console.log('(no offers)');
    return;
  }
  for (const r of rows) {
    const active = r.is_active === true || r.is_active === 1 ? 'on' : 'OFF';
    console.log(
      `${r.id}\t[${active}] genre=${r.genre_slug ?? '-'} src=${r.source ?? '-'} prio=${r.priority ?? 0}\t${r.name}`
    );
  }
}

async function offerSetActive(id: string, active: boolean): Promise<void> {
  const res: any = await query.run(`UPDATE offers SET is_active = ? WHERE id = ?`, [bool(active), id]);
  const changed = isPg ? res?.rowCount : res?.changes;
  if (changed === 0) {
    console.error(`offer not found: ${id}`);
    process.exit(1);
  }
  console.log(`offer ${id} -> ${active ? 'enabled' : 'disabled'}`);
}

async function accountAdd(flags: Record<string, string>): Promise<void> {
  const slug = requireFlag(flags, 'slug');
  const genre = requireFlag(flags, 'genre');
  if (!(await genreExists(genre))) {
    console.error(`Unknown genre: ${genre}. Run "pnpm cli genre:seed" first.`);
    process.exit(1);
  }
  const platform = flags.platform && flags.platform !== 'true' ? flags.platform : 'twitter';
  const accountName = flags.name && flags.name !== 'true' ? flags.name : slug;
  let dailyCap = flags['daily-cap'] && flags['daily-cap'] !== 'true' ? parseInt(flags['daily-cap'], 10) : 2;
  if (Number.isNaN(dailyCap)) dailyCap = 2;
  if (dailyCap > DAILY_CAP_HARD_LIMIT) dailyCap = DAILY_CAP_HARD_LIMIT;
  if (dailyCap < 0) dailyCap = 0;

  // Enforce 1 account = 1 genre is a runtime posting rule; here we just warn on reuse.
  const dupGenre = await query.get(`SELECT slug FROM sns_accounts WHERE genre_slug = ?`, [genre]);
  if (dupGenre) {
    console.warn(`warning: genre "${genre}" already has an account. 1 account = 1 genre is the rule.`);
  }
  const dupSlug = await query.get(`SELECT id FROM sns_accounts WHERE slug = ?`, [slug]);
  if (dupSlug) {
    console.error(`account slug already exists: ${slug}`);
    process.exit(1);
  }

  await query.run(
    `INSERT INTO sns_accounts (platform, account_name, theme, slug, genre_slug, daily_post_cap, consecutive_failures, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [platform, accountName, genre, slug, genre, dailyCap, 0, bool(true)]
  );
  console.log(`added account: slug=${slug} platform=${platform} genre=${genre} daily_cap=${dailyCap}`);
  console.log(`  (set keys via env: TW_${slug.toUpperCase()}_API_KEY / _API_SECRET / _ACCESS_TOKEN / _ACCESS_SECRET)`);
}

async function accountList(): Promise<void> {
  const rows = (await query.all(
    `SELECT id, slug, platform, genre_slug, daily_post_cap, consecutive_failures, is_active
     FROM sns_accounts ORDER BY id`
  )) as any[];
  if (rows.length === 0) {
    console.log('(no accounts)');
    return;
  }
  for (const r of rows) {
    const active = r.is_active === true || r.is_active === 1 ? 'on' : 'OFF';
    console.log(
      `#${r.id}\tslug=${r.slug ?? '-'}\t[${active}] platform=${r.platform} genre=${r.genre_slug ?? '-'} cap=${r.daily_post_cap ?? 2} fails=${r.consecutive_failures ?? 0}`
    );
  }
}

async function accountSetActive(id: string, active: boolean): Promise<void> {
  const failReset = active ? `, consecutive_failures = 0` : '';
  const res: any = await query.run(
    `UPDATE sns_accounts SET is_active = ?${failReset} WHERE id = ?`,
    [bool(active), id]
  );
  const changed = isPg ? res?.rowCount : res?.changes;
  if (changed === 0) {
    console.error(`account not found: ${id}`);
    process.exit(1);
  }
  console.log(`account #${id} -> ${active ? 'enabled' : 'disabled'}`);
}

function usage(): void {
  console.log(`Usage: pnpm cli <command>

  genre:seed
  offer:add --name <n> --url <u> --genre <g> [--id <id>] [--description <text>] [--source a8] [--priority 0]
  offer:list
  offer:disable <id>
  offer:enable <id>
  account:add --slug <s> --genre <g> [--platform twitter] [--name <n>] [--daily-cap 2]
  account:list
  account:enable <id>
  account:disable <id>`);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const { positional, flags } = parseFlags(rest);

  switch (command) {
    case 'genre:seed':
      await genreSeed();
      break;
    case 'offer:add':
      await offerAdd(flags);
      break;
    case 'offer:list':
      await offerList();
      break;
    case 'offer:disable':
      await offerSetActive(positional[0], false);
      break;
    case 'offer:enable':
      await offerSetActive(positional[0], true);
      break;
    case 'account:add':
      await accountAdd(flags);
      break;
    case 'account:list':
      await accountList();
      break;
    case 'account:enable':
      await accountSetActive(positional[0], true);
      break;
    case 'account:disable':
      await accountSetActive(positional[0], false);
      break;
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
