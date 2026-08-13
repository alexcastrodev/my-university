import { describe, expect, it } from 'vitest';
import { compileGraph } from '../src/graph';

describe('compileGraph', () => {
  it('throws on an unknown declaration', () => {
    expect(() => compileGraph('teleport A B\n---\n')).toThrow(/Unknown graph declaration/i);
  });

  it('throws on an unknown step command', () => {
    expect(() => compileGraph('node A A 0 0\n---\nfly A')).toThrow(/Unknown graph step/i);
  });

  it('parses node declarations with numeric col/row', () => {
    const scene = compileGraph('node A Alpha 1 2\nnode B Beta 3 4\n---\n');
    expect(scene.nodes).toEqual([
      { id: 'A', label: 'Alpha', col: 1, row: 2 },
      { id: 'B', label: 'Beta', col: 3, row: 4 },
    ]);
  });

  it('parses edges as undirected by default, directed when flagged', () => {
    const scene = compileGraph('node A A 0 0\nnode B B 1 0\nedge A B\nedge A B directed\n---\n');
    expect(scene.edges).toEqual([
      { from: 'A', to: 'B', directed: false },
      { from: 'A', to: 'B', directed: true },
    ]);
  });

  it('treats the whole source as config when there is no "---" separator (no steps)', () => {
    const scene = compileGraph('node A A 0 0');
    expect(scene.nodes).toHaveLength(1);
    expect(scene.steps).toHaveLength(0);
  });

  it('parses visit/traverse/mark steps with default captions', () => {
    const scene = compileGraph('node A A 0 0\nnode B B 1 0\nedge A B\n---\nvisit A\ntraverse A B\nmark B');
    expect(scene.steps).toEqual([
      { caption: 'Visit "A".', visit: { id: 'A' } },
      { caption: 'Follow the edge "A" → "B".', traverseEdge: { from: 'A', to: 'B' } },
      { caption: 'Look at "B".', highlight: { id: 'B' } },
    ]);
  });

  it('a "| note" overrides the default step caption', () => {
    const scene = compileGraph('node A A 0 0\n---\nvisit A | Start here.');
    expect(scene.steps[0].caption).toBe('Start here.');
    expect(scene.steps[0].visit).toEqual({ id: 'A' });
  });

  it('skips blank lines in both the config and the steps section', () => {
    const scene = compileGraph('node A A 0 0\n\nnode B B 1 0\n---\n\nvisit A\n\nvisit B\n');
    expect(scene.nodes).toHaveLength(2);
    expect(scene.steps).toHaveLength(2);
  });
});
