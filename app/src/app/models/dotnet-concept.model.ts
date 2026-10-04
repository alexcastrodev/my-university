import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface DotNetConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface DotNetConceptSection {
  title: string;
  content: string;
}

export interface DotNetConceptSummary {
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

export interface DotNetConcept extends DotNetConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: DotNetConceptSection[];
  references: DotNetConceptReference[];
  related: ConceptLinkRef[];
}
