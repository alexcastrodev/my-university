import { ConceptLinkRef } from '../shared/concept-links';

export type DatabaseConceptCategory = 'PostgreSQL' | 'SQL' | 'MongoDB' | 'DynamoDB' | 'Cassandra';

export interface DatabaseConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface DatabaseConceptSection {
  title: string;
  content: string;
}

export interface DatabaseConceptSummary {
  slug: string;
  id: number;
  category: DatabaseConceptCategory;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
}

export interface DatabaseConcept extends DatabaseConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: DatabaseConceptSection[];
  references: DatabaseConceptReference[];
  related: ConceptLinkRef[];
}
