export type DatabaseConceptCategory = 'PostgreSQL' | 'SQL';

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
}
