import { BlockAnchor, MarkerSummary } from './discussion.model';

/** Elements that count as a "paragraph" for discussions: the units the mockups put a marker on. */
const BLOCK_TAGS = new Set(['P', 'PRE', 'UL', 'OL', 'BLOCKQUOTE']);
const QUOTE_LENGTH = 80;
/** The server refuses quotes with fewer letters and digits than this, so such blocks get no marker. */
const MIN_TEXT = 8;
const MATCH_CHARS = 30;

export interface Block extends BlockAnchor {
  el: HTMLElement;
}

/** Letters and digits only, lowercased: the same normalization the server compares quotes with. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** cyrb53: a small, fast, well-spread string hash. Not for security, only to tell blocks apart. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** The commentable blocks of the page, in reading order across every `.section-body`. */
export function collectBlocks(root: ParentNode): Block[] {
  const blocks: Block[] = [];
  root.querySelectorAll('.section-body').forEach((body) => {
    for (const child of Array.from(body.children)) {
      if (!BLOCK_TAGS.has(child.tagName)) continue;
      const text = child.textContent ?? '';
      const normalized = normalizeText(text);
      if (normalized.length < MIN_TEXT) continue;
      blocks.push({
        el: child as HTMLElement,
        key: hashText(normalized),
        index: blocks.length,
        quote: text.replace(/\s+/g, ' ').trim().slice(0, QUOTE_LENGTH),
      });
    }
  });
  return blocks;
}

export interface MarkerMatch {
  byBlock: Map<number, MarkerSummary>;
  /** Markers whose paragraph can no longer be found, usually because the text was edited. */
  orphans: MarkerSummary[];
}

/**
 * Pins each marker to a block. Content is edited often, so an exact hit (same text, same
 * position) is tried first for every marker, then the same text elsewhere (a paragraph that
 * moved), then the same opening words (a paragraph that was edited). What matches nothing is
 * an orphan, still listed so its discussion is not lost.
 */
export function matchMarkers(blocks: Block[], markers: MarkerSummary[]): MarkerMatch {
  const byBlock = new Map<number, MarkerSummary>();
  const pending: MarkerSummary[] = [];

  for (const marker of markers) {
    const exact = blocks.find(
      (b) => b.key === marker.anchorKey && b.index === marker.blockIndex && !byBlock.has(b.index),
    );
    if (exact) byBlock.set(exact.index, marker);
    else pending.push(marker);
  }

  const orphans: MarkerSummary[] = [];
  for (const marker of pending) {
    const free = blocks.filter((b) => !byBlock.has(b.index));
    const hit =
      closest(
        free.filter((b) => b.key === marker.anchorKey),
        marker.blockIndex,
      ) ??
      closest(
        free.filter((b) => opening(b.quote) === opening(marker.quote)),
        marker.blockIndex,
      );
    if (hit) byBlock.set(hit.index, marker);
    else orphans.push(marker);
  }
  return { byBlock, orphans };
}

function opening(quote: string): string {
  return normalizeText(quote).slice(0, MATCH_CHARS);
}

function closest(candidates: Block[], index: number): Block | undefined {
  return candidates.reduce<Block | undefined>(
    (best, b) => (!best || Math.abs(b.index - index) < Math.abs(best.index - index) ? b : best),
    undefined,
  );
}
