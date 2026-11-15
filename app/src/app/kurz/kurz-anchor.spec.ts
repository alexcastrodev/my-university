import { Block } from '../discussion/block-anchor';
import { blockOfConversation, conversationCounts, conversationsAt } from './kurz-anchor';
import { KurzConversation } from './kurz.model';

const block = (index: number, key: string): Block => ({
  el: document.createElement('p'),
  key,
  index,
  quote: `quote ${index}`,
});

const conversation = (
  id: string,
  anchorKey: string | null,
  blockIndex: number | null,
  updatedAt = '2030-01-01',
): KurzConversation => ({
  id,
  anchorKey,
  blockIndex,
  selection: null,
  stale: false,
  updatedAt,
  messages: [],
});

describe('kurz anchors', () => {
  const blocks = [block(0, 'aaaaaaaa'), block(1, 'bbbbbbbb'), block(2, 'cccccccc')];

  it('finds the paragraph with the same text at the same place', () => {
    expect(blockOfConversation(blocks, conversation('1', 'bbbbbbbb', 1))?.index).toBe(1);
  });

  it('follows a paragraph that moved, by its text', () => {
    expect(blockOfConversation(blocks, conversation('1', 'cccccccc', 0))?.index).toBe(2);
  });

  it('draws nothing for text that changed or for the whole post', () => {
    expect(blockOfConversation(blocks, conversation('1', 'ffffffff', 1))).toBeNull();
    expect(blockOfConversation(blocks, conversation('1', null, null))).toBeNull();
  });

  it('counts the conversations of each paragraph', () => {
    const counts = conversationCounts(blocks, [
      conversation('1', 'aaaaaaaa', 0),
      conversation('2', 'aaaaaaaa', 0),
      conversation('3', 'bbbbbbbb', 1),
      conversation('4', null, null),
    ]);
    expect(counts.get(0)).toBe(2);
    expect(counts.get(1)).toBe(1);
    expect(counts.has(2)).toBeFalse();
  });

  it('lists the conversations of one place, oldest first, and the whole post apart', () => {
    const list = [
      conversation('late', 'aaaaaaaa', 0, '2030-02-01'),
      conversation('whole', null, null),
      conversation('early', 'aaaaaaaa', 0, '2030-01-01'),
      conversation('other', 'bbbbbbbb', 1),
    ];
    expect(conversationsAt(list, 'aaaaaaaa').map((c) => c.id)).toEqual(['early', 'late']);
    expect(conversationsAt(list, null).map((c) => c.id)).toEqual(['whole']);
  });
});
