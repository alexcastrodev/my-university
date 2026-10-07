import { describe, it, expect } from 'vitest';
import {
  assembleThreads,
  CommentRow,
  normalizeForMatch,
  quoteAppearsIn,
  VoteInfo,
} from '../src/discussion/discussion.logic';

const sections = [
  {
    content:
      'An aggregate keeps its invariants inside **one transaction**. See [the docs](https://example.com/x) and ' +
      '{{outbox}}[^outbox] or [[other-concept|the other concept]] for more.\n\n```csharp\nawait db.SaveChangesAsync(ct);\n```',
  },
];

describe('quoteAppearsIn', () => {
  it('matches the start of a rendered paragraph regardless of markup and punctuation', () => {
    expect(
      quoteAppearsIn(
        sections,
        'An aggregate keeps its invariants inside one transaction.',
      ),
    ).toBe(true);
    expect(
      quoteAppearsIn(
        sections,
        'See the docs and outbox or the other concept for more.',
      ),
    ).toBe(true);
  });

  it('matches code blocks', () => {
    expect(quoteAppearsIn(sections, 'await db.SaveChangesAsync(ct);')).toBe(
      true,
    );
  });

  it('rejects text that is not in the concept', () => {
    expect(
      quoteAppearsIn(sections, 'Send your password to this address please'),
    ).toBe(false);
  });

  it('rejects quotes too short to mean anything', () => {
    expect(quoteAppearsIn(sections, 'An')).toBe(false);
    expect(quoteAppearsIn(sections, '   ')).toBe(false);
  });

  it('is case and accent aware only through letters and digits', () => {
    expect(normalizeForMatch('Ação, 2x!')).toBe('ação2x');
  });
});

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 7, 12, minutes));
const row = (over: Partial<CommentRow> & { id: number }): CommentRow => ({
  parentId: null,
  authorId: 1,
  authorName: 'Ana',
  authorAvatar: '',
  body: `body ${over.id}`,
  deletedAt: null,
  editedAt: null,
  createdAt: at(over.id),
  acceptedReplyId: null,
  ...over,
});

describe('assembleThreads', () => {
  const votes = new Map<number, VoteInfo>([
    [3, { count: 2, mine: false }],
    [4, { count: 9, mine: true }],
  ]);

  it('orders threads oldest first and replies by votes then age', () => {
    const rows = [
      row({ id: 10 }),
      row({ id: 1 }),
      row({ id: 2, parentId: 1 }),
      row({ id: 3, parentId: 1 }),
      row({ id: 4, parentId: 1 }),
    ];
    const threads = assembleThreads(rows, votes, null);
    expect(threads.map((t) => t.root.id)).toEqual([1, 10]);
    expect(threads[0].replies.map((r) => r.id)).toEqual([4, 3, 2]);
  });

  it('puts the accepted reply first and marks the thread resolved', () => {
    const rows = [
      row({ id: 1, acceptedReplyId: 2 }),
      row({ id: 2, parentId: 1 }),
      row({ id: 4, parentId: 1 }),
    ];
    const [thread] = assembleThreads(rows, votes, null);
    expect(thread.resolved).toBe(true);
    expect(thread.replies.map((r) => r.id)).toEqual([2, 4]);
  });

  it('does not report a thread as resolved when the accepted reply is gone', () => {
    const rows = [
      row({ id: 1, acceptedReplyId: 2 }),
      row({ id: 2, parentId: 1, deletedAt: at(30) }),
    ];
    const [thread] = assembleThreads(rows, votes, null);
    expect(thread.resolved).toBe(false);
    expect(thread.replies).toEqual([]);
  });

  it('keeps a removed root as a tombstone only while it has replies', () => {
    const withReply = [
      row({ id: 1, deletedAt: at(30) }),
      row({ id: 2, parentId: 1 }),
    ];
    const [tombstone] = assembleThreads(withReply, votes, null);
    expect(tombstone.root).toMatchObject({
      deleted: true,
      body: '',
      author: null,
      votes: 0,
    });
    expect(tombstone.replies).toHaveLength(1);

    expect(
      assembleThreads([row({ id: 1, deletedAt: at(30) })], votes, null),
    ).toEqual([]);
  });

  it("flags the viewer's own comments and votes, and nobody else's", () => {
    const rows = [
      row({ id: 1, authorId: 7 }),
      row({ id: 4, parentId: 1, authorId: 8 }),
    ];
    const mine = assembleThreads(rows, votes, 7)[0];
    expect(mine.root.mine).toBe(true);
    expect(mine.replies[0]).toMatchObject({
      mine: false,
      votedByMe: true,
      votes: 9,
    });
    expect(assembleThreads(rows, votes, null)[0].root.mine).toBe(false);
  });

  it('shows no author for an account that no longer exists', () => {
    const [thread] = assembleThreads(
      [row({ id: 1, authorId: null, authorName: null })],
      votes,
      7,
    );
    expect(thread.root.author).toBeNull();
    expect(thread.root.body).toBe('body 1');
  });
});
