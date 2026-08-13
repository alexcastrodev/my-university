import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTree } from '../src/tree';
import { mountTree } from '../src/tree-render';

const STEP_DELAY_MS = 1300;
// Extra headroom beyond the last step's own STEP_DELAY_MS tick: assertions that read a node's
// final rendered `transform` (position) or wait for an exit-transition removal need the
// node's TRANSITION_MS (380ms) D3 transition — which only *starts* when that step's timer
// fires — to actually finish playing out.
const TRANSITION_BUFFER_MS = 500;

function nodeEl(el: HTMLElement, label: string): Element {
  const match = Array.from(el.querySelectorAll('.concept-viz-tree-node')).find(
    (g) => g.querySelector('text')?.textContent === label,
  );
  if (!match) throw new Error(`No rendered node found with label "${label}"`);
  return match;
}

// D3's transform interpolator (used while a transition is in flight, and for its final frame)
// doesn't always format identically to the plain template literals tree-render.ts writes on
// enter (e.g. it may separate x/y with ", " instead of ","), so tolerate either.
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

describe('mountTree', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Let any D3 transition left mid-flight by this test fully finish (and unregister itself
    // from d3-timer's internal, module-global timer queue) before switching timer modes —
    // otherwise a still-pending transition carries stale timer state into the next test.
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });

  it('renders one .concept-viz-tree-node per inserted node, each with a circle and label text', () => {
    const scene = compileTree('insert 6 6\ninsert 5 5 parent=6 side=left\ninsert 7 7 parent=6 side=right');
    const el = document.createElement('div');
    mountTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 3);

    const nodes = el.querySelectorAll('.concept-viz-tree-node');
    expect(nodes).toHaveLength(3);
    for (const label of ['6', '5', '7']) {
      const g = nodeEl(el, label);
      expect(g.querySelector('circle')).not.toBeNull();
      expect(g.querySelector('text')?.textContent).toBe(label);
    }
  });

  it('lays out nodes by in-order position — left-subtree nodes render left of the root', () => {
    const scene = compileTree(
      'insert 6 6\ninsert 5 5 parent=6 side=left\ninsert 8 8 parent=6 side=right\ninsert 2 2 parent=5 side=left',
    );
    const el = document.createElement('div');
    mountTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 4 + TRANSITION_BUFFER_MS);

    // In-order traversal of this tree is 2, 5, 6, 8 — x-coordinates must increase in that order.
    const xOf = (label: string) => translateX(nodeEl(el, label));
    expect(xOf('2')).toBeLessThan(xOf('5'));
    expect(xOf('5')).toBeLessThan(xOf('6'));
    expect(xOf('6')).toBeLessThan(xOf('8'));
  });

  it('draws one edge per parent-child link', () => {
    const scene = compileTree('insert 6 6\ninsert 5 5 parent=6 side=left\ninsert 7 7 parent=6 side=right');
    const el = document.createElement('div');
    mountTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 3);
    expect(el.querySelectorAll('.concept-viz-tree-edge')).toHaveLength(2);
  });

  it('recolor sets the data-color attribute used for red-black rendering', () => {
    const scene = compileTree('insert 10 10 color=black\nrecolor 10 red');
    const el = document.createElement('div');
    mountTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS); // insert (color=black)
    expect(nodeEl(el, '10').getAttribute('data-color')).toBe('black');

    vi.advanceTimersByTime(STEP_DELAY_MS); // recolor red
    expect(nodeEl(el, '10').getAttribute('data-color')).toBe('red');
  });

  it('rotate-left restructures the tree: the pivoted node ends up deeper than its old right child', () => {
    // Verified against CLRS Figure 13.2's own worked LEFT-ROTATE example (see tree-render.ts).
    const scene = compileTree(
      [
        'insert 20 20',
        'insert 10 10 parent=20 side=left',
        'insert 30 30 parent=20 side=right',
        'insert 25 25 parent=30 side=left',
        'insert 40 40 parent=30 side=right',
        'rotate-left 20',
      ].join('\n'),
    );
    const el = document.createElement('div');
    mountTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 6 + TRANSITION_BUFFER_MS);

    const yOf = (label: string) => translateY(nodeEl(el, label));
    // After rotating left at 20: 30 becomes the new root (shallowest), 20 becomes its left
    // child (one level deeper), and in-order position must still read 10, 20, 25, 30, 40.
    expect(yOf('30')).toBeLessThan(yOf('20'));
    const xOf = (label: string) => translateX(nodeEl(el, label));
    expect(xOf('10')).toBeLessThan(xOf('20'));
    expect(xOf('20')).toBeLessThan(xOf('25'));
    expect(xOf('25')).toBeLessThan(xOf('30'));
    expect(xOf('30')).toBeLessThan(xOf('40'));
  });

  it('a mark step flashes the named node', () => {
    const scene = compileTree('insert 6 6\nmark 6');
    const el = document.createElement('div');
    mountTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 2);
    expect(nodeEl(el, '6').classList.contains('concept-viz-tree-node--flash')).toBe(true);
  });

  it('an insert step highlights the newly-inserted node as the current pointer', () => {
    const scene = compileTree('insert 6 6\ninsert 5 5 parent=6 side=left');
    const el = document.createElement('div');
    mountTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 2);
    expect(nodeEl(el, '5').classList.contains('concept-viz-tree-node--pointer')).toBe(true);
    expect(nodeEl(el, '6').classList.contains('concept-viz-tree-node--pointer')).toBe(false);
  });

  it('remove deletes a leaf node from the rendered tree', () => {
    const scene = compileTree('insert 6 6\ninsert 5 5 parent=6 side=left\nremove 5');
    const el = document.createElement('div');
    mountTree(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 3 + TRANSITION_BUFFER_MS);
    expect(el.querySelectorAll('.concept-viz-tree-node')).toHaveLength(1);
    expect(() => nodeEl(el, '5')).toThrow();
  });

  it('the returned cleanup function stops the autoplay timers', () => {
    const scene = compileTree('insert 6 6\ninsert 5 5 parent=6 side=left');
    const el = document.createElement('div');
    const cleanup = mountTree(el, scene);
    cleanup();
    vi.advanceTimersByTime(STEP_DELAY_MS * 5);
    expect(el.querySelectorAll('.concept-viz-tree-node')).toHaveLength(0);
  });
});
