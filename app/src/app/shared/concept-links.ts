export type ConceptFeature = 'java-concepts' | 'jvm-concepts' | 'spring-concepts' | 'database-concepts' | 'system-design';

/** A plain string is a free-text mention with no page yet; the object form links to a real concept page. */
export type ConceptLinkRef = string | { label: string; slug: string; feature?: ConceptFeature };

export const FEATURE_ROUTES: Record<ConceptFeature, string> = {
  'java-concepts': '/java/java-concepts',
  'jvm-concepts': '/java/jvm-concepts',
  'spring-concepts': '/spring-concepts',
  'database-concepts': '/databases/database-concepts',
  'system-design': '/system-design/system-design-concepts',
};

export interface ConceptLinkItem {
  label: string;
  route: string[] | null;
}

export function toConceptLinkItem(ref: ConceptLinkRef, defaultFeature: ConceptFeature): ConceptLinkItem {
  if (typeof ref === 'string') return { label: ref, route: null };
  const feature = ref.feature ?? defaultFeature;
  return { label: ref.label, route: [FEATURE_ROUTES[feature], ref.slug] };
}
