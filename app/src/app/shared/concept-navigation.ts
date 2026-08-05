import { computed, signal } from '@angular/core';

export interface ConceptNavEntry {
  slug: string;
}

export function createConceptNavigation<T extends ConceptNavEntry>() {
  const allConcepts = signal<T[]>([]);
  const slug = signal('');

  const currentIndex = computed(() => allConcepts().findIndex((c) => c.slug === slug()));
  const prevConcept = computed(() => {
    const i = currentIndex();
    return i > 0 ? allConcepts()[i - 1] : null;
  });
  const nextConcept = computed(() => {
    const i = currentIndex();
    const list = allConcepts();
    return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  });

  return { allConcepts, slug, currentIndex, prevConcept, nextConcept };
}
