import { ConceptSection } from '../shared/concept-content';
import {
  normalizeForMatch,
  renderedText,
} from '../discussion/discussion.logic';

/** One numbered piece of a source: what the model may quote and what a citation points at. */
export interface KurzBlock {
  /** 1-based, across the whole source: `p1`, `p2`... */
  p: number;
  section: string;
  text: string;
}

/**
 * Everything the model may read. `S1` is the post the student is on, `S2` onwards are the summaries of the
 * posts it links as related. The route is ours, so a link in an answer never comes from the model's text.
 */
export interface KurzSource {
  id: string;
  title: string;
  route: string[];
  blocks: KurzBlock[];
  /** Only `S1` is the post itself; the others are one-block summaries, to be pointed at rather than read in full. */
  isPost: boolean;
}

/** Shorter than this, a selection is too little to tell it from any other text. */
const MIN_SELECTION_CHARS = 8;

/** A block is at most this long, so one pasted wall of text cannot become a single unciteable "paragraph". */
const MAX_BLOCK_CHARS = 1500;

/**
 * Cuts the markdown of a post into blocks: paragraphs apart at blank lines, with a fenced code block kept whole
 * (its blank lines are code). The text is what the reader sees (`renderedText`), so a quote the model copies from
 * it is found on the page.
 */
export function splitBlocks(sections: ConceptSection[]): KurzBlock[] {
  const blocks: KurzBlock[] = [];
  for (const section of sections) {
    let current: string[] = [];
    let fence = false;
    const flush = () => {
      const text = renderedText(current.join('\n')).trim();
      current = [];
      if (!text) return;
      for (let i = 0; i < text.length; i += MAX_BLOCK_CHARS)
        blocks.push({
          p: blocks.length + 1,
          section: section.title,
          text: text.slice(i, i + MAX_BLOCK_CHARS),
        });
    };
    for (const line of section.content.split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (!fence && line.trim() === '') flush();
      else current.push(line);
    }
    flush();
  }
  return blocks;
}

export interface PostForKurz {
  title: string;
  route: string[];
  sections: ConceptSection[];
}

export interface RelatedForKurz {
  title: string;
  summary: string | null;
  route: string[];
}

/** The sources of one question: the post, then its related posts (each a single block: its summary). */
export function buildSources(
  post: PostForKurz,
  related: RelatedForKurz[],
): KurzSource[] {
  const sources: KurzSource[] = [
    {
      id: 'S1',
      title: post.title,
      route: post.route,
      blocks: splitBlocks(post.sections),
      isPost: true,
    },
  ];
  related.forEach((r, i) =>
    sources.push({
      id: `S${i + 2}`,
      title: r.title,
      route: r.route,
      blocks: [{ p: 1, section: r.title, text: r.summary ?? r.title }],
      isPost: false,
    }),
  );
  return sources;
}

/**
 * The selection the client sent counts as a passage of the post only when the post says it, all of it (letters
 * and digits compared, as for the discussion quotes; the section titles count, since a selection can start on
 * one). It may span blocks. A forged "passage" is then just part of the question: it never becomes a source, so
 * it cannot be cited back or published as if the post said it. Answers the block it starts in.
 */
export function selectionInPost(
  post: KurzSource,
  selection: string,
): { p: number } | null {
  const needle = normalizeForMatch(renderedText(selection));
  if (needle.length < MIN_SELECTION_CHARS) return null;
  const starts: { at: number; p: number }[] = [];
  let haystack = '';
  let lastSection: string | null = null;
  for (const block of post.blocks) {
    if (block.section !== lastSection) {
      starts.push({ at: haystack.length, p: block.p });
      haystack += normalizeForMatch(block.section);
      lastSection = block.section;
    }
    starts.push({ at: haystack.length, p: block.p });
    haystack += normalizeForMatch(block.text);
  }
  const index = haystack.indexOf(needle);
  if (index < 0) return null;
  let found = starts[0];
  for (const start of starts) if (start.at <= index) found = start;
  return { p: found.p };
}
