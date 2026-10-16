export type XpSourceType =
  | 'lesson'
  | 'skill-check'
  | 'concept-read'
  | 'episode-watched'
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
