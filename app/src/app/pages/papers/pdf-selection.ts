import { AnnotationRect } from '../../models/paper.model';

/** What a selection in the PDF says about itself: enough to draw it again and to tell later whether it still fits. */
export interface SelectionAnchor {
  page: number;
  /** The selected text with its whitespace folded. */
  quote: string;
  /** The text around it on the page (a W3C TextQuoteSelector), to recognise it in another version of the file. */
  prefix: string;
  suffix: string;
  /** One rectangle per line, as fractions of the page, so they hold at any zoom. */
  rects: AnnotationRect[];
}

const CONTEXT = 40;
const MAX_QUOTE = 2000;
const MAX_RECTS = 100;
const MIN_SIDE = 0.001;

const elementOf = (node: Node): Element | null => (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);
const fold = (text: string) => text.replace(/\s+/g, ' ');
const unit = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 10000) / 10000;

/**
 * The current selection as an anchor, when it is text of one page of this reader; otherwise null. A selection
 * that runs on to the next page is cut at the end of the page it started on.
 */
export function captureSelection(root: HTMLElement | null | undefined): SelectionAnchor | null {
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const layer = elementOf(range.startContainer)?.closest<HTMLElement>('.textLayer');
  const pageEl = layer?.closest<HTMLElement>('.page');
  const page = Number(pageEl?.dataset['page']);
  if (!layer || !pageEl || !page || !root.contains(pageEl)) return null;

  const clip = range.cloneRange();
  if (elementOf(range.endContainer)?.closest('.textLayer') !== layer) clip.setEnd(layer, layer.childNodes.length);
  const raw = clip.toString();
  const quote = fold(raw).trim().slice(0, MAX_QUOTE);
  if (!quote) return null;

  const before = document.createRange();
  before.selectNodeContents(layer);
  before.setEnd(clip.startContainer, clip.startOffset);
  const text = layer.textContent ?? '';
  const at = before.toString().length;
  const prefix = fold(text.slice(Math.max(0, at - CONTEXT), at));
  const suffix = fold(text.slice(at + raw.length, at + raw.length + CONTEXT));

  const box = pageEl.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const seen = new Set<string>();
  const rects: AnnotationRect[] = [];
  for (const r of Array.from(clip.getClientRects())) {
    const rect = {
      x: unit((r.left - box.left) / box.width),
      y: unit((r.top - box.top) / box.height),
      w: unit(r.width / box.width),
      h: unit(r.height / box.height),
    };
    const key = `${rect.x}:${rect.y}:${rect.w}:${rect.h}`;
    if (rect.w < MIN_SIDE || rect.h < MIN_SIDE || seen.has(key)) continue;
    seen.add(key);
    rects.push(rect);
    if (rects.length === MAX_RECTS) break;
  }
  return rects.length ? { page, quote, prefix, suffix, rects } : null;
}
