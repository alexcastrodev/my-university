import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface GoConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc' | 'book' | 'paper';
}

export interface GoConceptSection {
  title: string;
  content: string;
}

export interface GoConceptSummary {
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

export interface GoConcept extends GoConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: GoConceptSection[];
  lab?: string;
  references: GoConceptReference[];
  related: ConceptLinkRef[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
export const GO_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'Scheduler & GC',
  'Memory & Compiler',
  'Concurrency',
  'Type System',
  'Diagnostics',
  'Production & Tooling',
];
