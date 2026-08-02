/** Simplified SM-2 spaced-repetition scheduling — the same idea Anki uses, minus its full complexity. */

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface Sm2State {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

const MIN_EASE_FACTOR = 1.3;

/** Given the current schedule state and how the user rated their recall, returns the next schedule state. */
export function nextSchedule(state: Sm2State, rating: ReviewRating): Sm2State {
  if (rating === 'again') {
    return {
      easeFactor: Math.max(MIN_EASE_FACTOR, state.easeFactor - 0.2),
      intervalDays: 1,
      repetitions: 0,
    };
  }

  const repetitions = state.repetitions + 1;
  let easeFactor = state.easeFactor;
  if (rating === 'hard') easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.15);
  if (rating === 'easy') easeFactor = easeFactor + 0.15;

  // First two successful reviews follow fixed steps (classic SM-2); afterward the
  // interval grows by the ease factor each time.
  let intervalDays: number;
  if (repetitions === 1) intervalDays = 1;
  else if (repetitions === 2) intervalDays = 6;
  else intervalDays = Math.round(state.intervalDays * easeFactor);

  if (rating === 'hard') intervalDays = Math.round(intervalDays * 0.8);
  if (rating === 'easy') intervalDays = Math.round(intervalDays * 1.3);

  return { easeFactor, intervalDays: Math.max(1, intervalDays), repetitions };
}
