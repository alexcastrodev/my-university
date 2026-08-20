// Built-in functions exposed to formula expressions, on top of mathjs's own
// (bitwise operators, arithmetic, min/max/abs, ...). Named after their real-JDK
// counterparts so a formula reads like the mechanic it's demonstrating.

/** Java's String.hashCode(): s[0]*31^(n-1) + s[1]*31^(n-2) + ... + s[n-1]. */
export function hash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return h;
}

/** Mirrors HashMap.hash(Object): spreads the high bits into the low bits so a
 *  simple (capacity - 1) & mask still gets good distribution from a small capacity. */
export function spread(h: number): number {
  return h ^ (h >>> 16);
}

/** Smallest power of two >= n (minimum 4) — mirrors HashMap's table-sizing rule. */
export function nextPow2(n: number): number {
  let capacity = 4;
  while (capacity < n) capacity *= 2;
  return capacity;
}

/**
 * CRC-16/XMODEM (poly 0x1021, init 0x0000, no reflection, no final XOR) — the exact checksum
 * Redis Cluster uses to place a key into one of its 16384 hash slots (`slot = crc16(key) &
 * 16383`). Verified against the standard CRC catalog check value: `crc16('123456789') === 0x31c3`.
 * Distinct from `hash()` above (Java's `String.hashCode()`, used for HashMap-style content) —
 * don't substitute one for the other, they model different real algorithms.
 */
export function crc16(key: string): number {
  let crc = 0x0000;
  for (let i = 0; i < key.length; i++) {
    crc ^= key.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * Redis Cluster's hash-slot rule: `CRC16(key) mod 16384`, but honoring hash tags — if `key`
 * contains a non-empty `{...}` substring, only that substring is hashed, which is what lets an
 * application co-locate related keys (e.g. `{user1000}.following` and `{user1000}.followers`)
 * in the same slot for multi-key operations.
 */
export function redisClusterSlot(key: string): number {
  const open = key.indexOf('{');
  if (open !== -1) {
    const close = key.indexOf('}', open + 1);
    if (close > open + 1) key = key.slice(open + 1, close);
  }
  return crc16(key) & 16383;
}

export const FORMULA_FUNCTIONS = { hash, spread, nextPow2, crc16, redisClusterSlot };
