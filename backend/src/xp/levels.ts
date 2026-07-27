export interface Level {
  number: number;
  title: string;
  minXp: number;
}

export const LEVELS: Level[] = [
  { number: 1, title: 'Hello World', minXp: 0 },
  { number: 2, title: 'Syntax Sprout', minXp: 100 },
  { number: 3, title: 'Compiler Whisperer', minXp: 300 },
  { number: 4, title: 'Loop Wrangler', minXp: 600 },
  { number: 5, title: 'Exception Handler', minXp: 1000 },
  { number: 6, title: 'Stream Sorcerer', minXp: 1500 },
  { number: 7, title: 'Concurrency Tamer', minXp: 2200 },
  { number: 8, title: 'Generics Jedi', minXp: 3000 },
  { number: 9, title: 'JVM Whisperer', minXp: 4000 },
  { number: 10, title: 'OCP Master', minXp: 5500 },
];

export interface LevelProgress extends Level {
  /** XP required to reach the next level, or null when already at the max level. */
  nextLevelXp: number | null;
}

export function getLevelForXp(xp: number): LevelProgress {
  const currentIndex = LEVELS.reduce(
    (acc, level, i) => (xp >= level.minXp ? i : acc),
    0,
  );
  const current = LEVELS[currentIndex];
  const next = LEVELS[currentIndex + 1];
  return { ...current, nextLevelXp: next?.minXp ?? null };
}
