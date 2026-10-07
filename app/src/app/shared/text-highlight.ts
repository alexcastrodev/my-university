/**
 * Shareable text highlights: the selected passage is encoded in the URL
 * (`?hl=` and, for long passages, `?hle=`) and re-located in the rendered
 * content when someone opens that link.
 *
 * Matching ignores whitespace entirely, because `Selection.toString()` inserts
 * line breaks between block elements that the DOM text nodes don't have.
 */

export const HIGHLIGHT_START_PARAM = 'hl';
export const HIGHLIGHT_END_PARAM = 'hle';

/** Passages longer than this are encoded as a start and an end snippet. */
const MAX_INLINE_LENGTH = 150;
const SNIPPET_WORDS = 8;

export interface HighlightParams {
  start: string;
  end?: string;
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
  url.searchParams.set(HIGHLIGHT_START_PARAM, params.start);
  if (params.end) url.searchParams.set(HIGHLIGHT_END_PARAM, params.end);
  return url.toString();
}

export function readHighlightParams(search: string): HighlightParams | null {
  const query = new URLSearchParams(search);
  const start = query.get(HIGHLIGHT_START_PARAM)?.trim();
  if (!start) return null;
  const end = query.get(HIGHLIGHT_END_PARAM)?.trim();
  return end ? { start, end } : { start };
}

interface CharPosition {
  node: Text;
  offset: number;
}

/** Finds the passage described by `params` inside `roots`, in document order. */
export function findHighlightRange(roots: Element[], params: HighlightParams): Range | null {
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

  const haystack = chars.join('');
  const start = stripWhitespace(params.start);
  if (!start) return null;

  const startIndex = haystack.indexOf(start);
  if (startIndex === -1) return null;

  let endIndex = startIndex + start.length - 1;
  if (params.end) {
    const end = stripWhitespace(params.end);
    const endMatch = end ? haystack.indexOf(end, startIndex + start.length) : -1;
    if (endMatch === -1) return null;
    endIndex = endMatch + end.length - 1;
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
