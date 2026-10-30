import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface DotNetAiConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface DotNetAiConceptSection {
  title: string;
  content: string;
}

export interface DotNetAiConceptSummary {
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

export interface DotNetAiConcept extends DotNetAiConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: DotNetAiConceptSection[];
  lab?: string;
  references: DotNetAiConceptReference[];
  related: ConceptLinkRef[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
export const DOTNET_AI_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'Microsoft.Extensions.AI',
  'Agents & Tools',
  'Data & RAG',
  'Operations',
];
