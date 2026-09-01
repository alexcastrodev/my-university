import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface RubyConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface RubyConceptSection {
  title: string;
  content: string;
}

export interface RubyConceptSummary {
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

export interface RubyConcept extends RubyConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: RubyConceptSection[];
  references: RubyConceptReference[];
  related: ConceptLinkRef[];
}
