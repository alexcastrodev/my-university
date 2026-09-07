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
  /** Related concepts. `feature` disambiguates where `slug` lives: omitted means "this same
   *  discipline"; `curriculum/<module>/<discipline>` means a different CC discipline;
   *  anything else is a Complementary Studies track name resolved via `FEATURE_ROUTES`
   *  (`../../shared/concept-links`). See `CurriculumConceptView` for the resolution logic. */
  related: (string | { label: string; slug: string; feature?: string })[];
}
