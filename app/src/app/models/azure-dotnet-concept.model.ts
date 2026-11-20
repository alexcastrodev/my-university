import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface AzureDotnetConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface AzureDotnetConceptSection {
  title: string;
  content: string;
}

export interface AzureDotnetConceptSummary {
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

export interface AzureDotnetConcept extends AzureDotnetConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: AzureDotnetConceptSection[];
  lab?: string;
  references: AzureDotnetConceptReference[];
  related: ConceptLinkRef[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
export const AZURE_DOTNET_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'Azure SDK & Identity',
  'Serverless',
  'Messaging',
  'Secrets & Config',
  'NoSQL',
  'Storage',
];
