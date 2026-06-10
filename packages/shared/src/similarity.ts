/**
 * Trigram-based text similarity for the X duplicate-post guardrail (§2.1).
 * Returns Sørensen–Dice coefficient over character trigrams in [0, 1].
 */
function trigrams(input: string): Set<string> {
  const s = input.replace(/\s+/g, ' ').trim().toLowerCase();
  const grams = new Set<string>();
  if (s.length < 3) {
    if (s.length > 0) grams.add(s);
    return grams;
  }
  for (let i = 0; i <= s.length - 3; i++) {
    grams.add(s.slice(i, i + 3));
  }
  return grams;
}

export function trigramSimilarity(a: string, b: string): number {
  const ga = trigrams(a);
  const gb = trigrams(b);
  if (ga.size === 0 && gb.size === 0) return 1;
  if (ga.size === 0 || gb.size === 0) return 0;
  let overlap = 0;
  for (const g of ga) if (gb.has(g)) overlap++;
  return (2 * overlap) / (ga.size + gb.size);
}

/** True if `candidate` is too similar to any text in `corpus` (default threshold 0.6). */
export function isTooSimilar(candidate: string, corpus: string[], threshold = 0.6): boolean {
  return corpus.some((c) => trigramSimilarity(candidate, c) > threshold);
}
