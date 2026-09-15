/**
 * Groups review-queue items by `module` and round-robins across the groups, so consecutive
 * items in the returned list alternate topic instead of running through one module's whole
 * backlog before moving to the next. This is the interleaving effect (Rohrer & Taylor):
 * spacing alone (SM-2) controls *when* an item comes back, not whether same-topic items
 * cluster together when several become due at once. Within each module, the original
 * relative order is preserved (callers pass items already sorted by `dueAt` ascending, so
 * that means most-overdue-first survives inside each group). Groups round-robin in
 * first-appearance order, so the module holding the single most overdue item still goes
 * first overall.
 */
export function interleaveByModule<T extends { module: string }>(items: T[]): T[] {
  const order: string[] = [];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    let group = groups.get(item.module);
    if (!group) {
      group = [];
      groups.set(item.module, group);
      order.push(item.module);
    }
    group.push(item);
  }

  const result: T[] = [];
  let remaining = items.length;
  for (let round = 0; remaining > 0; round++) {
    for (const module of order) {
      const group = groups.get(module)!;
      if (round < group.length) {
        result.push(group[round]);
        remaining--;
      }
    }
  }
  return result;
}
