import { describe, it, expect } from 'vitest';
import { getLevelForXp, minXpForLevel } from '../src/xp/levels';

// The fixed table that shipped before the open formula: the reference no user may fall below.
const OLD_LEVELS = [
  { number: 1, minXp: 0 }, { number: 2, minXp: 100 }, { number: 3, minXp: 300 }, { number: 4, minXp: 600 },
  { number: 5, minXp: 1000 }, { number: 6, minXp: 1500 }, { number: 7, minXp: 2200 }, { number: 8, minXp: 3000 },
  { number: 9, minXp: 4000 }, { number: 10, minXp: 5500 },
];
const oldLevel = (xp: number) => OLD_LEVELS.reduce((acc, l) => (xp >= l.minXp ? l.number : acc), 1);

describe('getLevelForXp', () => {
  it('never puts anyone below the level the old table gave, for every XP from 0 to 20000', () => {
    for (let xp = 0; xp <= 20000; xp++) {
      expect(getLevelForXp(xp).number, `xp ${xp}`).toBeGreaterThanOrEqual(oldLevel(xp));
    }
  });

  it('keeps levels 1 to 6 exactly where they were', () => {
    for (const { number, minXp } of OLD_LEVELS.slice(0, 6)) expect(minXpForLevel(number)).toBe(minXp);
  });

  it('switches level exactly on the threshold, never one XP early or late', () => {
    for (let n = 2; n <= 60; n++) {
      const at = minXpForLevel(n);
      expect(getLevelForXp(at).number, `at ${at}`).toBe(n);
      expect(getLevelForXp(at - 1).number, `before ${at}`).toBe(n - 1);
    }
  });

  it('reports min and next thresholds that bracket the XP', () => {
    for (const xp of [0, 1, 99, 100, 4499, 4500, 12345, 99999]) {
      const level = getLevelForXp(xp);
      expect(level.minXp).toBeLessThanOrEqual(xp);
      expect(level.nextLevelXp!).toBeGreaterThan(xp);
    }
  });

  it('has no top level: a very large catalog keeps raising the level', () => {
    expect(getLevelForXp(1_000_000).number).toBeGreaterThan(100);
    expect(getLevelForXp(1_000_000).nextLevelXp).not.toBeNull();
  });

  it('keeps the starter titles and replaces "OCP Master" with a career ladder', () => {
    expect(getLevelForXp(0).title).toBe('Hello World');
    expect(getLevelForXp(minXpForLevel(9)).title).toBe('JVM Whisperer');
    const titles = [10, 14, 15, 19, 20, 24, 25, 40].map((n) => getLevelForXp(minXpForLevel(n)).title);
    expect(titles).toEqual(['Senior', 'Senior', 'Staff', 'Staff', 'Principal', 'Principal', 'Distinguished', 'Distinguished']);
  });

  it('treats negative and non-finite XP as the first level', () => {
    expect(getLevelForXp(-50).number).toBe(1);
    expect(getLevelForXp(Number.NaN).number).toBe(1);
  });
});
