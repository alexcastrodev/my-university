import { Language } from './language.model';

export type AlgorithmsConceptCategory =
  | 'Fundamentals'
  | 'Sorting'
  | 'Data Structures'
  | 'Graphs'
  | 'Strings'
  | 'Dynamic Programming & Greedy';

export interface AlgorithmsConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface AlgorithmsConceptSection {
  title: string;
  content: string;
}

export interface AlgorithmsConceptSummary {
  slug: string;
  id: number;
  category: AlgorithmsConceptCategory;
  topic: string;
  title: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface AlgorithmsConcept extends AlgorithmsConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: AlgorithmsConceptSection[];
  references: AlgorithmsConceptReference[];
}

/** Analysis and the basic toolkit first, then data structures and strings, the graph sessions
 *  together, then dynamic programming, and the theory-heavy sessions last. */
export const ALGORITHMS_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'Analyzing Algorithms',
  'Sorting',
  'Searching Techniques and Number Theory',
  'Data Structures',
  'Strings',
  'Graph Traversal and Orderings',
  'Shortest Paths',
  'Flow and Matching',
  'Dynamic Programming, Greedy and Search',
  'Hardness and Approximation',
  'Optimization and Machine Learning',
];
