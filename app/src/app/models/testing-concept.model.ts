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
  topic: string;
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
  lab?: string;
  references: TestingConceptReference[];
}

/** Principles first, then the JUnit tooling, unit test design, test doubles, and Spring/database testing last. */
export const TESTING_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'Principles, Strategy and End-to-End',
  'JUnit 5',
  'Writing Good Unit Tests',
  'Test Doubles and Mocking',
  'Spring and Database Testing',
];
