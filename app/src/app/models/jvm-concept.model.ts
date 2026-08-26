import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface JvmConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface JvmConceptSection {
  title: string;
  content: string;
}

export interface JvmConceptSummary {
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

export interface JvmConcept extends JvmConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: JvmConceptSection[];
  references: JvmConceptReference[];
  related: ConceptLinkRef[];
}
