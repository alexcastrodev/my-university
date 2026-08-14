import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderConceptViz } from '../src/index';

describe('renderConceptViz', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches "formula" blocks to the engine and mounts a viz root', () => {
    const source = ['type: formula', 'capacity = 4', 'slot = index % capacity', '---', 'x', 'y'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.classList.contains('concept-viz-root')).toBe(true);
    expect(el.querySelectorAll('.concept-viz-slot')).toHaveLength(4);
    cleanup();
  });

  it('reports a formula compile error on the element instead of throwing', () => {
    const source = ['type: formula', 'capacity = 4', '---', 'x'].join('\n'); // missing "slot ="
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.textContent).toMatch(/^Formula error:/);
    expect(cleanup).toBeTypeOf('function');
    cleanup();
  });

  it('dispatches "moves" blocks to the engine with a row layout', () => {
    const source = ['type: moves', 'swap 0 1', '---', 'a', 'b'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.classList.contains('concept-viz-root')).toBe(true);
    expect(el.querySelector('.concept-viz-slots--row')).not.toBeNull();
    cleanup();
  });

  it('reports a moves compile error on the element instead of throwing', () => {
    const source = ['type: moves', 'frobnicate 0 1', '---', 'a', 'b'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.textContent).toMatch(/^Moves error:/);
    cleanup();
  });

  it('dispatches "tree" blocks to tree-render', () => {
    const source = ['type: tree', 'insert 6 6'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.classList.contains('concept-viz-root')).toBe(true);
    expect(el.querySelector('.concept-viz-tree-svg')).not.toBeNull();
    cleanup();
  });

  it('reports a tree compile error on the element instead of throwing', () => {
    const source = ['type: tree', 'levitate 6'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.textContent).toMatch(/^Tree error:/);
    cleanup();
  });

  it('dispatches "btree" blocks to btree-render', () => {
    const source = ['type: btree', 'node r1 keys=B,D'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.classList.contains('concept-viz-root')).toBe(true);
    vi.advanceTimersByTime(1300);
    expect(el.querySelectorAll('.concept-viz-btree-key')).toHaveLength(2);
    cleanup();
  });

  it('reports a btree compile error on the element instead of throwing', () => {
    const source = ['type: btree', 'levitate r1'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.textContent).toMatch(/^B-tree error:/);
    cleanup();
  });

  it('dispatches "graph" blocks to graph-render', () => {
    const source = ['type: graph', 'node a A 0 0', 'node b B 1 0', 'edge a b', '---', 'visit a'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.classList.contains('concept-viz-root')).toBe(true);
    expect(el.querySelectorAll('.concept-viz-tree-node')).toHaveLength(2);
    cleanup();
  });

  it('reports a graph compile error on the element instead of throwing', () => {
    const source = ['type: graph', 'teleport a b', '---', 'visit a'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.textContent).toMatch(/^Graph error:/);
    cleanup();
  });

  it('reports an unknown type without throwing, and returns a no-op cleanup', () => {
    const source = ['type: pseudocode', 'whatever'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.textContent).toBe('Unknown visualization type: "pseudocode"');
    expect(() => cleanup()).not.toThrow();
  });

  it('treats a missing "type:" line as an unknown/empty type', () => {
    const source = ['capacity = 4', 'slot = index % capacity'].join('\n');
    const el = document.createElement('div');
    renderConceptViz(el, source);
    expect(el.textContent).toBe('Unknown visualization type: ""');
  });

  it('tolerates leading blank lines before the "type:" line', () => {
    const source = ['', '  ', 'type: tree', 'insert 6 6'].join('\n');
    const el = document.createElement('div');
    const cleanup = renderConceptViz(el, source);
    expect(el.querySelector('.concept-viz-tree-svg')).not.toBeNull();
    cleanup();
  });
});
