/**
 * Pure ordering for the mobile feed, kept DB-free so it can be unit-tested in isolation (same
 * pattern as `review/interleave.ts`).
 *
 * The feed should feel different every day without jumping around while you scroll it, so the
 * order is a shuffle seeded by user + UTC day: stable for a whole day, fresh the next one.
 * Areas are round-robined so two cards from the same track rarely sit next to each other, and
 * everything not yet marked "Got it" comes before what already was.
 */

/** Mulberry32: tiny, fast, good enough for shuffling a list. Not for anything security related. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash, to turn a `user:day` key into a numeric seed. */
export function hashSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function orderFeed<T extends { module: string; read: boolean }>(
  items: T[],
  seed: number,
): T[] {
  const random = mulberry32(seed);

  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.module) ?? [];
    group.push(item);
    groups.set(item.module, group);
  }

  const modules = shuffle([...groups.keys()], random);
  const shuffled = modules.map((m) => shuffle(groups.get(m)!, random));

  const interleaved: T[] = [];
  for (let round = 0; interleaved.length < items.length; round++) {
    for (const group of shuffled) {
      if (round < group.length) interleaved.push(group[round]);
    }
  }

  return [
    ...interleaved.filter((i) => !i.read),
    ...interleaved.filter((i) => i.read),
  ];
}
