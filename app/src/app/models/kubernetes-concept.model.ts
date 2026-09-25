import { ConceptLinkRef } from '../shared/concept-links';
import { Language } from './language.model';

export type KubernetesConceptCategory = 'Secrets & Configuration';

export interface KubernetesConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface KubernetesConceptSection {
  title: string;
  content: string;
}

export interface KubernetesConceptSummary {
  slug: string;
  id: number;
  category: KubernetesConceptCategory;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface KubernetesConcept extends KubernetesConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: KubernetesConceptSection[];
  references: KubernetesConceptReference[];
  related: ConceptLinkRef[];
}
