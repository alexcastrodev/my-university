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

export type TrackKind = 'course' | 'concepts' | 'curriculum';

export interface CatalogSessionView {
  sessionId: string;
  title: string;
  total: number;
  done: number;
  /** XP the badge grants. */
  exp: number;
  awarded: boolean;
  awardedAt: string | null;
  /** The session ends in a knowledge check, so its badge reads "Passed". */
  hasAssessment: boolean;
}

/** One track as the catalog lists it: its badges (sessions), its trophy and how far the user is. */
export interface CatalogTrackView {
  trackId: string;
  title: string;
  iconSlug: string;
  kind: TrackKind;
  total: number;
  done: number;
  /** False for a track of direct units or a single session: only the trophy exists there. */
  hasBadges: boolean;
  trophy: { exp: number; awarded: boolean; awardedAt: string | null };
  /** Empty for a track of direct units (a CC discipline). */
  sessions: CatalogSessionView[];
}

export interface RequirementUnitView {
  title: string;
  /** Where the unit lives in the app, or null when it cannot be linked. */
  route: string[] | null;
  done: boolean;
}

/** What a track asks for, unit by unit. Loaded when the track is opened. */
export interface TrackRequirementsView {
  trackId: string;
  sessions: { sessionId: string; units: RequirementUnitView[] }[];
  /** The track's own units when it has no sessions; empty otherwise. */
  units: RequirementUnitView[];
}
