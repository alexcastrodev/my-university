export const PAPER_TYPES = [
  'journal-article',
  'conference-paper',
  'preprint',
  'book-chapter',
  'book',
  'thesis',
  'report',
  'other',
] as const;
export type PaperType = (typeof PAPER_TYPES)[number];

export type PaperSort = 'recent' | 'title';

/** A row of the public catalog; mirrors GET /api/papers. */
export interface PaperSummary {
  id: number;
  title: string;
  authors: string[];
  keywords: string[];
  venue: string | null;
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`: scholarly dates are often only a year. */
  publicationDate: string | null;
  doi: string | null;
  researchArea: string | null;
  type: PaperType;
  /** The start of the abstract, or null when the paper has none. */
  excerpt: string | null;
}

export interface PaperPage {
  items: PaperSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface PaperFacets {
  areas: FacetValue[];
  types: FacetValue[];
}

/** The public record of one paper; mirrors GET /api/papers/:id. */
export interface Paper {
  id: number;
  title: string;
  abstract: string | null;
  doi: string | null;
  venue: string | null;
  publicationDate: string | null;
  url: string | null;
  researchArea: string | null;
  type: PaperType;
  authors: { name: string; orcid: string | null }[];
  keywords: string[];
}

/** The catalog filters as they live in the URL: a missing key means "not filtered". */
export interface PaperQuery {
  q?: string;
  author?: string;
  keyword?: string;
  area?: string;
  type?: PaperType;
  sort?: PaperSort;
  page?: number;
}

/** A paper as it is sent to be created by hand; mirrors the body of POST /api/papers. Only the title is required. */
export interface PaperInput {
  title: string;
  abstract?: string;
  doi?: string;
  venue?: string;
  publicationDate?: string;
  url?: string;
  researchArea?: string;
  type?: PaperType;
  authors?: { name: string; orcid?: string }[];
  keywords?: string[];
}

/** Where the provider disagrees with what the catalog stores; the catalog keeps its own value. */
export interface PaperConflict {
  field: string;
  current: unknown;
  incoming: unknown;
  resolution: 'kept-current' | 'replaced';
}

/** What looking a DOI up found, and what adding it would do; mirrors POST /api/papers/import/preview. */
export interface ImportPreview {
  doi: string;
  source: { name: 'crossref'; retrievedAt: string };
  candidate: PaperInput;
  /** The paper it would merge into; null when it would be a new one. */
  match: Paper | null;
  conflicts: PaperConflict[];
}

/** The answer of POST /api/papers and POST /api/papers/import. */
export interface PaperWriteResult {
  paper: Paper;
  created: boolean;
  conflicts: PaperConflict[];
}
