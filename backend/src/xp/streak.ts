/** Pure UTC-calendar-day streak calculation, kept DB-free so it can be unit-tested in isolation (same pattern as `review/sm2.ts`). */

export interface StreakResult {
  current: number;
  longest: number;
}

/** Returns the UTC calendar-day key (`YYYY-MM-DD`) for a given Date. */
export function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateKey: string, delta: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + delta);
  return toUtcDateKey(date);
}

/**
 * Given the distinct UTC calendar days a user had at least one XP entry on, and today's
 * UTC calendar day, computes:
 *  - `current`: the consecutive-day streak walking backward from today. It is still
 *    "alive" (not yet broken) if today has no entry yet but yesterday does — the user
 *    just hasn't studied today *yet*. It's broken (0) if neither today nor yesterday has
 *    an entry.
 *  - `longest`: the longest consecutive run found anywhere in the history.
 */
export function computeStreak(
  activityDays: Iterable<string>,
  today: string,
): StreakResult {
  const days = new Set(activityDays);
  const sorted = Array.from(days).sort();

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    run = previous !== null && addUtcDays(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }

  let cursor = today;
  if (!days.has(cursor)) {
    const yesterday = addUtcDays(today, -1);
    if (!days.has(yesterday)) {
      return { current: 0, longest };
    }
    cursor = yesterday;
  }

  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor = addUtcDays(cursor, -1);
  }

  return { current, longest };
}
