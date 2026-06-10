/**
 * Phase 5 (reserved): offer source abstraction.
 *
 * Only the interface is defined here. The Rakuten Web Service integration
 * (ranking / item search) is specified separately and NOT implemented in this
 * repo yet. `offers.source` carries the active source slug ('a8' | 'rakuten').
 */

export interface OfferCandidate {
  name: string;
  url: string;
  genre_slug: string;
  /** Source-native identifier, if any (e.g. Rakuten item code). */
  externalId?: string;
  priority?: number;
}

export interface OfferSource {
  slug: string; // 'a8' | 'rakuten'
  fetchCandidates?(genre: string): Promise<OfferCandidate[]>;
}

/** a8 is registered manually via `pnpm cli offer:add` — no automated fetch. */
export const a8Source: OfferSource = {
  slug: 'a8',
};
