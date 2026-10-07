import {
  buildHighlightParams,
  buildHighlightUrl,
  computeHighlightOffsets,
  findHighlightRange,
  readHighlightParams,
} from './text-highlight';

describe('text-highlight', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML =
      '<p>The JVM loads <code>classes</code> lazily.</p>\n' +
      '<p>Garbage collection reclaims unreachable objects.</p>';
    document.body.appendChild(root);
  });

  afterEach(() => root.remove());

  it('keeps short selections inline with collapsed whitespace', () => {
    expect(buildHighlightParams('  loads\n  classes ')).toEqual({ start: 'loads classes' });
  });

  it('splits long selections into start and end snippets', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const params = buildHighlightParams(words)!;
    expect(params.start).toBe('word0 word1 word2 word3 word4 word5 word6 word7');
    expect(params.end).toBe('word32 word33 word34 word35 word36 word37 word38 word39');
  });

  it('round-trips the params through the URL', () => {
    const url = buildHighlightUrl('https://example.com/java/x?tab=1#old', {
      start: 'a, b & c',
      end: 'z',
    });
    expect(url).not.toContain('#old');
    expect(readHighlightParams(new URL(url).search)).toEqual({ start: 'a, b & c', end: 'z' });
  });

  it('finds a passage spanning inline elements', () => {
    const range = findHighlightRange([root], { start: 'loads classes lazily' })!;
    expect(range.toString()).toBe('loads classes lazily');
  });

  it('finds a start/end passage across paragraphs', () => {
    const range = findHighlightRange([root], { start: 'lazily.', end: 'Garbage collection' })!;
    expect(range.toString().replace(/\s+/g, ' ')).toBe('lazily. Garbage collection');
  });

  it('returns null when the passage is not on the page', () => {
    expect(findHighlightRange([root], { start: 'not here' })).toBeNull();
  });

  describe('repeated words', () => {
    let dup: HTMLElement;

    beforeEach(() => {
      dup = document.createElement('div');
      dup.innerHTML = '<p>The class loads a class.</p><p>Another class appears: class.</p>';
      document.body.appendChild(dup);
    });

    afterEach(() => dup.remove());

    function selectNth(word: string, n: number): Range {
      const walker = document.createTreeWalker(dup, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        for (let i = node.data.indexOf(word); i !== -1; i = node.data.indexOf(word, i + 1)) {
          if (seen++ === n) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + word.length);
            return range;
          }
        }
      }
      throw new Error('occurrence not found');
    }

    it('highlights the occurrence that was selected, not the first one', () => {
      for (let n = 0; n < 4; n++) {
        const selected = selectNth('class', n);
        const offsets = computeHighlightOffsets([dup], selected)!;
        const found = findHighlightRange([dup], { start: 'class', ...offsets })!;
        expect(found.compareBoundaryPoints(Range.START_TO_START, selected)).toBe(0);
        expect(found.compareBoundaryPoints(Range.END_TO_END, selected)).toBe(0);
      }
    });

    it('survives the URL round trip', () => {
      const offsets = computeHighlightOffsets([dup], selectNth('class', 2))!;
      const url = buildHighlightUrl('https://example.com/x', { start: 'class', ...offsets });
      expect(new URL(url).searchParams.get('hlp')).toBe(`${offsets.from}-${offsets.to}`);
      expect(readHighlightParams(new URL(url).search)).toEqual({ start: 'class', ...offsets });
    });

    it('keeps start/end passages anchored to the selected occurrence', () => {
      const range = document.createRange();
      range.setStart(dup.querySelectorAll('p')[1].firstChild!, 8);
      range.setEnd(dup.querySelectorAll('p')[1].lastChild!, (dup.querySelectorAll('p')[1].textContent ?? '').length);
      const offsets = computeHighlightOffsets([dup], range)!;
      const found = findHighlightRange([dup], { start: 'class', end: 'class.', ...offsets })!;
      expect(found.startContainer).toBe(dup.querySelectorAll('p')[1].firstChild!);
      expect(found.toString()).toBe('class appears: class.');
    });

    it('falls back to text search when the offsets no longer match the content', () => {
      const found = findHighlightRange([dup], { start: 'loads', from: 0, to: 4 })!;
      expect(found.toString()).toBe('loads');
    });

    it('uses the surrounding text to pick the occurrence when offsets are stale', () => {
      for (let n = 0; n < 4; n++) {
        const selected = selectNth('class', n);
        const { before, after } = computeHighlightOffsets([dup], selected)!;
        const found = findHighlightRange([dup], { start: 'class', from: 9999, to: 10003, before, after })!;
        expect(found.compareBoundaryPoints(Range.START_TO_START, selected)).toBe(0);
      }
    });

    it('still finds the occurrence after unrelated content is prepended', () => {
      const selected = selectNth('class', 3);
      const offsets = computeHighlightOffsets([dup], selected)!;
      dup.insertAdjacentHTML('afterbegin', '<p>Brand new intro paragraph.</p>');
      const found = findHighlightRange([dup], { start: 'class', ...offsets })!;
      expect(found.compareBoundaryPoints(Range.START_TO_START, selected)).toBe(0);
    });

    it('round-trips the context through the URL', () => {
      const offsets = computeHighlightOffsets([dup], selectNth('class', 1))!;
      const url = buildHighlightUrl('https://example.com/x', { start: 'class', ...offsets });
      expect(readHighlightParams(new URL(url).search)).toEqual({ start: 'class', ...offsets });
    });

    it('ignores offsets beyond the content', () => {
      const found = findHighlightRange([dup], { start: 'class', from: 9999, to: 10003 })!;
      expect(found.toString()).toBe('class');
    });

    it('ignores malformed or inverted hlp values', () => {
      expect(readHighlightParams('?hl=a&hlp=abc')).toEqual({ start: 'a' });
      expect(readHighlightParams('?hl=a&hlp=9-3')).toEqual({ start: 'a' });
    });
  });
});
