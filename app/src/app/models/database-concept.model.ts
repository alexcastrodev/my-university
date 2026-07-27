export type DatabaseConceptCategory = 'PostgreSQL';

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
  summary: string;
  publishedAt: string;
}

export interface DatabaseConcept extends DatabaseConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: DatabaseConceptSection[];
  references: DatabaseConceptReference[];
  read: boolean;
}
