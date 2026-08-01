import { sortByRead } from './read-sort';

interface Item {
  slug: string;
  read: boolean;
}

const ITEMS: Item[] = [
  { slug: 'a', read: false },
  { slug: 'b', read: true },
  { slug: 'c', read: false },
  { slug: 'd', read: true },
];

describe('sortByRead', () => {
  it('leaves the original order untouched for "default"', () => {
    expect(sortByRead(ITEMS, 'default').map((i) => i.slug)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts unread items first, read items last, preserving relative order within each group', () => {
    expect(sortByRead(ITEMS, 'unread-first').map((i) => i.slug)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('puts read items first, unread items last, preserving relative order within each group', () => {
    expect(sortByRead(ITEMS, 'read-first').map((i) => i.slug)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('does not mutate the input array', () => {
    const copy = [...ITEMS];
    sortByRead(ITEMS, 'read-first');
    expect(ITEMS).toEqual(copy);
  });
});
