import { describe, expect, it } from 'vitest';
import { DEFAULTS, hashString, packRows, slotWidth, spineHeight, spineWidth } from '../src/layout';

const book = (pages: number) => ({ pages });

describe('spineWidth', () => {
  it('grows with the pages, one pixel per twelve', () => {
    expect(spineWidth(300)).toBe(25);
    expect(spineWidth(600)).toBe(50);
  });

  it('never goes under the minimum or over the maximum', () => {
    expect(spineWidth(1)).toBe(DEFAULTS.minSpine);
    expect(spineWidth(100)).toBe(DEFAULTS.minSpine);
    expect(spineWidth(5000)).toBe(DEFAULTS.maxSpine);
  });

  it('never gets thinner when the book gets longer', () => {
    let previous = 0;
    for (let pages = 1; pages <= 5000; pages += 7) {
      const width = spineWidth(pages);
      expect(width).toBeGreaterThanOrEqual(previous);
      previous = width;
    }
  });

  it('can be calibrated per call', () => {
    expect(spineWidth(300, { pagesPerPx: 6 })).toBe(50);
    expect(spineWidth(300, { pagesPerPx: 6, maxSpine: 40 })).toBe(40);
  });
});

describe('slotWidth', () => {
  it('is the spine plus two pixels for the edge of the pages', () => {
    expect(slotWidth(300)).toBe(27);
  });
});

describe('spineHeight', () => {
  it('stays between 216 and 228 and is the same for the same title', () => {
    for (const title of ['A', 'Clean Code', 'Designing Data-Intensive Applications', '']) {
      const height = spineHeight(title);
      expect(height).toBeGreaterThanOrEqual(216);
      expect(height).toBeLessThanOrEqual(228);
      expect(spineHeight(title)).toBe(height);
    }
  });

  it('is not one height for every title', () => {
    const heights = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(spineHeight));
    expect(heights.size).toBeGreaterThan(1);
  });
});

describe('hashString', () => {
  it('is stable and spreads different texts', () => {
    expect(hashString('x')).toBe(hashString('x'));
    expect(hashString('x')).not.toBe(hashString('y'));
  });
});

describe('packRows', () => {
  it('gives no rows for no books', () => {
    expect(packRows([], 800)).toEqual([]);
  });

  it('wraps to the next row when the next book no longer fits', () => {
    // 27px slots, 3px gaps, 24px at each end, and 179px kept so a book can open: 5 fit in 400px.
    const books = Array.from({ length: 10 }, () => book(300));
    expect(packRows(books, 400).map((row) => row.length)).toEqual([5, 5]);
  });

  it('uses fewer rows in a wider container', () => {
    const books = Array.from({ length: 30 }, (_, i) => book(200 + i * 10));
    expect(packRows(books, 1200).length).toBeLessThan(packRows(books, 500).length);
  });

  it('keeps the order and loses no book', () => {
    const books = Array.from({ length: 57 }, (_, i) => ({ pages: 80 + ((i * 37) % 900), id: i }));
    const rows = packRows(books, 640);
    expect(rows.flat().map((b) => b.id)).toEqual(books.map((b) => b.id));
  });

  it('keeps room in every row for its narrowest book to open', () => {
    const books = Array.from({ length: 40 }, (_, i) => book(100 + ((i * 53) % 700)));
    for (const row of packRows(books, 600)) {
      if (row.length < 2) continue;
      const widths = row.map((b) => slotWidth(b.pages));
      const used = widths.reduce((sum, w) => sum + w, 0) + DEFAULTS.gap * (row.length - 1);
      const reserve = DEFAULTS.openWidth - Math.min(...widths);
      expect(used + reserve + 2 * DEFAULTS.padding).toBeLessThanOrEqual(600);
    }
  });

  it('puts a book wider than the container alone in its row', () => {
    expect(packRows([book(300), book(300)], 100).map((row) => row.length)).toEqual([1, 1]);
  });

  it('does not change the list it was given', () => {
    const books = [book(100), book(200), book(300)];
    packRows(books, 300);
    expect(books.map((b) => b.pages)).toEqual([100, 200, 300]);
  });
});
