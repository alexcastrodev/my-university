export interface OrderableConcept {
  slug: string;
  id: number;
  requires?: string[];
}

/**
 * Orders concepts so a prerequisite (`requires`) always appears before whatever names it —
 * e.g. "The Set Interface" before "The TreeSet Class" — while preserving today's convention
 * (highest `id` first) as the tiebreak among concepts with no dependency relation to each
 * other. That tiebreak is what keeps this a strict superset of the old behavior: a track
 * with no `requires` filled in anywhere sorts exactly as it did before this existed.
 *
 * An unknown prerequisite slug (typo, or content removed) is ignored rather than treated as
 * unsatisfiable — the item just has one less constraint, not a hard failure. A dependency
 * cycle can't be resolved by a topological sort at all; anything left over once no more
 * items are "ready" is appended in its original relative order rather than dropped.
 */
export function sortByPrerequisites<T extends OrderableConcept>(
  items: readonly T[],
): T[] {
  const bySlug = new Map(items.map((item) => [item.slug, item]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const item of items) {
    indegree.set(item.slug, 0);
    dependents.set(item.slug, []);
  }
  for (const item of items) {
    for (const requiredSlug of item.requires ?? []) {
      if (!bySlug.has(requiredSlug) || requiredSlug === item.slug) continue;
      indegree.set(item.slug, (indegree.get(item.slug) ?? 0) + 1);
      dependents.get(requiredSlug)!.push(item.slug);
    }
  }

  // Kept sorted by id descending, matching the pre-existing convention — a fresh insertion
  // is placed by that same rule rather than pushed to the end.
  const queue = items
    .filter((item) => indegree.get(item.slug) === 0)
    .sort((a, b) => b.id - a.id);

  const order: T[] = [];
  while (queue.length) {
    const next = queue.shift()!;
    order.push(next);
    for (const dependentSlug of dependents.get(next.slug) ?? []) {
      const remaining = (indegree.get(dependentSlug) ?? 0) - 1;
      indegree.set(dependentSlug, remaining);
      if (remaining !== 0) continue;

      const dependentItem = bySlug.get(dependentSlug)!;
      const insertAt = queue.findIndex(
        (queued) => queued.id < dependentItem.id,
      );
      if (insertAt === -1) queue.push(dependentItem);
      else queue.splice(insertAt, 0, dependentItem);
    }
  }

  if (order.length < items.length) {
    const placed = new Set(order.map((item) => item.slug));
    for (const item of items) if (!placed.has(item.slug)) order.push(item);
  }

  return order;
}
