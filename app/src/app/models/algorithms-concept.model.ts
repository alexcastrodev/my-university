import { Language } from './language.model';

export type AlgorithmsConceptCategory =
  | 'Fundamentals'
  | 'Sorting'
  | 'Data Structures'
  | 'Graphs'
  | 'Strings'
  | 'Dynamic Programming & Greedy';

export interface AlgorithmsConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface AlgorithmsConceptSection {
  title: string;
  content: string;
}

export interface AlgorithmsConceptSummary {
  slug: string;
  id: number;
  category: AlgorithmsConceptCategory;
  title: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface AlgorithmsConcept extends AlgorithmsConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: AlgorithmsConceptSection[];
  references: AlgorithmsConceptReference[];
}
