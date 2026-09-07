import { ConceptLinkRef } from '../shared/concept-types';

export interface ConceptRelation {
  module: string;
  discipline: string;
  slug: string;
  publishedAt: string;
  related: ConceptLinkRef[];
}

export interface RevisitCandidate {
  module: string;
  discipline: string;
  slug: string;
  publishedAt: string;
}

/** `curriculum/<module>/<discipline>/<slug>` for a CC target, or `<complementaryModule>/<slug>`
 *  for a Complementary Studies one — the identity a `related` link's `feature`+`slug` and a
 *  resolved read entry's module+slug both collapse to, so the two sides of "revisit" can be
 *  matched by simple string equality. */
export function targetKey(module: string, slug: string, discipline?: string): string {
  return discipline ? `curriculum/${module}/${discipline}/${slug}` : `${module}/${slug}`;
}

/** Every CC concept's `related` links, reduced to `targetKey -> newer concepts pointing at
 *  it`. Same-discipline links (no `feature`) are skipped — they're not a "new material
 *  surfaced elsewhere" signal, just internal cross-references likely published together. */
export function buildRevisitIndex(concepts: ConceptRelation[]): Map<string, RevisitCandidate[]> {
  const index = new Map<string, RevisitCandidate[]>();

  for (const concept of concepts) {
    for (const ref of concept.related) {
      if (typeof ref === 'string' || !ref.feature) continue;

      let key: string;
      if (ref.feature.startsWith('curriculum/')) {
        const [, targetModule, targetDiscipline] = ref.feature.split('/');
        if (!targetModule || !targetDiscipline) continue;
        key = targetKey(targetModule, ref.slug, targetDiscipline);
      } else {
        key = targetKey(ref.feature, ref.slug);
      }

      const owners = index.get(key) ?? [];
      owners.push({ module: concept.module, discipline: concept.discipline, slug: concept.slug, publishedAt: concept.publishedAt });
      index.set(key, owners);
    }
  }

  return index;
}

/** The single newest candidate published strictly after `readDateKey` (a `YYYY-MM-DD` key,
 *  comparable lexicographically), or null if nothing in the index qualifies. */
export function newestCandidateAfter(
  index: Map<string, RevisitCandidate[]>,
  key: string,
  readDateKey: string,
): RevisitCandidate | null {
  const candidates = (index.get(key) ?? []).filter((c) => c.publishedAt > readDateKey);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.publishedAt > a.publishedAt ? b : a));
}
