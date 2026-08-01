export type ReadSortOrder = 'default' | 'unread-first' | 'read-first';

export const READ_SORT_OPTIONS: { label: string; value: ReadSortOrder }[] = [
  { label: 'Default', value: 'default' },
  { label: 'Unread first', value: 'unread-first' },
  { label: 'Read first', value: 'read-first' },
];

/** Stable sort by read status; leaves relative order within each group untouched. */
export function sortByRead<T extends { read: boolean }>(items: readonly T[], order: ReadSortOrder): T[] {
  if (order === 'default') return [...items];
  const sorted = [...items];
  sorted.sort((a, b) => {
    const diff = Number(a.read) - Number(b.read);
    return order === 'unread-first' ? diff : -diff;
  });
  return sorted;
}
