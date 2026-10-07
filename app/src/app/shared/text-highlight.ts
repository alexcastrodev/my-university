/**
 * Shareable text highlights: the selected passage is encoded in the URL
 * (`?hl=` and, for long passages, `?hle=`) and re-located in the rendered
 * content when someone opens that link.
 *
 * `?hlp=X-Y` pins the passage to character offsets (whitespace excluded) so a
 * common word is not matched at its first occurrence; the text is kept to
 * verify the offsets. When the content changed, `?hlb=`/`?hla=` (the text just
 * before and after) pick the right occurrence in the fallback search.
 *
 * Matching ignores whitespace entirely, because `Selection.toString()` inserts
 * line breaks between block elements that the DOM text nodes don't have.
 */

export const HIGHLIGHT_START_PARAM = 'hl';
export const HIGHLIGHT_END_PARAM = 'hle';
export const HIGHLIGHT_POS_PARAM = 'hlp';
export const HIGHLIGHT_BEFORE_PARAM = 'hlb';
export const HIGHLIGHT_AFTER_PARAM = 'hla';

/** Passages longer than this are encoded as a start and an end snippet. */
const MAX_INLINE_LENGTH = 150;
const SNIPPET_WORDS = 8;
/** Characters (whitespace excluded) kept on each side of the passage to disambiguate repeats. */
const CONTEXT_CHARS = 32;

export interface HighlightParams {
  start: string;
  end?: string;
  /** Inclusive offsets of the passage in the whitespace-stripped content. */
  from?: number;
  to?: number;
  /** Whitespace-stripped text right before / after the passage. */
  before?: string;
  after?: string;
}

export function buildHighlightParams(selectedText: string): HighlightParams | null {
  const text = selectedText.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= MAX_INLINE_LENGTH) return { start: text };

  const words = text.split(' ');
  if (words.length <= SNIPPET_WORDS * 2) return { start: text };

  return {
    start: words.slice(0, SNIPPET_WORDS).join(' '),
    end: words.slice(-SNIPPET_WORDS).join(' '),
  };
}

export function buildHighlightUrl(pageUrl: string, params: HighlightParams): string {
  const url = new URL(pageUrl);
  url.hash = '';
  url.searchParams.delete(HIGHLIGHT_START_PARAM);
  url.searchParams.delete(HIGHLIGHT_END_PARAM);
  url.searchParams.delete(HIGHLIGHT_POS_PARAM);
  url.searchParams.delete(HIGHLIGHT_BEFORE_PARAM);
  url.searchParams.delete(HIGHLIGHT_AFTER_PARAM);
  url.searchParams.set(HIGHLIGHT_START_PARAM, params.start);
  if (params.end) url.searchParams.set(HIGHLIGHT_END_PARAM, params.end);
  if (params.before) url.searchParams.set(HIGHLIGHT_BEFORE_PARAM, params.before);
  if (params.after) url.searchParams.set(HIGHLIGHT_AFTER_PARAM, params.after);
  if (params.from !== undefined && params.to !== undefined) {
    url.searchParams.set(HIGHLIGHT_POS_PARAM, `${params.from}-${params.to}`);
  }
  return url.toString();
}

export function readHighlightParams(search: string): HighlightParams | null {
  const query = new URLSearchParams(search);
  const start = query.get(HIGHLIGHT_START_PARAM)?.trim();
  if (!start) return null;
  const end = query.get(HIGHLIGHT_END_PARAM)?.trim();
  const params: HighlightParams = end ? { start, end } : { start };
  const pos = /^(\d+)-(\d+)$/.exec(query.get(HIGHLIGHT_POS_PARAM) ?? '');
  if (pos && Number(pos[1]) <= Number(pos[2])) {
    params.from = Number(pos[1]);
    params.to = Number(pos[2]);
  }
  const before = query.get(HIGHLIGHT_BEFORE_PARAM);
  const after = query.get(HIGHLIGHT_AFTER_PARAM);
  if (before) params.before = before;
  if (after) params.after = after;
  return params;
}

interface CharPosition {
  node: Text;
  offset: number;
}

/** Non-whitespace characters of `roots` in document order, with where each one lives. */
function collectChars(roots: Element[]): { haystack: string; positions: CharPosition[] } {
  const chars: string[] = [];
  const positions: CharPosition[] = [];

  for (const root of roots) {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const value = node.data;
      for (let i = 0; i < value.length; i++) {
        if (/\s/.test(value[i])) continue;
        chars.push(value[i]);
        positions.push({ node, offset: i });
      }
    }
  }
  return { haystack: chars.join(''), positions };
}

/** Offsets (inclusive) of the characters fully inside `range`, or null when there are none. */
export function computeHighlightOffsets(
  roots: Element[],
  range: Range,
): Pick<HighlightParams, 'from' | 'to' | 'before' | 'after'> | null {
  const { haystack, positions } = collectChars(roots);
  const inside = (p: CharPosition) =>
    range.isPointInRange(p.node, p.offset) && range.isPointInRange(p.node, p.offset + 1);
  const from = positions.findIndex(inside);
  if (from === -1) return null;
  let to = from;
  for (let i = from + 1; i < positions.length; i++) if (inside(positions[i])) to = i;
  return {
    from,
    to,
    before: haystack.slice(Math.max(0, from - CONTEXT_CHARS), from),
    after: haystack.slice(to + 1, to + 1 + CONTEXT_CHARS),
  };
}

/** Finds the passage described by `params` inside `roots`, in document order. */
export function findHighlightRange(roots: Element[], params: HighlightParams): Range | null {
  const { haystack, positions } = collectChars(roots);
  const start = stripWhitespace(params.start);
  if (!start) return null;
  const end = params.end ? stripWhitespace(params.end) : '';

  let startIndex = -1;
  let endIndex = -1;

  // Exact offsets win, but only if the text there still matches (content may have changed).
  const { from, to } = params;
  if (from !== undefined && to !== undefined && to < haystack.length) {
    const slice = haystack.slice(from, to + 1);
    const matches = end
      ? slice.length >= start.length + end.length && slice.startsWith(start) && slice.endsWith(end)
      : slice === start;
    if (matches) {
      startIndex = from;
      endIndex = to;
    }
  }

  if (startIndex === -1) {
    const before = params.before ? stripWhitespace(params.before) : '';
    const after = params.after ? stripWhitespace(params.after) : '';
    let bestScore = -1;
    for (let i = haystack.indexOf(start); i !== -1; i = haystack.indexOf(start, i + 1)) {
      let last = i + start.length - 1;
      if (end) {
        const endMatch = haystack.indexOf(end, i + start.length);
        if (endMatch === -1) break;
        last = endMatch + end.length - 1;
      }
      // Context that still matches says this is the occurrence that was shared.
      const score =
        (before && haystack.slice(Math.max(0, i - before.length), i) === before ? 1 : 0) +
        (after && haystack.slice(last + 1, last + 1 + after.length) === after ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        startIndex = i;
        endIndex = last;
      }
    }
    if (startIndex === -1) return null;
  }

  const first = positions[startIndex];
  const last = positions[endIndex];
  const range = first.node.ownerDocument.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, '');
}
