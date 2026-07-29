export type SpringConceptCategory = 'Spring Boot' | 'Spring Security' | 'Spring Batch';

export interface SpringConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface SpringConceptSection {
  title: string;
  content: string;
}

export interface SpringConceptSummary {
  slug: string;
  id: number;
  category: SpringConceptCategory;
  title: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
}

export interface SpringConcept extends SpringConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: SpringConceptSection[];
  references: SpringConceptReference[];
  read: boolean;
}
