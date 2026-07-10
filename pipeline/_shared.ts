/** Shared helpers for batch pipelines: pipeline_runs bookkeeping, idempotency. */
import './_env'; // must run before the shared DB layer is imported
import { query, jstDateString } from '@affiliate/shared';

export const isPg = !!process.env.DATABASE_URL;

export const WEB_BASE_URL =
  process.env.WEB_BASE_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  'https://affiliate-web.yanagiho.workers.dev';

export type PipelineKind = 'generate' | 'post' | 'report' | 'news';

/** Has a successful run of this kind already happened today (JST)? Used for idempotency. */
export async function hasSucceededToday(kind: PipelineKind): Promise<boolean> {
  const today = jstDateString();
  const rows = (await query.all(
    `SELECT started_at, status, detail FROM pipeline_runs WHERE kind = ? AND status IN ('success', 'partial')`,
    [kind]
  )) as any[];
  return rows.some((r) => {
    if (typeof r.started_at !== 'string' || jstDateString(new Date(r.started_at)) !== today) return false;
    if (r.status === 'success') return true;
    return partialRunProducedOutput(r.detail);
  });
}

function partialRunProducedOutput(detail: unknown): boolean {
  if (typeof detail !== 'string') return false;
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    return ['lps', 'queued', 'posted'].some((key) => Number(parsed[key] ?? 0) > 0);
  } catch {
    return false;
  }
}

export async function startRun(kind: PipelineKind): Promise<number> {
  const startedAt = new Date().toISOString();
  if (isPg) {
    const res: any = await query.run(
      `INSERT INTO pipeline_runs (kind, started_at, status) VALUES (?, ?, ?) RETURNING id`,
      [kind, startedAt, 'partial']
    );
    return res.rows[0].id;
  }
  const res: any = await query.run(
    `INSERT INTO pipeline_runs (kind, started_at, status) VALUES (?, ?, ?)`,
    [kind, startedAt, 'partial']
  );
  return Number(res.lastInsertRowid);
}

export async function finishRun(
  id: number,
  status: 'success' | 'partial' | 'failed',
  detail: unknown
): Promise<void> {
  await query.run(`UPDATE pipeline_runs SET finished_at = ?, status = ?, detail = ? WHERE id = ?`, [
    new Date().toISOString(),
    status,
    JSON.stringify(detail),
    id,
  ]);
}
