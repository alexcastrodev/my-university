import { describe, expect, it } from 'vitest';
import { compileBTree } from '../src/btree';

describe('compileBTree', () => {
  it('throws on an unknown command', () => {
    expect(() => compileBTree('teleport root')).toThrow(/Unknown btree command/i);
  });

  it('parses a root node with a default caption', () => {
    const scene = compileBTree('node r1 keys=B,D');
    expect(scene.steps).toHaveLength(1);
    expect(scene.steps[0]).toEqual({
      caption: 'Node "r1" holds keys B, D (root).',
      node: { id: 'r1', keys: ['B', 'D'], parent: null, index: undefined },
    });
  });

  it('parses a child node with parent/index, default caption reflects the attachment', () => {
    const scene = compileBTree('node n1 keys=A parent=r1 index=0');
    expect(scene.steps[0]).toEqual({
      caption: 'Node "n1" holds keys A (child #0 of "r1").',
      node: { id: 'n1', keys: ['A'], parent: 'r1', index: 0 },
    });
  });

  it('defaults index to 0 in the caption when omitted from a non-root node', () => {
    const scene = compileBTree('node n1 keys=A parent=r1');
    expect(scene.steps[0].caption).toBe('Node "n1" holds keys A (child #0 of "r1").');
    expect(scene.steps[0].node?.index).toBeUndefined();
  });

  it('a "| note" overrides the default caption without changing the parsed command', () => {
    const scene = compileBTree('node n1 keys=A,C parent=r1 index=0 | Split: A and C stay under B.');
    expect(scene.steps[0].caption).toBe('Split: A and C stay under B.');
    expect(scene.steps[0].node).toEqual({ id: 'n1', keys: ['A', 'C'], parent: 'r1', index: 0 });
  });

  it('parses remove with a default caption', () => {
    const scene = compileBTree('remove n1');
    expect(scene.steps[0]).toEqual({ caption: 'Remove node "n1".', remove: { id: 'n1' } });
  });

  it('parses mark as a highlight step with a default caption', () => {
    const scene = compileBTree('mark n1');
    expect(scene.steps[0]).toEqual({ caption: 'Look at node "n1".', highlight: { id: 'n1' } });
  });

  it('parses mark-key as a highlightKey step with a default caption', () => {
    const scene = compileBTree('mark-key r1 D');
    expect(scene.steps[0]).toEqual({
      caption: 'Look at key "D" in node "r1".',
      highlightKey: { id: 'r1', key: 'D' },
    });
  });

  it('parses a full multi-command trace in order, skipping blank lines', () => {
    const scene = compileBTree(`
      node r1 keys=A,B,C

      remove r1
      node root keys=B
      node n1 keys=A parent=root index=0
      node n2 keys=C parent=root index=1
    `);
    expect(scene.steps).toHaveLength(5);
    expect(scene.steps[0].node?.id).toBe('r1');
    expect(scene.steps[1].remove).toEqual({ id: 'r1' });
    expect(scene.steps[4].node).toEqual({ id: 'n2', keys: ['C'], parent: 'root', index: 1 });
  });
});
