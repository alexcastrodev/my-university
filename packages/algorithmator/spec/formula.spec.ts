import { describe, expect, it } from 'vitest';
import { compileFormula } from '../src/formula';

describe('compileFormula', () => {
  it('throws when the config does not declare "slot"', () => {
    expect(() => compileFormula('capacity = 8')).toThrow(/must declare "slot/i);
  });

  it('throws on a malformed declaration line', () => {
    expect(() => compileFormula('slot = index\nnotAnAssignment')).toThrow(/Invalid formula line/i);
  });

  it('generates capacity-many slots when capacity is declared, labeled by index', () => {
    const scene = compileFormula('capacity = 8\nslot = index')(['A', 'B', 'C']);
    expect(scene.slots).toHaveLength(8);
    expect(scene.slots[0]).toEqual({ id: '0', label: '0' });
    expect(scene.meta).toBe('Capacity: 8');
  });

  it('derives slots from distinct produced values, in first-seen order, when capacity is absent', () => {
    const scene = compileFormula('slot = item')(['b', 'a', 'b', 'c']);
    expect(scene.slots.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(scene.meta).toBeUndefined();
  });

  it('places each item into the slot the formula computes, one place step per item', () => {
    const scene = compileFormula('capacity = 4\nslot = index % capacity')(['x', 'y', 'z']);
    expect(scene.steps).toHaveLength(3);
    expect(scene.steps[0].place).toEqual({ token: 'x', slot: '0' });
    expect(scene.steps[1].place).toEqual({ token: 'y', slot: '1' });
    expect(scene.steps[2].place).toEqual({ token: 'z', slot: '2' });
  });

  it('captions every step landing in a slot that ever collides — including the first occupant', () => {
    const scene = compileFormula('capacity = 2\nslot = index % capacity')(['a', 'b', 'c']);
    // a->0, b->1, c->0 (collides with a): slot "0" is flagged as a collision slot, so both
    // "a" and "c" (everything that ever lands in slot 0) are captioned as colliding — the
    // collision set tracks slots, not arrival order within a slot.
    expect(scene.steps[0].caption).toBe('"a" collides in slot 0');
    expect(scene.steps[1].caption).toBe('"b" → slot 1');
    expect(scene.steps[2].caption).toBe('"c" collides in slot 0');
  });

  it('exposes hash()/spread()/nextPow2() to the slot expression, mirroring HashMap bucket placement', () => {
    const scene = compileFormula('capacity = nextPow2(count)\nslot = (capacity - 1) & spread(hash(item))')([
      'Apple',
      'Orange',
      'Banana',
    ]);
    expect(scene.meta).toBe('Capacity: 4');
    expect(scene.steps).toHaveLength(3);
    // Every placed slot must be a valid index within the declared capacity.
    for (const step of scene.steps) {
      const slotIndex = Number(step.place!.slot);
      expect(slotIndex).toBeGreaterThanOrEqual(0);
      expect(slotIndex).toBeLessThan(4);
    }
  });

  it('rank() reflects Java natural ordering — numeric when every item parses as a number', () => {
    const scene = compileFormula('capacity = count\nslot = rank(item)')(['30', '10', '20']);
    // Numeric ordering: 10 -> rank 0, 20 -> rank 1, 30 -> rank 2.
    const slotOf = (token: string) => scene.steps.find((s) => s.place!.token === token)!.place!.slot;
    expect(slotOf('10')).toBe('0');
    expect(slotOf('20')).toBe('1');
    expect(slotOf('30')).toBe('2');
  });

  it('rank() falls back to code-point string ordering when items are not all numeric', () => {
    const scene = compileFormula('capacity = count\nslot = rank(item)')(['C', 'A', 'B']);
    const slotOf = (token: string) => scene.steps.find((s) => s.place!.token === token)!.place!.slot;
    expect(slotOf('A')).toBe('0');
    expect(slotOf('B')).toBe('1');
    expect(slotOf('C')).toBe('2');
  });

  it('rank() gives duplicate items the same rank (first-seen index of that value)', () => {
    const scene = compileFormula('capacity = count\nslot = rank(item)')(['b', 'a', 'b']);
    const slots = scene.steps.map((s) => s.place!.slot);
    // 'a' is the smallest (rank 0); both 'b's tie for rank 1.
    expect(slots[1]).toBe('0'); // the 'a'
    expect(slots[0]).toBe(slots[2]); // both 'b's share a rank
  });

  it('supports a non-capacity declaration used by the slot expression (e.g. a fixed divisor)', () => {
    const scene = compileFormula('half = count / 2\nslot = index < half ? "left" : "right"')(['a', 'b', 'c', 'd']);
    const slotOf = (token: string) => scene.steps.find((s) => s.place!.token === token)!.place!.slot;
    expect(slotOf('a')).toBe('left');
    expect(slotOf('b')).toBe('left');
    expect(slotOf('c')).toBe('right');
    expect(slotOf('d')).toBe('right');
  });

  it('reuses a compiled formula across multiple independent item lists', () => {
    const mode = compileFormula('capacity = count\nslot = index');
    const sceneA = mode(['x', 'y']);
    const sceneB = mode(['p', 'q', 'r']);
    expect(sceneA.slots).toHaveLength(2);
    expect(sceneB.slots).toHaveLength(3);
  });
});
