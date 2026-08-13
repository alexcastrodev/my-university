import { describe, expect, it } from 'vitest';
import { compileTree } from '../src/tree';

describe('compileTree', () => {
  it('throws on an unknown command', () => {
    expect(() => compileTree('teleport root')).toThrow(/Unknown tree command/i);
  });

  it('parses a root insert with a default caption', () => {
    const scene = compileTree('insert 6 6');
    expect(scene.steps).toHaveLength(1);
    expect(scene.steps[0]).toEqual({
      caption: 'Insert "6" as the root.',
      insert: { id: '6', label: '6', parent: null, side: undefined, color: undefined },
    });
  });

  it('parses a child insert with parent/side/color, default caption reflects the side', () => {
    const scene = compileTree('insert 5 5 parent=6 side=left color=red');
    expect(scene.steps[0]).toEqual({
      caption: 'Insert "5" as the left child of "6".',
      insert: { id: '5', label: '5', parent: '6', side: 'left', color: 'red' },
    });
  });

  it('defaults the caption to "left child" when side is omitted from a non-root insert', () => {
    const scene = compileTree('insert 5 5 parent=6');
    expect(scene.steps[0].caption).toBe('Insert "5" as the left child of "6".');
  });

  it('a "| note" overrides the default caption without changing the parsed command', () => {
    const scene = compileTree('insert 5 5 parent=6 side=right | Goes right because 5 > 6? No -- test note.');
    expect(scene.steps[0].caption).toBe('Goes right because 5 > 6? No -- test note.');
    expect(scene.steps[0].insert).toEqual({ id: '5', label: '5', parent: '6', side: 'right', color: undefined });
  });

  it('parses recolor with a default caption', () => {
    const scene = compileTree('recolor 5 black');
    expect(scene.steps[0]).toEqual({ caption: 'Recolor "5" black.', recolor: { id: '5', color: 'black' } });
  });

  it('parses rotate-left and rotate-right with default captions', () => {
    const scene = compileTree('rotate-left 10\nrotate-right 20');
    expect(scene.steps[0]).toEqual({ caption: 'Rotate left at "10".', rotateLeft: { at: '10' } });
    expect(scene.steps[1]).toEqual({ caption: 'Rotate right at "20".', rotateRight: { at: '20' } });
  });

  it('parses remove with a default caption', () => {
    const scene = compileTree('remove 15');
    expect(scene.steps[0]).toEqual({ caption: 'Remove "15".', remove: { id: '15' } });
  });

  it('parses mark as a highlight step with a default caption', () => {
    const scene = compileTree('mark 8');
    expect(scene.steps[0]).toEqual({ caption: 'Look at "8".', highlight: { id: '8' } });
  });

  it('parses a full multi-command trace in order, skipping blank lines', () => {
    const scene = compileTree(`
      insert 10 10
      insert 5 5 parent=10 side=left

      rotate-right 10
    `);
    expect(scene.steps).toHaveLength(3);
    expect(scene.steps[0].insert?.id).toBe('10');
    expect(scene.steps[1].insert?.id).toBe('5');
    expect(scene.steps[2].rotateRight).toEqual({ at: '10' });
  });
});
