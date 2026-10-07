export const MAX_BODY_LENGTH = 2000;
export const MAX_QUOTE_LENGTH = 240;
/** Comments one user may post per minute, across every thread. */
export const POSTS_PER_MINUTE = 10;

/** Letters and digits only, lowercased: robust to markdown punctuation and to rendering differences. */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** What the reader actually sees for the inline syntax that adds text the rendered page does not show. */
function renderedText(markdown: string): string {
  return markdown
    .replace(/\{\{([^{}]+)\}\}\[\^[\w-]+\]/g, '$1')
    .replace(/\[\[[^[\]|]+\|([^[\]]+)\]\]/g, '$1')
    .replace(/\[\[([^[\]]+)\]\]/g, '$1')
    .replace(/\]\([^)]*\)/g, ']');
}

const MATCH_CHARS = 30;
const MIN_MATCH_CHARS = 8;

/**
 * Whether the start of `quote` really is text of the concept. The client sends the quote of the
 * block it marked; checking it keeps junk markers out and stops a forged "citation" from being
 * shown on top of a discussion. Only the first 30 letters and digits are compared, because the
 * quote is the beginning of a block and that is the part least affected by inline markup.
 * ponytail: a quote that begins inside an odd inline construct can miss; widen renderedText() if so.
 */
export function quoteAppearsIn(
  sections: { content: string }[],
  quote: string,
): boolean {
  const needle = normalizeForMatch(quote).slice(0, MATCH_CHARS);
  if (needle.length < MIN_MATCH_CHARS) return false;
  const haystack = normalizeForMatch(
    renderedText(sections.map((s) => s.content).join('\n')),
  );
  return haystack.includes(needle);
}

export interface CommentRow {
  id: number;
  parentId: number | null;
  authorId: number | null;
  authorName: string | null;
  authorAvatar: string | null;
  body: string;
  deletedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  acceptedReplyId: number | null;
}

export interface VoteInfo {
  count: number;
  mine: boolean;
}

export interface CommentView {
  id: number;
  body: string;
  deleted: boolean;
  author: { id: number; displayName: string; avatarUrl: string } | null;
  createdAt: Date;
  editedAt: Date | null;
  votes: number;
  votedByMe: boolean;
  mine: boolean;
}

export interface ThreadView {
  root: CommentView;
  replies: CommentView[];
  resolved: boolean;
  acceptedReplyId: number | null;
}

/**
 * Turns the flat rows of one marker into threads, oldest thread first. A removed root stays as a
 * tombstone while it still has replies; removed replies and empty tombstones are dropped. The
 * accepted reply leads its thread, then the most voted, then the oldest.
 */
export function assembleThreads(
  rows: CommentRow[],
  votes: Map<number, VoteInfo>,
  viewerId: number | null,
): ThreadView[] {
  const view = (row: CommentRow): CommentView => {
    const deleted = row.deletedAt !== null;
    const vote = votes.get(row.id);
    return {
      id: row.id,
      body: deleted ? '' : row.body,
      deleted,
      author:
        deleted || row.authorId === null
          ? null
          : {
              id: row.authorId,
              displayName: row.authorName ?? '',
              avatarUrl: row.authorAvatar ?? '',
            },
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      votes: deleted ? 0 : (vote?.count ?? 0),
      votedByMe: !deleted && (vote?.mine ?? false),
      mine: !deleted && viewerId !== null && row.authorId === viewerId,
    };
  };

  const byAge = (a: CommentRow, b: CommentRow) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id;

  const repliesByRoot = new Map<number, CommentRow[]>();
  for (const row of rows) {
    if (row.parentId === null || row.deletedAt) continue;
    const list = repliesByRoot.get(row.parentId) ?? [];
    list.push(row);
    repliesByRoot.set(row.parentId, list);
  }

  return rows
    .filter((row) => row.parentId === null)
    .sort(byAge)
    .flatMap((root) => {
      const replies = repliesByRoot.get(root.id) ?? [];
      if (root.deletedAt && replies.length === 0) return [];
      const accepted = root.deletedAt ? null : root.acceptedReplyId;
      replies.sort((a, b) => {
        if (a.id === accepted) return -1;
        if (b.id === accepted) return 1;
        return (
          (votes.get(b.id)?.count ?? 0) - (votes.get(a.id)?.count ?? 0) ||
          byAge(a, b)
        );
      });
      return [
        {
          root: view(root),
          replies: replies.map(view),
          resolved: accepted !== null && replies.some((r) => r.id === accepted),
          acceptedReplyId: accepted,
        },
      ];
    });
}
