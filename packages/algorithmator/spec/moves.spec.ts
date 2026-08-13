import { describe, expect, it } from 'vitest';
import { compileMoves } from '../src/moves';

describe('compileMoves', () => {
  it('throws on an unknown command', () => {
    expect(() => compileMoves('teleport 0 1')(['a', 'b'])).toThrow(/Unknown move command/i);
  });

  it('places every item at its initial index before any commands run', () => {
    const scene = compileMoves('')(['a', 'b', 'c']);
    expect(scene.steps).toHaveLength(3);
    expect(scene.steps[0]).toMatchObject({ place: { token: 'a', slot: '0' } });
    expect(scene.steps[1]).toMatchObject({ place: { token: 'b', slot: '1' } });
    expect(scene.steps[2]).toMatchObject({ place: { token: 'c', slot: '2' } });
    expect(scene.layout).toBe('row');
    expect(scene.slots.map((s) => s.id)).toEqual(['0', '1', '2']);
  });

  it('emits a swap step with a default caption naming both tokens and slots', () => {
    const scene = compileMoves('swap 0 1')(['a', 'b']);
    const swapStep = scene.steps.at(-1)!;
    expect(swapStep.swap).toEqual({ tokenA: 'a', tokenB: 'b' });
    expect(swapStep.caption).toBe('Swap a[0] and a[1]: "a" ↔ "b"');
  });

  it('a swap of a slot with itself is a no-op — no extra step is emitted', () => {
    const scene = compileMoves('swap 1 1')(['a', 'b', 'c']);
    expect(scene.steps).toHaveLength(3); // only the 3 initial placements, no swap step
  });

  it('a custom "| note" caption overrides the default caption', () => {
    const scene = compileMoves('swap 0 1 | Custom explanation here.')(['a', 'b']);
    expect(scene.steps.at(-1)!.caption).toBe('Custom explanation here.');
  });

  it('mark emits a highlight step for the named slot, with a default caption', () => {
    const scene = compileMoves('mark 2')(['a', 'b', 'c']);
    const markStep = scene.steps.at(-1)!;
    expect(markStep.highlight).toEqual({ slot: '2' });
    expect(markStep.caption).toBe('Mark a[2] = "c"');
  });

  it('move reparents a token into a different slot', () => {
    const scene = compileMoves('move a 2')(['a', 'b', 'c']);
    const moveStep = scene.steps.at(-1)!;
    expect(moveStep.move).toEqual({ token: 'a', toSlot: '2' });
    expect(moveStep.caption).toBe('Move "a" to slot 2');
  });

  it('remove emits a remove step for the named token', () => {
    const scene = compileMoves('remove b')(['a', 'b', 'c']);
    const removeStep = scene.steps.at(-1)!;
    expect(removeStep.remove).toEqual({ token: 'b' });
    expect(removeStep.caption).toBe('Remove "b"');
  });

  it('applies multiple commands in the order they appear, skipping blank lines', () => {
    const scene = compileMoves('swap 0 1\n\nmark 0\n  \nremove b')(['a', 'b']);
    // 2 initial placements + swap + mark + remove = 5 steps
    expect(scene.steps).toHaveLength(5);
    expect(scene.steps[2].swap).toBeDefined();
    expect(scene.steps[3].highlight).toBeDefined();
    expect(scene.steps[4].remove).toBeDefined();
  });

  it('replaying a full trace ends with the correct final arrangement', () => {
    // Simulate the same replay logic the engine uses, to confirm swap semantics are self-consistent.
    const scene = compileMoves('swap 0 1\nswap 1 2')(['a', 'b', 'c']);
    const bySlot = new Map(scene.slots.map((s) => [s.id, [] as string[]]));
    const tokenSlot = new Map<string, string>();
    for (const step of scene.steps) {
      if (step.place) {
        bySlot.get(step.place.slot)!.push(step.place.token);
        tokenSlot.set(step.place.token, step.place.slot);
      }
      if (step.swap) {
        const { tokenA, tokenB } = step.swap;
        const slotA = tokenSlot.get(tokenA)!;
        const slotB = tokenSlot.get(tokenB)!;
        bySlot.set(slotA, bySlot.get(slotA)!.filter((t) => t !== tokenA));
        bySlot.set(slotB, bySlot.get(slotB)!.filter((t) => t !== tokenB));
        bySlot.get(slotB)!.push(tokenA);
        bySlot.get(slotA)!.push(tokenB);
        tokenSlot.set(tokenA, slotB);
        tokenSlot.set(tokenB, slotA);
      }
    }
    // a<->b then b<->c: start [a,b,c] -> [b,a,c] -> [b,c,a]
    const final = scene.slots.map((s) => bySlot.get(s.id)![0]);
    expect(final).toEqual(['b', 'c', 'a']);
  });
});
