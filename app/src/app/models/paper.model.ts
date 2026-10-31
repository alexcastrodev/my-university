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

export const LIBRARY_STATUSES = ['to-read', 'reading', 'read'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export type LibrarySort = 'added' | 'title' | 'completed' | 'rating';

/** What the signed-in reader keeps about a paper; mirrors GET /api/paper-library/:paperId. */
export interface LibraryEntry {
  paperId: number;
  status: LibraryStatus;
  /** 1 to 5, or null when not rated. */
  rating: number | null;
  tags: string[];
  addedAt: string;
  /** The day it was finished, `YYYY-MM-DD`; only a paper with status `read` has one. */
  completedAt: string | null;
}

export interface LibraryItem extends PaperSummary {
  library: LibraryEntry;
}

export interface LibraryPage {
  items: LibraryItem[];
  total: number;
  page: number;
  limit: number;
}

export interface LibraryFacets {
  total: number;
  statuses: { value: LibraryStatus; count: number }[];
  tags: FacetValue[];
}

/** The library filters as they live in the URL: a missing key means "not filtered". */
export interface LibraryQuery {
  q?: string;
  status?: LibraryStatus;
  tag?: string;
  sort?: LibrarySort;
  page?: number;
}

/** A change to one entry. A missing key is left alone; `null` clears the rating or the finishing day. */
export interface LibraryChange {
  status?: LibraryStatus;
  rating?: number | null;
  tags?: string[];
  completedAt?: string | null;
}
