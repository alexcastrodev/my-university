import { collectBlocks, hashText, matchMarkers, normalizeText } from './block-anchor';
import { MarkerSummary } from './discussion.model';

describe('block-anchor', () => {
  let root: HTMLElement;

  const marker = (over: Partial<MarkerSummary>): MarkerSummary => ({
    id: 1,
    anchorKey: '',
    blockIndex: 0,
    quote: '',
    commentCount: 1,
    resolvedCount: 0,
    ...over,
  });

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML =
      '<section><div class="section-body">' +
      '<p>An aggregate keeps its invariants inside one transaction.</p>' +
      '<h3>Heading is not a block</h3>' +
      '<p>An aggregate keeps its invariants inside one transaction.</p>' +
      '<pre><code>await db.SaveChangesAsync(ct);</code></pre>' +
      '<p>ok</p>' +
      '<ul><li>first item here</li><li>second item here</li></ul>' +
      '</div></section>' +
      '<section><div class="section-body"><p>Dispatch after the commit to avoid ghosts.</p></div></section>';
    document.body.appendChild(root);
  });

  afterEach(() => root.remove());

  it('collects paragraphs, code and lists in reading order, skipping headings and tiny blocks', () => {
    const blocks = collectBlocks(root);
    expect(blocks.map((b) => b.el.tagName)).toEqual(['P', 'P', 'PRE', 'UL', 'P']);
    expect(blocks.map((b) => b.index)).toEqual([0, 1, 2, 3, 4]);
    expect(blocks[3].quote).toBe('first item heresecond item here');
  });

  it('gives identical paragraphs the same key but different positions', () => {
    const [a, b] = collectBlocks(root);
    expect(a.key).toBe(b.key);
    expect(a.index).not.toBe(b.index);
    expect(a.key).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hashes by normalized text, so markup and punctuation do not matter', () => {
    expect(hashText(normalizeText('Hello,   World!'))).toBe(hashText(normalizeText('hello world')));
    expect(hashText('a')).not.toBe(hashText('b'));
  });

  it('pins a marker to the repeated paragraph it was made on, not the first one', () => {
    const blocks = collectBlocks(root);
    const { byBlock } = matchMarkers(blocks, [marker({ id: 7, anchorKey: blocks[1].key, blockIndex: 1, quote: blocks[1].quote })]);
    expect([...byBlock.keys()]).toEqual([1]);
  });

  it('follows a paragraph that moved', () => {
    const blocks = collectBlocks(root);
    const code = blocks[2];
    const { byBlock, orphans } = matchMarkers(blocks, [marker({ anchorKey: code.key, blockIndex: 9, quote: code.quote })]);
    expect(byBlock.get(2)?.id).toBe(1);
    expect(orphans).toEqual([]);
  });

  it('follows a paragraph whose ending was edited, by its opening words', () => {
    const blocks = collectBlocks(root);
    const edited = marker({ anchorKey: 'deadbeefdeadbeef', blockIndex: 4, quote: 'Dispatch after the commit to avoid ghosts and more.' });
    const { byBlock } = matchMarkers(blocks, [edited]);
    expect(byBlock.get(4)).toBe(edited);
  });

  it('keeps what matches nothing as an orphan, and lets two markers never share a block', () => {
    const blocks = collectBlocks(root);
    const gone = marker({ id: 2, anchorKey: 'deadbeefdeadbeef', blockIndex: 0, quote: 'A paragraph that was deleted entirely' });
    const first = marker({ id: 3, anchorKey: blocks[4].key, blockIndex: 4, quote: blocks[4].quote });
    const twin = marker({ id: 4, anchorKey: blocks[4].key, blockIndex: 4, quote: blocks[4].quote });
    const { byBlock, orphans } = matchMarkers(blocks, [gone, first, twin]);
    expect(byBlock.get(4)?.id).toBe(3);
    expect(orphans.map((m) => m.id).sort()).toEqual([2, 4]);
  });

  it('does not let a loose match steal a block another marker matches exactly', () => {
    const blocks = collectBlocks(root);
    const loose = marker({ id: 5, anchorKey: blocks[0].key, blockIndex: 3, quote: blocks[0].quote });
    const exact = marker({ id: 6, anchorKey: blocks[0].key, blockIndex: 0, quote: blocks[0].quote });
    const { byBlock } = matchMarkers(blocks, [loose, exact]);
    expect(byBlock.get(0)?.id).toBe(6);
    expect(byBlock.get(1)?.id).toBe(5);
  });
});
