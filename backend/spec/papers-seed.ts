import seed from '../src/seed/data/papers/papers.json';

/** One entry of `papers.json`, the real seed the live stack serves (see src/seed/data/papers). */
export interface SeedPaper {
  slug: string;
  title: string;
  authors: { name: string; orcid?: string }[];
  type: string;
  venue?: string;
  publicationDate?: string;
  doi?: string;
  url?: string;
  researchArea?: string;
  keywords?: string[];
  abstract?: string;
  i18n?: { 'pt-BR'?: { researchArea?: string; keywords?: string[]; abstract?: string } };
}

export const SEED_PAPERS: SeedPaper[] = seed;

/** The seed paper with this slug, or a failure that names it. */
export function seedPaper(slug: string): SeedPaper {
  const found = SEED_PAPERS.find((p) => p.slug === slug);
  if (!found) throw new Error(`no seed paper ${slug}`);
  return found;
}
