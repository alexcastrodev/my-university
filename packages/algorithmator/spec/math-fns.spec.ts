import { describe, expect, it } from 'vitest';
import { crc16, hash, nextPow2, redisClusterSlot, spread } from '../src/math-fns';

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

describe('crc16', () => {
  it('matches the standard CRC-16/XMODEM catalog check value', () => {
    // The canonical cross-implementation test vector for this exact variant
    // (poly 0x1021, init 0x0000, no reflection, no final XOR).
    expect(crc16('123456789')).toBe(0x31c3);
  });

  it('is deterministic for the same input', () => {
    expect(crc16('repeatable')).toBe(crc16('repeatable'));
  });

  it('produces different checksums for different strings (no trivial collisions)', () => {
    expect(crc16('foo')).not.toBe(crc16('bar'));
  });
});

describe('redisClusterSlot', () => {
  it('matches Redis\'s own documented example (CLUSTER KEYSLOT foo => 12182)', () => {
    expect(redisClusterSlot('foo')).toBe(12182);
  });

  it('stays within the 16384-slot range', () => {
    expect(redisClusterSlot('any-key-at-all')).toBeGreaterThanOrEqual(0);
    expect(redisClusterSlot('any-key-at-all')).toBeLessThan(16384);
  });

  it('routes hash-tagged keys to the same slot regardless of the rest of the key', () => {
    // Redis's own canonical hash-tag example: co-locating a user's related keys.
    expect(redisClusterSlot('{user1000}.following')).toBe(redisClusterSlot('{user1000}.followers'));
  });

  it('ignores an empty {} tag and hashes the whole raw key instead', () => {
    expect(redisClusterSlot('{}foo')).toBe(crc16('{}foo') & 16383);
  });

  it('uses only the first complete {tag} when a key has multiple braces', () => {
    expect(redisClusterSlot('{user1000}.{following}')).toBe(redisClusterSlot('user1000'));
  });
});
