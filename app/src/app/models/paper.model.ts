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
  /** The public id (UUIDv7): what URLs and the API call the paper. */
  id: string;
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
  /** The public id (UUIDv7). */
  id: string;
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

/** The six sections of the Research Analysis, in reading order. */
export const ANALYSIS_SECTIONS = [
  'overview',
  'contribution',
  'methodology',
  'findings',
  'criticalAnalysis',
  'furtherResearch',
] as const;
export type AnalysisSectionKey = (typeof ANALYSIS_SECTIONS)[number];

/** A section either says something or says why it does not: nothing forces an unsupported claim. */
export type AnalysisSectionState = 'present' | 'not_applicable' | 'not_reported' | 'unable_to_determine';

export interface AnalysisSection {
  state: AnalysisSectionState;
  text: string | null;
}

/** Someone the analysis credits; the profile link exists only when that person made the profile public. */
export interface AnalysisPerson {
  name: string;
  profilePath: string | null;
}

/** The published Research Analysis; mirrors GET /api/papers/:id/analysis. Drafts never come through here. */
export interface PaperAnalysis {
  revision: number;
  publishedAt: string;
  author: AnalysisPerson | null;
  publishedBy: AnalysisPerson | null;
  sections: Partial<Record<AnalysisSectionKey, AnalysisSection>>;
}
