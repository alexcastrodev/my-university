import { ConceptLinkRef } from '../shared/concept-links';

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
}

export interface RubyConcept extends RubyConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: RubyConceptSection[];
  references: RubyConceptReference[];
  related: ConceptLinkRef[];
}
