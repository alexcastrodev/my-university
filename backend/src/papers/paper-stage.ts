import { PAPER_TYPES } from './paper.entity';
import type { PaperType } from './paper.entity';

/**
 * Where a paper stands, in terms a reader without an academic background can use (#201): a preprint has not
 * been checked by other experts yet, a published article or conference paper normally has, a thesis was
 * examined by a university, a report is whatever its institution or company says it is.
 */
export const PUBLICATION_STAGES = [
  'preprint',
  'published',
  'thesis',
  'report',
  'unknown',
] as const;
export type PublicationStage = (typeof PUBLICATION_STAGES)[number];

/**
 * It follows from the type and nothing else, so every client says the same thing. The stage only says what
 * kind of venue the paper appeared in; it never claims that a review of this particular paper took place.
 */
const STAGE_OF_TYPE: Record<PaperType, PublicationStage> = {
  'journal-article': 'published',
  'conference-paper': 'published',
  'book-chapter': 'published',
  book: 'published',
  preprint: 'preprint',
  thesis: 'thesis',
  report: 'report',
  other: 'unknown',
};

export const stageOf = (type: PaperType): PublicationStage =>
  STAGE_OF_TYPE[type];

/** The types that make up a stage, for the catalog filter. */
export const typesOfStage = (stage: PublicationStage): PaperType[] =>
  PAPER_TYPES.filter((type) => STAGE_OF_TYPE[type] === stage);
