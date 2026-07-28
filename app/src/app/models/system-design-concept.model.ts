export type SystemDesignConceptDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export interface SystemDesignConceptReference {
  label: string;
  url: string;
  type: 'book' | 'paper' | 'engineering' | 'doc' | 'video';
}

export interface SystemDesignConceptSection {
  title: string;
  content: string;
}

export interface SystemDesignConceptSummary {
  slug: string;
  id: number;
  title: string;
  summary: string;
  publishedAt: string;
  difficulty: SystemDesignConceptDifficulty;
  readingTime: number;
  tags: string[];
  prerequisites: string[];
  related: string[];
}

export interface SystemDesignConcept extends SystemDesignConceptSummary {
  sections: SystemDesignConceptSection[];
  references: SystemDesignConceptReference[];
  read: boolean;
}
