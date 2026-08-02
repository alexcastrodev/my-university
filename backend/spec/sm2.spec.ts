import { describe, it, expect } from 'vitest';
import { nextSchedule, Sm2State } from '../src/review/sm2';

const FRESH: Sm2State = { easeFactor: 2.5, intervalDays: 0, repetitions: 0 };

describe('nextSchedule (simplified SM-2)', () => {
  it('"again" resets repetitions and interval to 1, and lowers ease', () => {
    const state: Sm2State = { easeFactor: 2.5, intervalDays: 20, repetitions: 4 };
    const next = nextSchedule(state, 'again');
    expect(next).toEqual({ easeFactor: 2.3, repetitions: 0, intervalDays: 1 });
  });

  it('never drops ease factor below the floor of 1.3', () => {
    const state: Sm2State = { easeFactor: 1.35, intervalDays: 5, repetitions: 2 };
    const next = nextSchedule(state, 'again');
    expect(next.easeFactor).toBe(1.3);
  });

  it('first "good" schedules a 1-day interval', () => {
    const next = nextSchedule(FRESH, 'good');
    expect(next).toEqual({ easeFactor: 2.5, intervalDays: 1, repetitions: 1 });
  });

  it('second consecutive "good" schedules a 6-day interval', () => {
    const afterFirst = nextSchedule(FRESH, 'good');
    const afterSecond = nextSchedule(afterFirst, 'good');
    expect(afterSecond).toEqual({ easeFactor: 2.5, intervalDays: 6, repetitions: 2 });
  });

  it('third+ "good" multiplies the previous interval by the ease factor', () => {
    const state: Sm2State = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };
    const next = nextSchedule(state, 'good');
    expect(next).toEqual({ easeFactor: 2.5, intervalDays: 15, repetitions: 3 });
  });

  it('"hard" grows the interval more slowly and lowers ease', () => {
    const state: Sm2State = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };
    const next = nextSchedule(state, 'hard');
    // ease drops to 2.35, interval = round(6 * 2.35) = 14, then *0.8 = 11.2 -> 11
    expect(next.easeFactor).toBe(2.35);
    expect(next.intervalDays).toBe(11);
    expect(next.repetitions).toBe(3);
  });

  it('"easy" grows the interval faster and raises ease', () => {
    const state: Sm2State = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };
    const next = nextSchedule(state, 'easy');
    // ease rises to 2.65, interval = round(6 * 2.65) = 16, then *1.3 = 20.8 -> 21
    expect(next.easeFactor).toBe(2.65);
    expect(next.intervalDays).toBe(21);
    expect(next.repetitions).toBe(3);
  });

  it('interval never drops below 1 day even for "hard" on a short interval', () => {
    const state: Sm2State = { easeFactor: 1.3, intervalDays: 1, repetitions: 2 };
    const next = nextSchedule(state, 'hard');
    expect(next.intervalDays).toBeGreaterThanOrEqual(1);
  });
});
