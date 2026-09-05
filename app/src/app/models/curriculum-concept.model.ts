import { Language } from './language.model';

export interface CurriculumConceptSummary {
  slug: string;
  id: number;
  title: string;
  summary: string;
  publishedAt: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface CurriculumConceptDetail extends CurriculumConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: { title: string; content: string }[];
  references: { label: string; url: string; type: 'video' | 'doc' }[];
  /** Related concepts within the same module/discipline — cross-module related links
   *  aren't supported yet (see tasks.md). */
  related: (string | { label: string; slug: string })[];
}
