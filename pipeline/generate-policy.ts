export interface GenerationCandidate {
  slug: string;
  latest_lp_at?: string | null;
}

export interface GenerationSelection<T extends GenerationCandidate> {
  activeGenreCount: number;
  selected: T[];
  shouldGenerate: boolean;
}

function timestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Pause generation until enough X genres are usable, then rotate the genres
 * with the oldest LP inventory into the bounded weekly run.
 */
export function selectGenresForGeneration<T extends GenerationCandidate>(
  candidates: T[],
  minActiveGenres: number,
  maxGenresPerRun: number
): GenerationSelection<T> {
  const unique = [...new Map(candidates.map((candidate) => [candidate.slug, candidate])).values()];
  const shouldGenerate = unique.length >= minActiveGenres;

  if (!shouldGenerate) {
    return { activeGenreCount: unique.length, selected: [], shouldGenerate: false };
  }

  const selected = [...unique]
    .sort((a, b) => timestamp(a.latest_lp_at) - timestamp(b.latest_lp_at) || a.slug.localeCompare(b.slug))
    .slice(0, maxGenresPerRun);

  return { activeGenreCount: unique.length, selected, shouldGenerate: true };
}
