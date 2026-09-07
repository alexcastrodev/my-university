import { ConceptSection } from '../shared/concept-content';

const FENCE_RE = /```([\w+-]*)\n([\s\S]*?)```/;

export interface ExtractedCode {
  lang: string;
  code: string;
}

/** First fenced code block in a markdown string, or null if there isn't one (or it's empty). */
export function firstCodeBlock(markdown: string): ExtractedCode | null {
  const match = FENCE_RE.exec(markdown);
  if (!match) return null;
  const code = match[2].trim();
  if (!code) return null;
  return { lang: match[1] || '', code };
}

function hasSubstantialCodeBlock(markdown: string, minLines: number): boolean {
  const block = firstCodeBlock(markdown);
  if (!block) return false;
  return block.code.split('\n').filter((line) => line.trim().length > 0).length >= minLines;
}

/** Section titles that are structural, not real prose/content — never picked as a Read excerpt
 *  or scanned for a Notice snippet, even though they technically have text. */
const NON_CONTENT_SECTION_TITLES = new Set(['documentation links', 'references']);

function isContentSection(section: ConceptSection): boolean {
  return !NON_CONTENT_SECTION_TITLES.has(section.title.trim().toLowerCase());
}

/** First section (in document order) with substantial, real prose — the Read card's source. */
export function firstSubstantialSection(
  sections: ConceptSection[],
  minChars = 80,
): ConceptSection | null {
  return (
    sections.find((s) => isContentSection(s) && s.content.trim().length >= minChars) ?? null
  );
}

/** First section (in document order) containing a fenced code block of at least `minLines`
 *  non-empty lines — the Notice card's source. */
export function firstSectionWithCode(
  sections: ConceptSection[],
  minLines = 2,
): ConceptSection | null {
  return (
    sections.find((s) => isContentSection(s) && hasSubstantialCodeBlock(s.content, minLines)) ??
    null
  );
}

/** First `count` paragraphs of a section's markdown, with any fenced code block stripped out
 *  (that's surfaced separately via `firstCodeBlock`) — the Read card's `body`. */
export function excerptParagraphs(markdown: string, count = 2): string {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '').trim();
  const paragraphs = withoutCode
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.slice(0, count).join('\n\n');
}

/** Real sentences immediately following a section's first fenced code block — the Notice
 *  card's `lead`/`takeaway`. Empty if there's no clean prose right after the block: a
 *  bullet list or heading is structure, not a flowing sentence, and a second fenced block
 *  further down isn't prose either — forcing either through sentence-splitting produces a
 *  garbled run-on rather than the one clean sentence this card wants, so both are treated
 *  as "no lead available" instead. */
export function textAfterCodeBlock(markdown: string, count = 2): string[] {
  const match = FENCE_RE.exec(markdown);
  if (!match) return [];
  let after = markdown.slice((match.index ?? 0) + match[0].length).trim();
  if (!after) return [];

  after = after.replace(/```[\s\S]*?```/g, ' ').trim();
  if (!after) return [];

  const firstParagraph = after.split(/\n\s*\n/)[0].trim();
  if (!firstParagraph || /^([-*+]|\d+\.|#{1,6})\s/.test(firstParagraph)) return [];

  return firstParagraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, count);
}
