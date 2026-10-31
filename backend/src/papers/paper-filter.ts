import { PaperType } from './paper.entity';
import { PaperFilterDto } from './paper-query.dto';
import { normalizeDoi } from './paper.normalize';
import { typesOfStage } from './paper-stage';

/** What a filter looks at. Public papers (files) and a reader's own (rows) both reduce to this. */
export interface Searchable {
  title: string;
  abstract: string | null;
  doi: string | null;
  authors: string[];
  keywords: string[];
  researchArea: string | null;
  type: PaperType;
  publicationDate: string | null;
  /**
   * The English original of a text shown translated. A filter or a search matches either, so a link or a
   * search typed in one language still finds the paper after the reader switches to the other.
   */
  original?: Pick<Searchable, 'abstract' | 'keywords' | 'researchArea'>;
}

const has = (text?: string): text is string => !!text && text.length > 0;
const contains = (haystack: string | null, needle: string) =>
  !!haystack && haystack.toLowerCase().includes(needle);

/**
 * The catalog and library filters, applied in memory: every filter is combined with AND, text matches ignore
 * case and are substrings, `keyword` is a whole keyword and `area` a whole area.
 *
 * ponytail: a linear scan over a few hundred papers (the public list is authored files, a library is one
 * reader's); an index when either grows to thousands.
 */
export function matchesFilter(paper: Searchable, query: PaperFilterDto): boolean {
  if (has(query.q)) {
    const q = query.q.toLowerCase();
    const found =
      contains(paper.title, q) ||
      contains(paper.abstract, q) ||
      contains(paper.original?.abstract ?? null, q) ||
      contains(paper.doi, q) ||
      paper.authors.some((a) => contains(a, q)) ||
      paper.keywords.some((k) => contains(k, q)) ||
      !!paper.original?.keywords.some((k) => contains(k, q));
    if (!found) return false;
  }
  if (has(query.author)) {
    const author = query.author.toLowerCase();
    if (!paper.authors.some((a) => contains(a, author))) return false;
  }
  if (has(query.doi)) {
    const doi = (normalizeDoi(query.doi) ?? query.doi).toLowerCase();
    if (!contains(paper.doi, doi)) return false;
  }
  if (has(query.keyword)) {
    const keyword = query.keyword.toLowerCase();
    const same = (k: string) => k.toLowerCase() === keyword;
    if (!paper.keywords.some(same) && !paper.original?.keywords.some(same)) return false;
  }
  if (has(query.area)) {
    const area = query.area.toLowerCase();
    const same = (a: string | null | undefined) => a?.toLowerCase() === area;
    if (!same(paper.researchArea) && !same(paper.original?.researchArea)) return false;
  }
  if (query.type && paper.type !== query.type) return false;
  if (query.stage && !typesOfStage(query.stage).includes(paper.type)) {
    return false;
  }
  if (query.year && paper.publicationDate?.slice(0, 4) !== query.year) {
    return false;
  }
  return true;
}

/** Newest publication first (a missing date last), ties broken by the id so the order never shuffles. */
export const byRecent = <T extends { publicationDate: string | null; id: string }>(
  a: T,
  b: T,
): number => {
  if (a.publicationDate !== b.publicationDate) {
    if (a.publicationDate === null) return 1;
    if (b.publicationDate === null) return -1;
    return a.publicationDate < b.publicationDate ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export const byTitle = <T extends { title: string; id: string }>(
  a: T,
  b: T,
): number =>
  a.title.toLowerCase().localeCompare(b.title.toLowerCase()) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
