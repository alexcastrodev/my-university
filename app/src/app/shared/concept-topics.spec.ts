import { groupByTopic, orderByTopic } from './concept-topics';

interface Item {
  slug: string;
  topic: string;
}

const ITEMS: Item[] = [
  { slug: 'a', topic: 'Later' },
  { slug: 'b', topic: 'First' },
  { slug: 'c', topic: 'Unknown' },
  { slug: 'd', topic: 'First' },
  { slug: 'e', topic: 'Later' },
];

describe('groupByTopic', () => {
  it('groups in the given topic order, keeping the incoming order inside each topic', () => {
    expect(groupByTopic(ITEMS, ['First', 'Later'])).toEqual([
      { topic: 'First', concepts: [ITEMS[1], ITEMS[3]] },
      { topic: 'Later', concepts: [ITEMS[0], ITEMS[4]] },
      { topic: 'Unknown', concepts: [ITEMS[2]] },
    ]);
  });
});

describe('orderByTopic', () => {
  it('flattens the groups, matching the list page order', () => {
    expect(orderByTopic(ITEMS, ['First', 'Later']).map((i) => i.slug)).toEqual(['b', 'd', 'a', 'e', 'c']);
  });
});
