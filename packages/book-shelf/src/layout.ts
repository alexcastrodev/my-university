/** Every number the layout uses; override per call to calibrate. */
export interface LayoutOptions {
  /** How many pages one pixel of spine stands for. */
  pagesPerPx?: number;
  minSpine?: number;
  maxSpine?: number;
  /** Space between two books in a row. */
  gap?: number;
  /** Space at each end of a row. */
  padding?: number;
  /** Width a book takes while it shows its cover. */
  openWidth?: number;
}

export const DEFAULTS: Required<LayoutOptions> = {
  pagesPerPx: 12,
  minSpine: 18,
  maxSpine: 56,
  gap: 3,
  padding: 24,
  openWidth: 206,
};

/** Width of a cover, fixed: only the spine tells the page count. */
export const COVER_WIDTH = 150;

/** 32-bit FNV-1a: a stable number from a title, for the colour and the height of a book. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Thickness of the spine in px: grows with the page count, within the min and the max. */
export function spineWidth(pages: number, options: LayoutOptions = {}): number {
  const o = { ...DEFAULTS, ...options };
  return Math.min(o.maxSpine, Math.max(o.minSpine, Math.round(pages / o.pagesPerPx)));
}

/** Room a closed book takes in a row: the spine plus 2px for the edge of the pages. */
export function slotWidth(pages: number, options: LayoutOptions = {}): number {
  return spineWidth(pages, options) + 2;
}

/** 216 to 228px, from the title, so a shelf is not a row of identical rectangles. */
export function spineHeight(title: string): number {
  return 216 + (hashString(title) % 13);
}

/**
 * Fills rows left to right and starts the next one when a book no longer fits. Each row keeps room for
 * its narrowest book to open (the cover is wider than the spine), so opening a book never moves the others
 * to another row. A book wider than the container still gets a row of its own. Order is kept.
 */
export function packRows<T extends { pages: number }>(items: T[], containerWidth: number, options: LayoutOptions = {}): T[][] {
  const o = { ...DEFAULTS, ...options };
  const limit = containerWidth - 2 * o.padding;
  const rows: T[][] = [];
  let row: T[] = [];
  let used = 0;
  let narrowest = Infinity;
  for (const item of items) {
    const width = slotWidth(item.pages, o);
    const reserve = Math.max(0, o.openWidth - Math.min(narrowest, width));
    if (row.length && used + o.gap + width + reserve > limit) {
      rows.push(row);
      row = [];
      used = 0;
      narrowest = Infinity;
    }
    used += (row.length ? o.gap : 0) + width;
    narrowest = Math.min(narrowest, width);
    row.push(item);
  }
  if (row.length) rows.push(row);
  return rows;
}
