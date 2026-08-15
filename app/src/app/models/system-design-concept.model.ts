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

export type SystemDesignConceptLinkFeature = 'system-design' | 'database';

export type SystemDesignConceptLinkRef =
  | string
  | { label: string; slug: string; feature?: SystemDesignConceptLinkFeature };

export interface SystemDesignConceptSummary {
  slug: string;
  id: number;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  difficulty: SystemDesignConceptDifficulty;
  readingTime: number;
  tags: string[];
  prerequisites: SystemDesignConceptLinkRef[];
  related: SystemDesignConceptLinkRef[];
  labUrl?: string;
  read: boolean;
}

export interface SystemDesignConcept extends SystemDesignConceptSummary {
  sections: SystemDesignConceptSection[];
  references: SystemDesignConceptReference[];
}
