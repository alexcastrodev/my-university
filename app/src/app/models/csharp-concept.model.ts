import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface CSharpConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface CSharpConceptSection {
  title: string;
  content: string;
}

export interface CSharpConceptSummary {
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

export interface CSharpConcept extends CSharpConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: CSharpConceptSection[];
  references: CSharpConceptReference[];
  related: ConceptLinkRef[];
}
