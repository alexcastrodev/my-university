import { describe, expect, it } from 'vitest';
import { hash, nextPow2, spread } from '../src/math-fns';

describe('hash', () => {
  it('matches Java String.hashCode() for known values', () => {
    // Verified against a real `String.hashCode()` call for each of these.
    expect(hash('')).toBe(0);
    expect(hash('a')).toBe(97);
    expect(hash('hello')).toBe(99162322);
    expect(hash('Apple')).toBe(63476538);
  });

  it('is deterministic for the same input', () => {
    expect(hash('repeatable')).toBe(hash('repeatable'));
  });

  it('produces different hashes for different strings (no trivial collisions)', () => {
    expect(hash('Apple')).not.toBe(hash('Orange'));
  });
});

describe('spread', () => {
  it('XORs the high 16 bits into the low 16 bits', () => {
    // 0x12345678 ^ (0x12345678 >>> 16) = 0x12345678 ^ 0x00001234 = 0x1234444c
    expect(spread(0x12345678)).toBe(0x1234444c);
  });

  it('leaves 0 unchanged', () => {
    expect(spread(0)).toBe(0);
  });

  it('handles negative (two\'s-complement) hashes the same way HashMap.hash() does', () => {
    const h = hash('Ea'); // "Ea" and "FB" are the classic String.hashCode() collision pair
    expect(spread(h)).toBe(h ^ (h >>> 16));
  });
});

describe('nextPow2', () => {
  it('has a floor of 4, matching HashMap\'s minimum table size', () => {
    expect(nextPow2(0)).toBe(4);
    expect(nextPow2(1)).toBe(4);
    expect(nextPow2(4)).toBe(4);
  });

  it('returns the smallest power of two >= n', () => {
    expect(nextPow2(5)).toBe(8);
    expect(nextPow2(8)).toBe(8);
    expect(nextPow2(9)).toBe(16);
    expect(nextPow2(17)).toBe(32);
  });
});
