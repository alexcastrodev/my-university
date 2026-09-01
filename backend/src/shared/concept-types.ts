/** A plain string is a free-text mention with no page yet; the object form links to a real concept page. */
export type ConceptLinkRef =
  | string
  | { label: string; slug: string; feature?: string };

/**
 * The reference/citation shape every concept module uses. system-design-concepts is the one
 * exception — its content cites books, papers, and engineering blog posts alongside docs and
 * videos, so it keeps its own wider `type` union (`SystemDesignConceptReference`) instead of
 * this one.
 */
export interface ConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}
