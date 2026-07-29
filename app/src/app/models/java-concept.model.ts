export interface JavaConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface JavaConceptSection {
  title: string;
  content: string;
}

export interface JavaConceptSummary {
  slug: string;
  id: number;
  title: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
}

export interface JavaConcept extends JavaConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: JavaConceptSection[];
  references: JavaConceptReference[];
  read: boolean;
}
