import { TranslationKey } from './i18n/translations';

export type ReadSortOrder = 'default' | 'unread-first' | 'read-first';

export const READ_SORT_OPTIONS: { label: TranslationKey; value: ReadSortOrder }[] = [
  { label: 'sort.default', value: 'default' },
  { label: 'sort.unreadFirst', value: 'unread-first' },
  { label: 'sort.readFirst', value: 'read-first' },
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
