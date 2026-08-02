import { describe, it, expect } from 'vitest';
import { computeStreak, toUtcDateKey } from '../src/xp/streak';

const TODAY = '2026-08-02';
const YESTERDAY = '2026-08-01';

function daysBefore(base: string, count: number): string[] {
  const [y, m, d] = base.split('-').map(Number);
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() - i);
    days.push(toUtcDateKey(date));
  }
  return days;
}

describe('toUtcDateKey', () => {
  it('formats a Date as its UTC calendar day', () => {
    expect(toUtcDateKey(new Date('2026-08-02T23:59:59.000Z'))).toBe('2026-08-02');
    expect(toUtcDateKey(new Date('2026-08-02T00:00:00.000Z'))).toBe('2026-08-02');
  });
});

describe('computeStreak', () => {
  it('no activity at all -> current 0, longest 0', () => {
    expect(computeStreak([], TODAY)).toEqual({ current: 0, longest: 0 });
  });

  it('only today has activity -> current 1, longest 1', () => {
    expect(computeStreak([TODAY], TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it('only yesterday has activity (not yet studied today) -> streak still alive', () => {
    expect(computeStreak([YESTERDAY], TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it('broken gap: activity a few days ago but neither today nor yesterday -> current 0', () => {
    const fiveDaysAgo = daysBefore(TODAY, 6)[5];
    expect(computeStreak([fiveDaysAgo], TODAY)).toEqual({ current: 0, longest: 1 });
  });

  it('long consecutive run ending today', () => {
    const days = daysBefore(TODAY, 7); // today .. 6 days ago, all consecutive
    expect(computeStreak(days, TODAY)).toEqual({ current: 7, longest: 7 });
  });

  it('long consecutive run that already broke (ended 3 days ago) keeps longest but zeroes current', () => {
    // Activity from 7..3 days ago (5 consecutive days), then nothing for the last 3 days.
    const all = daysBefore(TODAY, 8); // today .. 7 days ago
    const oldRun = all.slice(3); // drop today, yesterday, and 2 days ago
    expect(computeStreak(oldRun, TODAY)).toEqual({ current: 0, longest: 5 });
  });

  it('longest can be a past run even when current run is shorter and ongoing', () => {
    // A run of 4 consecutive days far in the past, plus today+yesterday (current run of 2).
    const pastRun = daysBefore(TODAY, 12).slice(8); // 4 consecutive days, well before yesterday
    const days = [...pastRun, YESTERDAY, TODAY];
    const result = computeStreak(days, TODAY);
    expect(result.current).toBe(2);
    expect(result.longest).toBe(4);
  });

  it('duplicate day entries do not inflate the streak', () => {
    expect(computeStreak([TODAY, TODAY, TODAY], TODAY)).toEqual({ current: 1, longest: 1 });
  });
});
