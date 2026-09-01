import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface RubyOnRailsConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface RubyOnRailsConceptSection {
  title: string;
  content: string;
}

export interface RubyOnRailsConceptSummary {
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

export interface RubyOnRailsConcept extends RubyOnRailsConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: RubyOnRailsConceptSection[];
  references: RubyOnRailsConceptReference[];
  related: ConceptLinkRef[];
}
