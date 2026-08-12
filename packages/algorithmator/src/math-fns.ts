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

export const FORMULA_FUNCTIONS = { hash, spread, nextPow2 };
