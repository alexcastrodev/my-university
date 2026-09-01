import { Language } from './language.model';

export type TestingConceptCategory = 'Java' | 'Spring';

export interface TestingConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface TestingConceptSection {
  title: string;
  content: string;
}

export interface TestingConceptSummary {
  slug: string;
  id: number;
  category: TestingConceptCategory;
  title: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface TestingConcept extends TestingConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: TestingConceptSection[];
  references: TestingConceptReference[];
}
