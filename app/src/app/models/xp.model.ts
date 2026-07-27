export type XpSourceType = 'lesson' | 'skill-check' | 'concept-read' | 'episode-watched';

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
