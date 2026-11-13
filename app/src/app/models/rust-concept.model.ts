import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface RustConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc' | 'book' | 'paper';
}

export interface RustConceptSection {
  title: string;
  content: string;
}

export interface RustConceptSummary {
  slug: string;
  id: number;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface RustConcept extends RustConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: RustConceptSection[];
  lab?: string;
  references: RustConceptReference[];
  related: ConceptLinkRef[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
export const RUST_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'Type System',
  'Unsafe & Memory',
  'Systems Programming',
  'Threads & Atomics',
  'Async',
  'Services',
  'Tooling & Quality',
];
