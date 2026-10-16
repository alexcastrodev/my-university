export type AwardType = 'badge' | 'trophy';

/** One badge (a finished session) or trophy (a finished track), as the API describes it. */
export interface AwardView {
  type: AwardType;
  id: string;
  title: string;
  trackTitle: string;
  /** Slug understood by `app-track-icon`; unknown slugs draw a book. */
  iconSlug: string;
  exp: number;
  awardedAt: string;
  /** Belongs to a track that left the catalog: shown as "previous catalog", never as progress. */
  retired: boolean;
  /** An OCP badge whose module ends in a knowledge check. Self-reported, like every completion here. */
  passed: boolean;
}

export interface SessionProgressView {
  sessionId: string;
  title: string;
  done: number;
  total: number;
  complete: boolean;
  awarded: boolean;
  newSinceAward: number;
}

export interface TrackProgressView {
  trackId: string;
  title: string;
  iconSlug: string;
  done: number;
  total: number;
  complete: boolean;
  awarded: boolean;
  newSinceAward: number;
  sessions: SessionProgressView[];
  /** Router commands to the first unread unit. A suggestion, never a gate. */
  nextRoute: string[] | null;
}

export interface AchievementsView {
  awards: AwardView[];
  progress: TrackProgressView[];
}
