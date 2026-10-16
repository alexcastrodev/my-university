export interface Level {
  number: number;
  title: string;
  minXp: number;
}

/** Titles of levels 1 to 9, unchanged from the original fixed table. */
const STARTER_TITLES = [
  'Hello World',
  'Syntax Sprout',
  'Compiler Whisperer',
  'Loop Wrangler',
  'Exception Handler',
  'Stream Sorcerer',
  'Concurrency Tamer',
  'Generics Jedi',
  'JVM Whisperer',
];

/** From level 10 a title covers a band of levels, highest band first. */
const CAREER_TITLES = [
  { from: 25, title: 'Distinguished' },
  { from: 20, title: 'Principal' },
  { from: 15, title: 'Staff' },
  { from: 10, title: 'Senior' },
];

/**
 * XP needed to reach level `n`: 50 * n * (n - 1). Levels 1 to 6 match the old fixed table exactly
 * (0, 100, 300, 600, 1000, 1500); from 7 on a level is reached slightly earlier than before, so no
 * one's level can drop. There is no top level: the catalog can keep growing and a level keeps meaning something.
 */
export const minXpForLevel = (n: number): number => 50 * n * (n - 1);

const titleFor = (n: number): string =>
  n <= STARTER_TITLES.length ? STARTER_TITLES[n - 1] : CAREER_TITLES.find((c) => n >= c.from)!.title;

export interface LevelProgress extends Level {
  /** XP required to reach the next level. Kept nullable for API compatibility: it is never null now. */
  nextLevelXp: number | null;
}

export function getLevelForXp(xp: number): LevelProgress {
  const safe = Math.max(0, Number.isFinite(xp) ? xp : 0);
  let n = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * safe) / 50)) / 2));
  // The float estimate can be off by one right at a boundary: settle it with exact integer math.
  while (minXpForLevel(n + 1) <= safe) n += 1;
  while (n > 1 && minXpForLevel(n) > safe) n -= 1;
  return { number: n, title: titleFor(n), minXp: minXpForLevel(n), nextLevelXp: minXpForLevel(n + 1) };
}
