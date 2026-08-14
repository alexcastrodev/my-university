import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileBTree } from '../src/btree';
import { mountBTree } from '../src/btree-render';

const STEP_DELAY_MS = 1300;
// Extra headroom beyond the last step's own STEP_DELAY_MS tick, same rationale as
// tree-render.spec.ts: a node's final rendered `transform` only settles once its TRANSITION_MS
// (380ms) D3 transition — which only *starts* when that step's timer fires — finishes playing out.
const TRANSITION_BUFFER_MS = 500;

// Nodes aren't labeled by a single text element the way binary-tree nodes are (a B-tree node can
// hold several keys), so tests match a rendered `<g>` by its joined key-cell text instead of id.
function keysOf(g: SVGGElement): string[] {
  return Array.from(g.querySelectorAll('.concept-viz-btree-key')).map((t) => t.textContent ?? '');
}

const TRANSLATE_REGEXP = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/;

function translateX(el: Element): number {
  const transform = el.getAttribute('transform') ?? '';
  const match = TRANSLATE_REGEXP.exec(transform);
  if (!match) throw new Error(`Could not parse translate() x from "${transform}"`);
  return Number(match[1]);
}

function translateY(el: Element): number {
  const transform = el.getAttribute('transform') ?? '';
  const match = TRANSLATE_REGEXP.exec(transform);
  if (!match) throw new Error(`Could not parse translate() y from "${transform}"`);
  return Number(match[2]);
}

describe('mountBTree', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });

  it('renders one .concept-viz-tree-node per declared node, each with its key cells', () => {
    const scene = compileBTree('node r1 keys=P\nnode dh keys=D,H parent=r1 index=0\nnode tx keys=T,X parent=r1 index=1');
    const el = document.createElement('div');
    mountBTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 3);

    const nodes = el.querySelectorAll('.concept-viz-tree-node');
    expect(nodes).toHaveLength(3);
    const byKeys = Array.from(nodes).map((g) => keysOf(g as SVGGElement).join(','));
    expect(byKeys.sort()).toEqual(['D,H', 'P', 'T,X']);
  });

  it('draws one edge per parent-child link', () => {
    const scene = compileBTree('node r1 keys=P\nnode dh keys=D,H parent=r1 index=0\nnode tx keys=T,X parent=r1 index=1');
    const el = document.createElement('div');
    mountBTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 3);
    expect(el.querySelectorAll('.concept-viz-tree-edge')).toHaveLength(2);
  });

  it('lays out children left to right under their parent — leftmost child renders left of the rightmost', () => {
    const scene = compileBTree(
      [
        'node r1 keys=P',
        'node dh keys=D,H parent=r1 index=0',
        'node tx keys=T,X parent=r1 index=1',
        'node ac keys=A,C parent=dh index=0',
        'node ef keys=E,F parent=dh index=1',
        'node jkm keys=J,K,M parent=dh index=2',
      ].join('\n'),
    );
    const el = document.createElement('div');
    mountBTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 6 + TRANSITION_BUFFER_MS);

    const g = (keys: string) =>
      Array.from(el.querySelectorAll<SVGGElement>('.concept-viz-tree-node')).find(
        (n) => keysOf(n).join(',') === keys,
      )!;
    expect(translateX(g('A,C'))).toBeLessThan(translateX(g('E,F')));
    expect(translateX(g('E,F'))).toBeLessThan(translateX(g('J,K,M')));
    // The root sits shallower (smaller y) than its children.
    expect(translateY(g('P'))).toBeLessThan(translateY(g('D,H')));
  });

  it('a node step redeclaring an existing id updates its keys in place (no new node)', () => {
    const scene = compileBTree('node r1 keys=A\nnode r1 keys=A,B\nnode r1 keys=A,B,C');
    const el = document.createElement('div');
    mountBTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 3);
    expect(el.querySelectorAll('.concept-viz-tree-node')).toHaveLength(1);
    const g = el.querySelector<SVGGElement>('.concept-viz-tree-node')!;
    expect(keysOf(g)).toEqual(['A', 'B', 'C']);
  });

  it('a split replaces the old node with two new ones under the (possibly new) parent', () => {
    const scene = compileBTree(
      [
        'node r1 keys=A,B,C',
        'remove r1',
        'node root keys=B',
        'node n1 keys=A parent=root index=0',
        'node n2 keys=C parent=root index=1',
      ].join('\n'),
    );
    const el = document.createElement('div');
    mountBTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 5 + TRANSITION_BUFFER_MS);

    const nodes = el.querySelectorAll('.concept-viz-tree-node');
    expect(nodes).toHaveLength(3);
    const byKeys = Array.from(nodes).map((g) => keysOf(g as SVGGElement).join(',')).sort();
    expect(byKeys).toEqual(['A', 'B', 'C']);
  });

  it('mark flashes the named node', () => {
    const scene = compileBTree('node r1 keys=P\nmark r1');
    const el = document.createElement('div');
    mountBTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 2);
    const g = el.querySelector<SVGGElement>('.concept-viz-tree-node')!;
    expect(g.classList.contains('concept-viz-tree-node--flash')).toBe(true);
  });

  it('mark-key flashes only the named key within the node', () => {
    const scene = compileBTree('node r1 keys=B,D\nmark-key r1 D');
    const el = document.createElement('div');
    mountBTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 2);
    const texts = Array.from(el.querySelectorAll('.concept-viz-btree-key'));
    const b = texts.find((t) => t.textContent === 'B')!;
    const d = texts.find((t) => t.textContent === 'D')!;
    expect(d.classList.contains('concept-viz-btree-key--flash')).toBe(true);
    expect(b.classList.contains('concept-viz-btree-key--flash')).toBe(false);
  });

  it('a node step highlights the redeclared node as the current pointer', () => {
    const scene = compileBTree('node r1 keys=A\nnode n2 keys=B parent=r1 index=0');
    const el = document.createElement('div');
    mountBTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 2);
    const nodes = Array.from(el.querySelectorAll<SVGGElement>('.concept-viz-tree-node'));
    const pointer = nodes.find((n) => n.classList.contains('concept-viz-tree-node--pointer'));
    expect(pointer).toBeDefined();
    expect(keysOf(pointer!)).toEqual(['B']);
  });

  it('the returned cleanup function stops the autoplay timers', () => {
    const scene = compileBTree('node r1 keys=A\nnode n2 keys=B parent=r1 index=0');
    const el = document.createElement('div');
    const cleanup = mountBTree(el, scene);
    cleanup();
    vi.advanceTimersByTime(STEP_DELAY_MS * 5);
    expect(el.querySelectorAll('.concept-viz-tree-node')).toHaveLength(0);
  });
});
