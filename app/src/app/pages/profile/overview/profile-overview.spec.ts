import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AchievementsView, AwardView } from '../../../models/achievements.model';
import { AreaXpBreakdownEntry, DailyGoalStatus, StreakInfo, XpSummary } from '../../../models/xp.model';
import { XpService } from '../../../services/xp.service';
import { COMPLEMENTARY_AREAS } from '../../computer-science/complementary-studies.data';
import { ProfileOverview } from './profile-overview';

const SUMMARY: XpSummary = { total: 150, level: { number: 2, title: 'Syntax Sprout', minXp: 100, nextLevelXp: 300 }, breakdown: [{ sourceType: 'lesson', total: 150 }] };
const award = (n: number, type: 'badge' | 'trophy' = 'badge'): AwardView => ({
  type, id: `a${n}`, title: `Award ${n}`, trackTitle: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts', exp: 10,
  awardedAt: '2026-10-01T00:00:00.000Z', retired: false, passed: false,
});

interface Options {
  summary?: XpSummary | null;
  streak?: StreakInfo | null;
  dailyGoal?: DailyGoalStatus | null;
  areas?: AreaXpBreakdownEntry[];
  achievements?: AchievementsView | null;
}

function setup(o: Options = {}) {
  const { summary = SUMMARY, streak = null, dailyGoal = null, areas = [], achievements = null } = o;
  TestBed.configureTestingModule({
    imports: [ProfileOverview],
    providers: [
      provideZonelessChangeDetection(), provideRouter([]),
      { provide: XpService, useValue: { summary: signal(summary), streak: signal(streak), dailyGoal: signal(dailyGoal), areas: signal(areas), achievements: signal(achievements) } },
    ],
  });
  const fixture = TestBed.createComponent(ProfileOverview);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, q: (sel: string) => el.querySelector(sel) as HTMLElement | null };
}

describe('ProfileOverview', () => {
  describe('latest achievements', () => {
    it('explains how to earn the first one when there is none, and offers no "See all"', () => {
      const { q, el } = setup({ achievements: { awards: [], progress: [] } });
      expect(q('.empty-state')!.textContent).toContain('Finish every concept in a session to earn a badge');
      expect(el.querySelector('app-award-tile')).toBeNull();
      expect(q('[data-testid="see-all"]')).toBeNull();
    });

    it('points to everything that can be earned when there is nothing yet', () => {
      const { q } = setup({ achievements: { awards: [], progress: [] } });
      expect(q('[data-testid="see-available"]')!.getAttribute('href')).toContain('/profile/achievements?view=available');
    });

    it('shows the newest few, as compact tiles, with a link to all of them', () => {
      const awards = Array.from({ length: 9 }, (_, i) => award(i + 1));
      const { el, q } = setup({ achievements: { awards, progress: [] } });
      expect(Array.from(el.querySelectorAll('.award-title')).map((n) => n.textContent)).toEqual(['Award 1', 'Award 2', 'Award 3', 'Award 4', 'Award 5', 'Award 6']);
      expect(q('[data-testid="see-all"]')!.getAttribute('href')).toBe('/profile/achievements');
    });

    it('mixes trophies and badges in the order the API gave them', () => {
      const { el } = setup({ achievements: { awards: [award(1, 'trophy'), award(2)], progress: [] } });
      expect(el.querySelectorAll('.award-trophy')).toHaveSize(1);
      expect(el.querySelectorAll('app-award-tile')).toHaveSize(2);
    });
  });

  describe('streak, favorite topic and daily goal', () => {
    it('hides the Streak card until streak data has loaded', () => {
      expect(setup({ streak: null }).q('.streak-card')).toBeNull();
    });

    it('shows the current streak big and the longest one under it', () => {
      const { q } = setup({ streak: { current: 4, longest: 9 } });
      expect(q('[data-testid="streak-current"]')!.textContent).toBe('4');
      expect(q('[data-testid="streak-longest"]')!.textContent).toBe('9');
      expect(q('.streak-now')!.classList.contains('streak-zero')).toBe(false);
    });

    it('fills the streak bar by how close the current streak is to the longest', () => {
      const { q } = setup({ streak: { current: 3, longest: 12 } });
      expect(q('.streak-meter .progress-fill')!.getAttribute('style')).toContain('25%');
    });

    it('keeps the streak bar empty when there is no record yet', () => {
      expect(setup({ streak: { current: 0, longest: 0 } }).q('.streak-meter .progress-fill')!.getAttribute('style')).toContain('0%');
    });

    it('uses singular wording for a 1-day streak', () => {
      expect(setup({ streak: { current: 1, longest: 1 } }).q('.streak-now-unit')!.textContent!.trim()).toBe('day');
    });

    it('dims a zero current streak and invites the user to start one', () => {
      const { q } = setup({ streak: { current: 0, longest: 9 } });
      expect(q('.streak-now')!.classList.contains('streak-zero')).toBe(true);
      expect(q('[data-testid="streak-hint"]')!.textContent).toContain('Study today to start a new streak');
    });

    it('says when the current streak is the longest one', () => {
      expect(setup({ streak: { current: 9, longest: 9 } }).q('[data-testid="streak-hint"]')!.textContent).toContain('your longest streak');
    });

    it('encourages beating the record while the current streak is below it', () => {
      expect(setup({ streak: { current: 4, longest: 9 } }).q('[data-testid="streak-hint"]')!.textContent).toContain('beat your longest streak');
    });

    it('names the favorite topic from the XP breakdown', () => {
      const { q } = setup({ summary: { ...SUMMARY, breakdown: [{ sourceType: 'lesson', total: 50 }, { sourceType: 'concept-read', total: 150 }] } });
      expect(q('.favorite-topic-value')!.textContent!.trim()).toBe('Concepts');
      expect(q('.favorite-topic-sub')!.textContent).toContain('150 XP earned');
    });

    it('says how much of all the XP the favorite topic is, with a bar to match', () => {
      const { q } = setup({ summary: { ...SUMMARY, breakdown: [{ sourceType: 'lesson', total: 50 }, { sourceType: 'concept-read', total: 150 }] } });
      expect(q('.favorite-topic-share')!.textContent).toContain('75% of your XP');
      expect(q('.favorite-topic-card > .topic-meter .progress-fill')!.getAttribute('style')).toContain('75%');
    });

    it('lists the next two topics under the favorite one, with their XP', () => {
      const { el } = setup({ summary: { ...SUMMARY, breakdown: [
        { sourceType: 'lesson', total: 100 }, { sourceType: 'skill-check', total: 60 }, { sourceType: 'badge', total: 30 }, { sourceType: 'trophy', total: 10 },
      ] } });
      const rows = Array.from(el.querySelectorAll('.runners-up li')).map((li) => li.querySelector('.runner-xp')!.textContent);
      expect(rows).toEqual(['60 XP', '30 XP']);
    });

    it('lists no runners-up when only one kind of XP exists', () => {
      expect(setup().q('.runners-up')).toBeNull();
    });

    it('uses the area name when the concept XP is split by area, never "Java Concepts"', () => {
      const spring = COMPLEMENTARY_AREAS.find((a) => a.slug === 'spring-concepts')!.title;
      const { q, el } = setup({
        summary: { ...SUMMARY, breakdown: [{ sourceType: 'concept-read', total: 150 }] },
        areas: [{ module: 'spring-concepts', xp: 90, lastActivityAt: '2026-10-01T00:00:00.000Z' }],
      });
      expect(q('.favorite-topic-value')!.textContent!.trim()).toBe(spring);
      expect(el.textContent).not.toContain('Java Concepts');
    });

    it('says there is not enough data when there is no XP yet', () => {
      const { q } = setup({ summary: { total: 0, level: { number: 1, title: 'Hello World', minXp: 0, nextLevelXp: 100 }, breakdown: [] } });
      expect(q('.favorite-topic-empty')!.textContent).toContain('Not enough data yet');
    });

    it('shows the daily goal progress and what is left', () => {
      const { el, fixture } = setup({ dailyGoal: { earnedToday: 12, goal: 30 } });
      expect(el.textContent).toContain('12 / 30 XP today');
      expect(el.textContent).toContain('18 XP to go');
      expect((fixture.componentInstance as unknown as { dailyGoalPercent(): number }).dailyGoalPercent()).toBe(40);
    });

    it('says so when the daily goal is met', () => {
      expect(setup({ dailyGoal: { earnedToday: 30, goal: 30 } }).el.textContent).toContain('Goal reached');
    });

    it('does not draw the Daily Goal card until data has loaded', () => {
      const titles = Array.from(setup({ dailyGoal: null }).el.querySelectorAll('.section-title')).map((e) => e.textContent);
      expect(titles).not.toContain('Daily Goal');
    });
  });
});
