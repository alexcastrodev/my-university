import { AreaXpBreakdownEntry, XpSummary } from '../models/xp.model';
import { COMPLEMENTARY_AREAS } from '../pages/computer-science/complementary-studies.data';
import { buildBreakdownRows, sourceLabel } from './xp-breakdown';

const summary = (breakdown: XpSummary['breakdown']): XpSummary => ({ total: 0, level: { number: 1, title: 'x', minXp: 0, nextLevelXp: 100 }, breakdown });
const area = (module: string, xp: number): AreaXpBreakdownEntry => ({ module, xp, lastActivityAt: '2026-10-01T00:00:00.000Z' });

describe('buildBreakdownRows', () => {
  it('is empty without a summary or without XP', () => {
    expect(buildBreakdownRows(null, [])).toEqual([]);
    expect(buildBreakdownRows(summary([]), [])).toEqual([]);
  });

  it('keeps non-reading kinds as they are, biggest first', () => {
    const rows = buildBreakdownRows(summary([{ sourceType: 'lesson', total: 30 }, { sourceType: 'badge', total: 50 }]), []);
    expect(rows.map((r) => [r.key, r.total])).toEqual([['badge', 50], ['lesson', 30]]);
    expect(rows[0].label).toBe('profile.source.badges');
  });

  it('calls unclaimed concept XP "Concepts" and never "Java Concepts"', () => {
    const rows = buildBreakdownRows(summary([{ sourceType: 'concept-read', total: 100 }]), []);
    expect(rows).toEqual([{ key: 'concepts', label: 'profile.source.concepts', total: 100 }]);
  });

  it('splits concept and minute XP by area, leaving the remainder under Concepts', () => {
    const spring = COMPLEMENTARY_AREAS.find((a) => a.slug === 'spring-concepts')!.title;
    const rows = buildBreakdownRows(
      summary([{ sourceType: 'concept-read', total: 100 }, { sourceType: 'episode-watched', total: 20 }]),
      [area('spring-concepts', 90), area('computer-science', 10)],
    );
    expect(rows.map((r) => [r.label, r.total])).toEqual([[spring, 90], ['profile.source.concepts', 20], ['Computer Science', 10]]);
  });

  it('does not invent a Concepts row when the areas already account for every reading XP', () => {
    const rows = buildBreakdownRows(summary([{ sourceType: 'concept-read', total: 50 }]), [area('spring-concepts', 50)]);
    expect(rows).toHaveSize(1);
  });
});

describe('sourceLabel', () => {
  it('maps known kinds to i18n keys and passes anything else through', () => {
    expect(sourceLabel('lesson')).toBe('profile.source.lessons');
    expect(sourceLabel('trophy')).toBe('profile.source.trophies');
    expect(sourceLabel('something-new')).toBe('something-new');
  });
});
