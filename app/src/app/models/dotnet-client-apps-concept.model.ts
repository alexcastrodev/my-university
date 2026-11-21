import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface DotnetClientAppsConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface DotnetClientAppsConceptSection {
  title: string;
  content: string;
}

export interface DotnetClientAppsConceptSummary {
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

export interface DotnetClientAppsConcept extends DotnetClientAppsConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: DotnetClientAppsConceptSection[];
  lab?: string;
  references: DotnetClientAppsConceptReference[];
  related: ConceptLinkRef[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
export const DOTNET_CLIENT_APPS_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'MVVM & Data Binding',
  'UI Frameworks',
];
