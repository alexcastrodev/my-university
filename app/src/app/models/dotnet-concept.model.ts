import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export type DotNetConceptCategory =
  | 'Platform & Tooling'
  | 'ASP.NET Core'
  | 'Blazor'
  | 'Data Access'
  | 'Architecture'
  | 'Concurrency & Background Work';

export interface DotNetConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface DotNetConceptSection {
  title: string;
  content: string;
}

export interface DotNetConceptSummary {
  slug: string;
  id: number;
  category: DotNetConceptCategory;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface DotNetConcept extends DotNetConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: DotNetConceptSection[];
  lab?: string;
  references: DotNetConceptReference[];
  related: ConceptLinkRef[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
export const DOTNET_CONCEPT_TOPIC_ORDER: readonly string[] = [
  // Platform & Tooling
  'Runtime & SDK',
  'Project System',
  'NuGet & Packaging',
  'Publishing & Native AOT',
  // ASP.NET Core
  'ASP.NET Core Fundamentals',
  'Hosting & Pipeline',
  'Minimal APIs',
  'API Documentation',
  'HTTP Clients',
  'Security',
  // Blazor
  'Blazor Fundamentals',
  'Components & Forms',
  // Data Access
  'Data Access Choices',
  'EF Core',
  'EF Core Modeling',
  'EF Core Querying',
  'Migrations',
  // Architecture
  'Application Architecture',
  'Modular Architecture',
  'DDD',
  // Concurrency & Background Work
  'Background Jobs',
  'Concurrency',
];
