import { describe, it, expect } from 'vitest';
import { hashSeed, orderFeed } from '../src/feed/feed-order';

const item = (module: string, n: number, read = false) => ({ module, id: `${module}-${n}`, read });

describe('orderFeed', () => {
  const items = [
    ...[1, 2, 3, 4].map((n) => item('java', n)),
    ...[1, 2].map((n) => item('spring', n)),
    ...[1, 2, 3].map((n) => item('cs', n)),
  ];

  it('keeps every item exactly once', () => {
    const ordered = orderFeed(items, 42);
    expect(ordered).toHaveLength(items.length);
    expect(new Set(ordered.map((i) => i.id)).size).toBe(items.length);
  });

  it('is stable for the same seed and changes with another one', () => {
    const a = orderFeed(items, hashSeed('7:all:2026-09-26')).map((i) => i.id);
    const b = orderFeed(items, hashSeed('7:all:2026-09-26')).map((i) => i.id);
    const c = orderFeed(items, hashSeed('7:all:2026-09-27')).map((i) => i.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('round-robins areas so the first cards all come from different ones', () => {
    const firstThree = orderFeed(items, 1).slice(0, 3).map((i) => i.module);
    expect(new Set(firstThree).size).toBe(3);
  });

  it('puts what was already marked "Got it" after everything else', () => {
    const mixed = [item('java', 1, true), item('java', 2), item('cs', 1, true), item('cs', 2)];
    const ordered = orderFeed(mixed, 5);
    expect(ordered.slice(0, 2).every((i) => !i.read)).toBe(true);
    expect(ordered.slice(2).every((i) => i.read)).toBe(true);
  });
});
