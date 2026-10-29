import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export type CSharpConceptCategory =
  | 'Language'
  | 'Type Design'
  | 'Base Class Library'
  | 'LINQ'
  | 'Memory & Concurrency';

export interface CSharpConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface CSharpConceptSection {
  title: string;
  content: string;
}

export interface CSharpConceptSummary {
  slug: string;
  id: number;
  category: CSharpConceptCategory;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface CSharpConcept extends CSharpConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: CSharpConceptSection[];
  lab?: string;
  references: CSharpConceptReference[];
  related: ConceptLinkRef[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
export const CSHARP_CONCEPT_TOPIC_ORDER: readonly string[] = [
  // Language
  'Language Basics',
  'Strings & Formatting',
  'Numbers & Conversions',
  'Operators & Control Flow',
  'Pattern Matching',
  'Exceptions',
  'Methods & Lambdas',
  // Type Design
  'Classes & Members',
  'Properties & Initialization',
  'Records & Equality',
  'Inheritance & Polymorphism',
  'Interfaces & Generics',
  'Delegates & Events',
  'Nullability',
  'Extension Members',
  // Base Class Library
  'Text & Regex',
  'Common Types',
  'Collections',
  'Files & I/O',
  'Streams',
  'Serialization',
  'Reflection & Attributes',
  // LINQ
  'LINQ',
  // Memory & Concurrency
  'Memory & Value Semantics',
  'Interop & Unsafe',
  'Threads',
];
