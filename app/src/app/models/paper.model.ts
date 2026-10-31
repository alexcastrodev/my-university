import { Language } from './language.model';

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

/** Where a paper stands for a reader with no academic background; the API derives it from the type. */
export const PUBLICATION_STAGES = ['preprint', 'published', 'thesis', 'report', 'unknown'] as const;
export type PublicationStage = (typeof PUBLICATION_STAGES)[number];

export type PaperSort = 'recent' | 'title';

/** A row of the public catalog; mirrors GET /api/papers. */
export interface PaperSummary {
  /** The public id: the slug of a catalog paper (a file), the UUIDv7 of a private one. */
  id: string;
  title: string;
  authors: string[];
  keywords: string[];
  venue: string | null;
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`: scholarly dates are often only a year. */
  publicationDate: string | null;
  doi: string | null;
  url: string | null;
  researchArea: string | null;
  type: PaperType;
  stage: PublicationStage;
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

/** The record of one paper; mirrors GET /api/paper-library/:id/paper. */
export interface Paper {
  /** The public id: a slug for a catalog paper, a UUIDv7 for a private one. */
  id: string;
  title: string;
  abstract: string | null;
  doi: string | null;
  venue: string | null;
  publicationDate: string | null;
  url: string | null;
  researchArea: string | null;
  type: PaperType;
  stage: PublicationStage;
  authors: { name: string; orcid: string | null }[];
  keywords: string[];
}

/** One `##` section of the Research Analysis; `content` is markdown. */
export interface PaperSection {
  title: string;
  content: string;
}

/**
 * A catalog paper with our Research Analysis; mirrors GET /api/papers/:slug. The analysis is the markdown of the
 * paper's file, in the reader's language (English when it has no translation).
 */
export interface PublicPaper extends Paper {
  language: Language;
  availableLanguages: Language[];
  summary: string;
  version: string;
  /** The day the analysis was last revised, `YYYY-MM-DD`. */
  updatedAt: string;
  sections: PaperSection[];
}

/** The catalog filters as they live in the URL: a missing key means "not filtered". */
export interface PaperQuery {
  q?: string;
  author?: string;
  keyword?: string;
  area?: string;
  type?: PaperType;
  stage?: PublicationStage;
  sort?: PaperSort;
  page?: number;
}

export type AttachmentState = 'pending' | 'approved' | 'rejected' | 'superseded';

export interface AttachmentVersion {
  version: number;
  state: AttachmentState;
  filename: string;
  size: number;
  sha256: string;
  /** Stable code of why a refused version was refused; map it with `attachmentErrorMessage`. */
  rejectCode: string | null;
  rejectReason: string | null;
  uploadedAt: string;
  scannedAt: string | null;
}

/** The signed-in reader's own PDF for a paper; mirrors GET /api/papers/:id/attachment. Newest version first. */
export interface PaperAttachment {
  id: number;
  visibility: 'private';
  /** The version being served, or null when none was approved. */
  current: number | null;
  versions: AttachmentVersion[];
}

export const LIBRARY_STATUSES = ['to-read', 'reading', 'read'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export type LibrarySort = 'added' | 'title' | 'completed' | 'rating';

/** What the signed-in reader keeps about a paper; mirrors GET /api/paper-library/:paperId. */
export interface LibraryEntry {
  /** The paper's public id. */
  paperId: string;
  /** True for a paper only this reader has (#203): it has no public page. */
  private: boolean;
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

/** What dropping a PDF came to; mirrors POST /api/paper-library/private. */
export interface PrivatePaperResult {
  /** The public id of the paper that holds the PDF now. */
  paperId: string;
  private: boolean;
  /** True when the DOI was already in the catalog and that paper was added instead of a copy. */
  matched: boolean;
  created: boolean;
  library: LibraryEntry;
  attachment: PaperAttachment;
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

/** The paper a DOI already is for the reader; mirrors POST /api/paper-library/import/preview. */
export interface ImportMatch {
  paperId: string;
  title: string;
  /** True for one of the reader's own papers; false for a catalog paper, which is used as it is. */
  private: boolean;
  inLibrary: boolean;
}

/** What looking a DOI up found, and what adding it would do. */
export interface ImportPreview {
  doi: string;
  source: { name: 'crossref'; retrievedAt: string };
  candidate: PaperInput;
  /** What adding would reuse; null when it would create a new private paper. */
  match: ImportMatch | null;
}

/** The answer of POST /api/paper-library/import and /manual: the paper now in the library. */
export type AddPaperResult = Omit<PrivatePaperResult, 'attachment'>;
