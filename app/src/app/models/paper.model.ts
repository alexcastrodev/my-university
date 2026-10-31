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
