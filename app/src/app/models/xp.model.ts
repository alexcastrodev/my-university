export type XpSourceType =
  | 'lesson'
  | 'skill-check'
  | 'concept-read'
  | 'episode-watched'
  // The daily session was removed; its XP stays in the ledger.
  | 'daily-card'
  | 'badge'
  | 'trophy';

export interface XpLevel {
  number: number;
  title: string;
  minXp: number;
  nextLevelXp: number | null;
}

export interface XpBreakdownEntry {
  sourceType: XpSourceType;
  total: number;
}

export interface XpSummary {
  total: number;
  level: XpLevel;
  breakdown: XpBreakdownEntry[];
}

export interface XpHistoryEntry {
  id: number;
  sourceType: XpSourceType;
  sourceId: string;
  exp: number;
  updatedAt: string;
}

export interface StreakInfo {
  current: number;
  longest: number;
}

export interface DailyGoalStatus {
  earnedToday: number;
  goal: number;
}

/** One page of the activity list; `hasMore` says whether "Load more" has anything left to fetch. */
export interface XpHistoryPage {
  items: XpHistoryEntry[];
  hasMore: boolean;
}

export interface LeaderboardEntry {
  userId: number;
  /** Where the row links to: the board only lists users whose profile is public. */
  publicProfileId: string;
  /** The vanity link the user chose, when there is one: the row links to it in preference to the id. */
  profileSlug: string | null;
  displayName: string;
  avatarUrl: string;
  total: number;
  levelNumber: number;
}

export interface AreaXpBreakdownEntry {
  module: string;
  xp: number;
  lastActivityAt: string;
}
