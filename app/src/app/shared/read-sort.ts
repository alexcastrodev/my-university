export type ReadSortOrder = 'default' | 'unread-first' | 'read-first';

export const READ_SORT_OPTIONS: { label: string; value: ReadSortOrder }[] = [
  { label: 'sort.default', value: 'default' },
  { label: 'sort.unreadFirst', value: 'unread-first' },
  { label: 'sort.readFirst', value: 'read-first' },
];

/**
 * Stable sort by read status; leaves relative order within each group untouched.
 *
 * Also stamps each item with its 1-based `sequence` position in the array as given —
 * i.e. the curriculum's actual prerequisite order, since callers always pass the
 * backend's `sortByPrerequisites` order in before any read-status re-sort is applied.
 * Stamping happens before reordering so a concept's sequence number stays tied to
 * where it really sits in the curriculum even when "unread first"/"read first"
 * visually moves it elsewhere — the number answers "which lesson is this", not
 * "which position is it on screen right now".
 */
export function sortByRead<T extends { read: boolean }>(
  items: readonly T[],
  order: ReadSortOrder,
): (T & { sequence: number })[] {
  const numbered = items.map((item, index) => ({ ...item, sequence: index + 1 }));
  if (order === 'default') return numbered;
  numbered.sort((a, b) => {
    const diff = Number(a.read) - Number(b.read);
    return order === 'unread-first' ? diff : -diff;
  });
  return numbered;
}
