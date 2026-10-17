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

/** Which markers the feed lists: every one, the ones whose thread the viewer opened, or any they commented on. */
export const FEED_SCOPES = ['all', 'mine', 'participated'] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];
export const FEED_DEFAULT_LIMIT = 20;
export const FEED_MAX_LIMIT = 50;

/**
 * Keyset position in the feed: the last row's activity time and id. `at` is Postgres' own text of
 * the timestamp (microseconds), not a JS Date, which would round to milliseconds and make the
 * next page skip or repeat rows that share the millisecond.
 */
export interface FeedCursor {
  at: string;
  id: number;
}

const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id])).toString(
    'base64url',
  );
}

/** The cursor a previous page handed out, or null when it is not one of ours. */
export function decodeFeedCursor(raw: string): FeedCursor | null {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [at, id] = value as unknown[];
    if (typeof at !== 'string' || !CURSOR_AT.test(at)) return null;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)
      return null;
    return { at, id };
  } catch {
    return null;
  }
}

/**
 * Cuts one page out of rows fetched with `limit + 1`, already ordered by activity then id, both
 * descending. The extra row only says there is more; the cursor points at the last row kept.
 */
export function feedPage<T extends { cursorAt: string; id: number }>(
  rows: T[],
  limit: number,
): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { rows, nextCursor: null };
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: encodeFeedCursor({ at: last.cursorAt, id: last.id }),
  };
}

/**
 * `topicKey` prefix -> area, most specific first (the order `fromSourceId` resolves in). A Computer
 * Science concept (`concept-read:cc:<module>:<discipline>:<slug>`) has its curriculum module as area,
 * written here as null: the area is read from the key itself.
 */
export function areaPrefixes(
  modules: readonly { module: string; sourceType: string; prefix: string }[],
): [prefix: string, area: string | null][] {
  const tracks = modules
    .map((m): [string, string] => [`${m.sourceType}:${m.prefix}`, m.module])
    .sort((a, b) => b[0].length - a[0].length);
  return [['concept-read:cc:', null], ...tracks];
}

/** SQL expression for the area of the topic key in `column`, so the feed can filter and count by it. */
export function areaSql(
  prefixes: [string, string | null][],
  column: string,
): string {
  const branches = prefixes.map(([prefix, area]) => {
    // Prefixes and areas come from code constants; the guard keeps them safe as SQL literals.
    if (!/^[a-z0-9:-]+$/.test(`${prefix}${area ?? ''}`))
      throw new Error(`unsafe area prefix ${prefix}`);
    const then = area === null ? `split_part(${column}, ':', 3)` : `'${area}'`;
    return `WHEN ${column} LIKE '${prefix}%' THEN ${then}`;
  });
  return `CASE ${branches.join(' ')} END`;
}

/** Anchor of the marker that holds a concept's lab discussion; never a hash, so it cannot clash with a paragraph. */
export const LAB_ANCHOR = 'lab';
