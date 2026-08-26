import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface JavaConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface JavaConceptSection {
  title: string;
  content: string;
}

export interface JavaConceptSummary {
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

export interface JavaConcept extends JavaConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: JavaConceptSection[];
  references: JavaConceptReference[];
  related: ConceptLinkRef[];
}
