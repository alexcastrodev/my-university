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
  references: DotNetTestingConceptReference[];
  related: ConceptLinkRef[];
}
