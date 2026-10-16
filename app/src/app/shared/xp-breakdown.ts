import { AreaXpBreakdownEntry, XpSourceType, XpSummary } from '../models/xp.model';
import { COMPLEMENTARY_AREAS } from '../pages/computer-science/complementary-studies.data';

/** i18n keys that `app-source-label` turns into text; anything else (an area name) is printed as is. */
const SOURCE_LABELS: Record<string, string> = {
  lesson: 'profile.source.lessons',
  'skill-check': 'profile.source.skillChecks',
  'concept-read': 'profile.source.concepts',
  'episode-watched': 'profile.source.minutes',
  'daily-card': 'profile.source.dailyCards',
  badge: 'profile.source.badges',
  trophy: 'profile.source.trophies',
};

export const sourceLabel = (sourceType: string): string => SOURCE_LABELS[sourceType] ?? sourceType;

export interface BreakdownRow {
  key: string;
  label: string;
  total: number;
}

const READ_TYPES = new Set<XpSourceType>(['concept-read', 'episode-watched']);
const CS_TITLE = 'Computer Science';

/**
 * XP per kind of activity, biggest first. Concept and minute XP is split by area (Spring, Kubernetes, ...)
 * using the area breakdown, so nothing is called "Java Concepts" by mistake; what no area claims stays
 * under a generic "Concepts" row.
 */
export function buildBreakdownRows(summary: XpSummary | null, areas: AreaXpBreakdownEntry[]): BreakdownRow[] {
  const breakdown = summary?.breakdown ?? [];
  const rows: BreakdownRow[] = breakdown
    .filter((e) => !READ_TYPES.has(e.sourceType))
    .map((e) => ({ key: e.sourceType, label: sourceLabel(e.sourceType), total: e.total }));

  const readTotal = breakdown.filter((e) => READ_TYPES.has(e.sourceType)).reduce((sum, e) => sum + e.total, 0);
  let claimed = 0;
  for (const area of areas) {
    claimed += area.xp;
    const title = COMPLEMENTARY_AREAS.find((a) => a.slug === area.module)?.title ?? CS_TITLE;
    rows.push({ key: `area:${area.module}`, label: title, total: area.xp });
  }
  if (readTotal - claimed > 0) rows.push({ key: 'concepts', label: sourceLabel('concept-read'), total: readTotal - claimed });
  return rows.sort((a, b) => b.total - a.total);
}
