import {
  buildHighlightParams,
  buildHighlightUrl,
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
});
