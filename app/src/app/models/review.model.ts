export type ReviewSourceType = 'concept-read' | 'episode-watched';

export interface ReviewQueueItem {
  sourceType: ReviewSourceType;
  sourceId: string;
  module: string;
  slug: string;
  title: string;
  route: string[];
  dueAt: string;
}

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewAnswerResult {
  dueAt: string;
  intervalDays: number;
}
