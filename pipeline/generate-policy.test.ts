import assert from 'node:assert/strict';
import test from 'node:test';

import { selectGenresForGeneration } from './generate-policy';

test('pauses generation below the active X genre threshold', () => {
  const result = selectGenresForGeneration(
    [{ slug: 'career' }, { slug: 'love' }],
    3,
    3
  );

  assert.equal(result.activeGenreCount, 2);
  assert.equal(result.shouldGenerate, false);
  assert.deepEqual(result.selected, []);
});

test('selects at most three genres with the oldest LP inventory', () => {
  const result = selectGenresForGeneration(
    [
      { slug: 'career', latest_lp_at: '2026-07-12T00:00:00Z' },
      { slug: 'investment', latest_lp_at: null },
      { slug: 'household', latest_lp_at: '2026-07-10T00:00:00Z' },
      { slug: 'love', latest_lp_at: '2026-07-13T00:00:00Z' },
      { slug: 'baseball', latest_lp_at: '2026-07-11T00:00:00Z' },
    ],
    3,
    3
  );

  assert.equal(result.activeGenreCount, 5);
  assert.equal(result.shouldGenerate, true);
  assert.deepEqual(result.selected.map((genre) => genre.slug), [
    'investment',
    'household',
    'baseball',
  ]);
});

test('deduplicates multiple active accounts for the same genre', () => {
  const result = selectGenresForGeneration(
    [
      { slug: 'career', latest_lp_at: null },
      { slug: 'career', latest_lp_at: null },
      { slug: 'love', latest_lp_at: null },
      { slug: 'baseball', latest_lp_at: null },
    ],
    3,
    3
  );

  assert.equal(result.activeGenreCount, 3);
  assert.deepEqual(result.selected.map((genre) => genre.slug), ['baseball', 'career', 'love']);
});
