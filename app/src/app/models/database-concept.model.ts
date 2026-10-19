import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export type DatabaseConceptCategory = 'PostgreSQL' | 'SQL' | 'MongoDB' | 'DynamoDB' | 'Cassandra' | 'Redis' | 'Neo4j' | 'HBase' | 'CouchDB';

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
  language: Language;
  availableLanguages: Language[];
}

export interface DatabaseConcept extends DatabaseConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: DatabaseConceptSection[];
  references: DatabaseConceptReference[];
  related: ConceptLinkRef[];
}

/** Everyday SQL querying first, then advanced patterns, then MongoDB's document model
 *  and indexing, then DynamoDB's modeling approach, then Cassandra's distributed core,
 *  then Redis's data types/patterns, then Neo4j/HBase/CouchDB's own models, then
 *  Postgres ops/infra. */
export const DATABASE_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'Query Techniques',
  'Joins & Set Operations',
  'Window Functions & Analytics',
  'Date & Time',
  'String & Text Processing',
  'Advanced Query Patterns',
  'Document Model',
  'Indexing & Performance',
  'Graph Fundamentals',
  'Wide-Column Fundamentals',
  'Transactions & Consistency',
  'High Availability',
  'Scaling & Sharding',
  'Fundamentals',
  'Data Modeling',
  'Key Design & Partitioning',
  'Relationship Strategies',
  'Advanced Mechanics',
  'API & Access Patterns',
  'Evolution & Migration',
  'Consistency & Replication',
  'Indexing & Extending Designs',
  'Data Types & Commands',
  'Application Patterns',
  'Coordination Primitives',
  'Durability & Persistence',
  'Security',
  'Modern Redis Capabilities',
  'Scaling & Topology',
  'Configuration & Tuning',
  'Monitoring & Troubleshooting',
  'HA & Replication',
];
