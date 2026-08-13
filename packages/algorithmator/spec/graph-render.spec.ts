import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../src/graph';
import { mountGraph } from '../src/graph-render';

const STEP_DELAY_MS = 1300;

function nodeEl(el: HTMLElement, label: string): Element {
  const match = Array.from(el.querySelectorAll('.concept-viz-tree-node')).find(
    (g) => g.querySelector('text')?.textContent === label,
  );
  if (!match) throw new Error(`No rendered node found with label "${label}"`);
  return match;
}

const SOURCE = [
  'node a A 0 0',
  'node b B 1 0',
  'node c C 2 0',
  'edge a b',
  'edge b c',
  '---',
  'visit a',
  'traverse a b',
  'visit b',
  'mark c',
].join('\n');

describe('mountGraph', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders one .concept-viz-tree-node per declared node, each with a circle and label text', () => {
    const scene = compileGraph(SOURCE);
    const el = document.createElement('div');
    mountGraph(el, scene);

    const nodes = el.querySelectorAll('.concept-viz-tree-node');
    expect(nodes).toHaveLength(3);
    for (const label of ['A', 'B', 'C']) {
      const g = nodeEl(el, label);
      expect(g.querySelector('circle')).not.toBeNull();
      expect(g.querySelector('text')?.textContent).toBe(label);
    }
  });

  it('renders one edge per declared edge, drawn immediately (no per-step DOM changes to structure)', () => {
    const scene = compileGraph(SOURCE);
    const el = document.createElement('div');
    mountGraph(el, scene);
    expect(el.querySelectorAll('.concept-viz-tree-edge')).toHaveLength(2);
  });

  it('a visit step marks the node visited and, only on the step it happens, as the current pointer', () => {
    const scene = compileGraph(SOURCE);
    const el = document.createElement('div');
    mountGraph(el, scene);

    vi.advanceTimersByTime(STEP_DELAY_MS); // visit a
    expect(nodeEl(el, 'A').classList.contains('concept-viz-tree-node--visited')).toBe(true);
    expect(nodeEl(el, 'A').classList.contains('concept-viz-tree-node--pointer')).toBe(true);

    vi.advanceTimersByTime(STEP_DELAY_MS); // traverse a b
    expect(nodeEl(el, 'A').classList.contains('concept-viz-tree-node--visited')).toBe(true);
    // "a" is no longer the step that just happened, so it's no longer the pointer.
    expect(nodeEl(el, 'A').classList.contains('concept-viz-tree-node--pointer')).toBe(false);
  });

  it('a traverse step marks the corresponding edge traversed', () => {
    const scene = compileGraph(SOURCE);
    const el = document.createElement('div');
    mountGraph(el, scene);

    vi.advanceTimersByTime(STEP_DELAY_MS); // visit a
    let traversed = el.querySelectorAll('.concept-viz-tree-edge--traversed');
    expect(traversed).toHaveLength(0);

    vi.advanceTimersByTime(STEP_DELAY_MS); // traverse a b
    traversed = el.querySelectorAll('.concept-viz-tree-edge--traversed');
    expect(traversed).toHaveLength(1);
  });

  it('an undirected edge is recognized as traversed regardless of which direction it was walked', () => {
    const scene = compileGraph(
      ['node x X 0 0', 'node y Y 1 0', 'edge x y', '---', 'traverse y x'].join('\n'),
    );
    const el = document.createElement('div');
    mountGraph(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS);
    expect(el.querySelectorAll('.concept-viz-tree-edge--traversed')).toHaveLength(1);
  });

  it('a mark step flashes a node without marking it visited', () => {
    const scene = compileGraph(SOURCE);
    const el = document.createElement('div');
    mountGraph(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 4); // visit a, traverse a b, visit b, mark c

    const c = nodeEl(el, 'C');
    expect(c.classList.contains('concept-viz-tree-node--flash')).toBe(true);
    expect(c.classList.contains('concept-viz-tree-node--visited')).toBe(false);
  });

  it('the returned cleanup function stops the autoplay timers', () => {
    const scene = compileGraph(SOURCE);
    const el = document.createElement('div');
    const cleanup = mountGraph(el, scene);
    cleanup();
    vi.advanceTimersByTime(STEP_DELAY_MS * 5);
    expect(nodeEl(el, 'A').classList.contains('concept-viz-tree-node--visited')).toBe(false);
  });
});
