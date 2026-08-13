import { describe, expect, it } from 'vitest';
import { placementMode } from '../src/placement';

describe('placementMode', () => {
  it('builds slots via the supplied slots() function', () => {
    const mode = placementMode({
      slots: () => [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
      slotOf: () => 'x',
    });
    const scene = mode(['a']);
    expect(scene.slots).toEqual([{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }]);
  });

  it('calls slotOf with the item, its index, and the computed slots — once per collision-detection pass, once per step', () => {
    const calls: Array<[string, number]> = [];
    const mode = placementMode({
      slots: () => [{ id: '0', label: '0' }],
      slotOf: (item, index) => {
        calls.push([item, index]);
        return '0';
      },
    });
    mode(['a', 'b', 'c']);
    // placementMode walks the items twice (once to detect collisions, once to build steps),
    // so each item is asked for its slot twice, in the same order both times.
    expect(calls).toEqual([
      ['a', 0], ['b', 1], ['c', 2],
      ['a', 0], ['b', 1], ['c', 2],
    ]);
  });

  it('uses the default caption format when captionFor is not supplied', () => {
    const mode = placementMode({
      slots: () => [{ id: '0', label: '0' }],
      slotOf: () => '0',
    });
    const scene = mode(['solo']);
    expect(scene.steps[0].caption).toBe('"solo" → slot 0');
  });

  it('marks every item in a shared slot as a collision, including the first to arrive', () => {
    const mode = placementMode({
      slots: () => [{ id: '0', label: '0' }],
      slotOf: () => '0', // everything lands in the same slot
    });
    const scene = mode(['a', 'b', 'c']);
    expect(scene.steps[0].caption).toBe('"a" collides in slot 0');
    expect(scene.steps[1].caption).toBe('"b" collides in slot 0');
    expect(scene.steps[2].caption).toBe('"c" collides in slot 0');
  });

  it('does not flag a slot with only one occupant as a collision', () => {
    const mode = placementMode({
      slots: () => [{ id: '0', label: '0' }, { id: '1', label: '1' }],
      slotOf: (item) => (item === 'a' ? '0' : '1'),
    });
    const scene = mode(['a', 'b']);
    expect(scene.steps[0].caption).toBe('"a" → slot 0');
    expect(scene.steps[1].caption).toBe('"b" → slot 1');
  });

  it('uses meta() to compute the scene-level caption from the slots', () => {
    const mode = placementMode({
      slots: () => [{ id: '0', label: '0' }, { id: '1', label: '1' }],
      slotOf: () => '0',
      meta: (slots) => `Table size: ${slots.length}`,
    });
    const scene = mode(['a']);
    expect(scene.meta).toBe('Table size: 2');
  });

  it('honors a custom captionFor override, including the collision flag', () => {
    const mode = placementMode({
      slots: () => [{ id: '0', label: '0' }],
      slotOf: () => '0',
      captionFor: (item, slot, collision) => `${item}@${slot}${collision ? '!' : ''}`,
    });
    const scene = mode(['a', 'b']);
    // Both land in slot "0", so both are flagged as colliding.
    expect(scene.steps[0].caption).toBe('a@0!');
    expect(scene.steps[1].caption).toBe('b@0!');
  });
});
