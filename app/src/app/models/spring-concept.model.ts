import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export type SpringConceptCategory = 'Spring Boot' | 'Spring Security' | 'Spring Batch';

export interface SpringConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface SpringConceptSection {
  title: string;
  content: string;
}

export interface SpringConceptSummary {
  slug: string;
  id: number;
  category: SpringConceptCategory;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface SpringConcept extends SpringConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: SpringConceptSection[];
  lab?: string;
  references: SpringConceptReference[];
  related: ConceptLinkRef[];
}

export const SPRING_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'Core Spring & Boot',
  'Spring MVC & Web',
  'Data Access',
  'Reactive',
  'Messaging',
  'Architecture',
  'Spring Security',
  'Spring Batch',
];
