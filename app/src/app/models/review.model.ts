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

export interface MarkCounts {
  active: number;
  expired: number;
}

export interface RecentActivityItem {
  date: string;
  module: string;
  slug: string;
  title: string;
  route: string[];
  exp: number;
}

export interface RevisitItem {
  oldTitle: string;
  oldRoute: string[];
  oldReadAt: string;
  newTitle: string;
  newRoute: string[];
  newPublishedAt: string;
}

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewAnswerResult {
  dueAt: string;
  intervalDays: number;
}
