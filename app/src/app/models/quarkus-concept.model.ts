import { ConceptLinkRef } from '../shared/concept-links';

export type QuarkusConceptCategory =
  | 'Core Configuration'
  | 'Caching & Auditing'
  | 'Multitenancy'
  | 'Customization & Migration'
  | 'Modern Data Access'
  | 'Extensions & Tooling';

export interface QuarkusConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface QuarkusConceptSection {
  title: string;
  content: string;
}

export interface QuarkusConceptSummary {
  slug: string;
  id: number;
  category: QuarkusConceptCategory;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
}

export interface QuarkusConcept extends QuarkusConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: QuarkusConceptSection[];
  references: QuarkusConceptReference[];
  related: ConceptLinkRef[];
}
