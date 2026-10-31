import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import seed from '../src/seed/data/papers/papers.json';

const DIR = join(__dirname, '../src/seed/data/papers');

/** What a paper's markdown says about the paper itself: the frontmatter area and keywords, and the abstract section. */
export interface SeedTexts {
  researchArea?: string;
  keywords: string[];
  abstract?: string;
}

/** One entry of `papers.json` (the real seed the live stack serves), with the texts of its English file. */
export interface SeedPaper extends Partial<SeedTexts> {
  slug: string;
  title: string;
  authors: { name: string; orcid?: string }[];
  type: string;
  venue?: string;
  publicationDate?: string;
  doi?: string;
  url?: string;
  /** The same texts as its Portuguese file has them. */
  pt: SeedTexts;
}

/** Reads the area, keywords and abstract out of `content/<slug>/<lang>.md`, the way the spec expects them written. */
function textsOf(slug: string, lang: 'en' | 'pt-BR'): SeedTexts {
  const raw = readFileSync(join(DIR, 'content', slug, `${lang}.md`), 'utf-8');
  const [, head, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)!;
  const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(head)?.[1].trim();
  const abstract = body
    .split(/^## /m)
    .find((section) => /^(Abstract|Resumo)\n/.test(section))
    ?.replace(/^.*\n/, '')
    .trim();
  return {
    researchArea: field('researchArea'),
    keywords: field('keywords')?.split(',').map((k) => k.trim()) ?? [],
    abstract,
  };
}

export const SEED_PAPERS: SeedPaper[] = (seed as Omit<SeedPaper, 'pt' | keyof SeedTexts>[]).map((p) => ({
  ...p,
  ...textsOf(p.slug, 'en'),
  pt: textsOf(p.slug, 'pt-BR'),
}));

/** The seed paper with this slug, or a failure that names it. */
export function seedPaper(slug: string): SeedPaper {
  const found = SEED_PAPERS.find((p) => p.slug === slug);
  if (!found) throw new Error(`no seed paper ${slug}`);
  return found;
}
