import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export interface IdentityConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface IdentityConceptSection {
  title: string;
  content: string;
}

export interface IdentityConceptSummary {
  slug: string;
  id: number;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface IdentityConcept extends IdentityConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: IdentityConceptSection[];
  lab?: string;
  references: IdentityConceptReference[];
  related: ConceptLinkRef[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
export const IDENTITY_CONCEPT_TOPIC_ORDER: readonly string[] = [
  'Foundations',
  'Authentication Factors',
  'Federation & SSO',
  'Directory Services',
  'OAuth & OIDC',
  'Authorization Models',
  'Provisioning & Lifecycle',
  'Workload Identity',
];
