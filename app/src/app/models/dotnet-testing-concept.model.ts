import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface DotNetTestingConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface DotNetTestingConceptSection {
  title: string;
  content: string;
}

export interface DotNetTestingConceptSummary {
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

export interface DotNetTestingConcept extends DotNetTestingConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: DotNetTestingConceptSection[];
  lab?: string;
  references: DotNetTestingConceptReference[];
  related: ConceptLinkRef[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
export const DOTNET_TESTING_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'MSTest Fundamentals',
  'Test Doubles',
  'Time & Async',
  'ASP.NET Core Testing',
  'Data Access Testing',
  'Blazor',
  'Tooling & CI',
  'DDD',
  'Application Architecture',
];
