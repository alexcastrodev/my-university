import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AchievementsView } from '../../models/achievements.model';
import { User } from '../../models/auth.model';
import { AreaXpBreakdownEntry, DailyGoalStatus, StreakInfo, XpHistoryEntry, XpSummary } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { COMPLEMENTARY_AREAS } from '../computer-science/complementary-studies.data';
import { ProfilePage } from './profile-page';

const USER: User = {
  id: 1,
  displayName: 'Ana',
  githubLogin: 'ana',
  avatarUrl: 'https://example.com/ana.png',
  preferredLanguage: null,
};

const SUMMARY: XpSummary = {
  total: 150,
  level: { number: 2, title: 'Syntax Sprout', minXp: 100, nextLevelXp: 300 },
  breakdown: [{ sourceType: 'lesson', total: 150 }],
};

function setup(options: {
  loggedIn?: boolean;
  summary?: XpSummary | null;
  history?: XpHistoryEntry[];
  streak?: StreakInfo | null;
  dailyGoal?: DailyGoalStatus | null;
  areas?: AreaXpBreakdownEntry[];
  achievements?: AchievementsView | null;
} = {}) {
  const { loggedIn = true, summary = SUMMARY, history = [], streak = null, dailyGoal = null, areas = [], achievements = null } = options;

  TestBed.configureTestingModule({
    imports: [ProfilePage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal(loggedIn ? USER : null) } },
      {
        provide: XpService,
        useValue: {
          summary: signal(summary),
          history: signal(history),
          streak: signal(streak),
          dailyGoal: signal(dailyGoal),
          areas: signal(areas),
          achievements: signal(achievements),
          loadAreas: () => {},
          loadSummary: () => {},
          loadHistory: () => {},
          loadStreak: () => {},
          loadDailyGoal: () => {},
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProfilePage);
  fixture.detectChanges();
  return fixture;
}

describe('ProfilePage', () => {
  it('prompts to log in when there is no session', () => {
    const fixture = setup({ loggedIn: false });

    expect(fixture.nativeElement.textContent).toContain('Log in with GitHub');
    expect(fixture.nativeElement.querySelector('.level-card')).toBeNull();
  });

  it('hides the Streak card when no streak data has loaded yet', () => {
    const fixture = setup({ streak: null });

    expect(fixture.nativeElement.querySelector('.streak-card')).toBeNull();
  });

  it('shows the current and longest streak side by side once loaded', () => {
    const fixture = setup({ streak: { current: 4, longest: 9 } });

    const values: HTMLElement[] = fixture.nativeElement.querySelectorAll('.streak-stat-value');
    expect(values[0].textContent?.trim()).toContain('4');
    expect(values[0].querySelector('.streak-stat-unit')?.textContent).toBe('days');
    expect(values[0].classList.contains('streak-zero')).toBe(false);
    expect(values[1].textContent?.trim()).toContain('9');
    expect(values[1].querySelector('.streak-stat-unit')?.textContent).toBe('days');
  });

  it('uses singular wording for a 1-day streak', () => {
    const fixture = setup({ streak: { current: 1, longest: 1 } });

    const values: HTMLElement[] = fixture.nativeElement.querySelectorAll('.streak-stat-value');
    expect(values[0].querySelector('.streak-stat-unit')?.textContent).toBe('day');
  });

  it('dims the current streak value when it is zero', () => {
    const fixture = setup({ streak: { current: 0, longest: 9 } });

    const values: HTMLElement[] = fixture.nativeElement.querySelectorAll('.streak-stat-value');
    expect(values[0].classList.contains('streak-zero')).toBe(true);
  });

  it('shows the favorite topic based on the highest XP breakdown entry', () => {
    const fixture = setup({
      summary: {
        total: 200,
        level: { number: 2, title: 'Syntax Sprout', minXp: 100, nextLevelXp: 300 },
        breakdown: [
          { sourceType: 'lesson', total: 50 },
          { sourceType: 'concept-read', total: 150 },
        ],
      },
    });

    expect(fixture.nativeElement.querySelector('.favorite-topic-value')?.textContent?.trim()).toBe('Concepts');
    expect(fixture.nativeElement.querySelector('.favorite-topic-sub')?.textContent).toContain('150 XP earned');
  });

  it('splits concept XP by area instead of calling all of it Java Concepts', () => {
    const spring = COMPLEMENTARY_AREAS.find((a) => a.slug === 'spring-concepts')!.title;
    const kubernetes = COMPLEMENTARY_AREAS.find((a) => a.slug === 'kubernetes-concepts')!.title;
    const fixture = setup({
      summary: {
        total: 150,
        level: { number: 2, title: 'Syntax Sprout', minXp: 100, nextLevelXp: 300 },
        breakdown: [{ sourceType: 'concept-read', total: 150 }],
      },
      areas: [
        { module: 'spring-concepts', xp: 90, lastActivityAt: '2026-10-01T00:00:00.000Z' },
        { module: 'kubernetes-concepts', xp: 30, lastActivityAt: '2026-10-02T00:00:00.000Z' },
      ],
    });

    const rows = Array.from(fixture.nativeElement.querySelectorAll('.breakdown-item') as NodeListOf<HTMLElement>).map((row) => {
      const [label, xp] = Array.from(row.querySelectorAll('span')).map((el) => el.textContent?.trim());
      return `${label} | ${xp}`;
    });
    // rows are ordered by XP; the XP no area claims stays under the generic "Concepts" row
    expect(rows).toEqual([`${spring} | 90 XP`, `${kubernetes} | 30 XP`, 'Concepts | 30 XP']);
    expect(fixture.nativeElement.querySelector('.favorite-topic-value')?.textContent?.trim()).toBe(spring);
    expect(fixture.nativeElement.textContent).not.toContain('Java Concepts');
  });

  it('shows badge and trophy counts with a link to the achievements page', () => {
    const awards = (type: 'badge' | 'trophy', n: number) =>
      Array.from({ length: n }, (_, i) => ({ type, id: `${type}-${i}`, title: 'T', trackTitle: '', iconSlug: 'read', exp: 4, awardedAt: '2026-10-01T00:00:00.000Z', retired: false, passed: false }));
    const fixture = setup({ achievements: { awards: [...awards('badge', 3), ...awards('trophy', 1)], progress: [] } });

    expect(fixture.nativeElement.querySelector('[data-testid="profile-badge-count"]').textContent).toBe('3');
    expect(fixture.nativeElement.querySelector('[data-testid="profile-trophy-count"]').textContent).toBe('1');
    expect(fixture.nativeElement.querySelector('.achievements-link').getAttribute('href')).toBe('/profile/achievements');
  });

  it('names an award in recent activity by its title, not by its raw id', () => {
    const id = '01a144df-4132-7737-aacd-4f9655f10d37';
    const fixture = setup({
      history: [{ id: 1, sourceType: 'badge', sourceId: id, exp: 10, updatedAt: '2026-10-01T00:00:00.000Z' }],
      achievements: {
        awards: [{ type: 'badge', id, title: 'Workloads', trackTitle: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts', exp: 10, awardedAt: '2026-10-01T00:00:00.000Z', retired: false, passed: false }],
        progress: [],
      },
    });

    const item = fixture.nativeElement.querySelector('.history-item') as HTMLElement;
    expect(item.textContent).toContain('Badges');
    expect(item.textContent).toContain('Workloads');
    expect(item.textContent).not.toContain(id);
  });

  it('shows an empty state for favorite topic when there is no XP yet', () => {
    const fixture = setup({
      summary: { total: 0, level: { number: 1, title: 'Hello World', minXp: 0, nextLevelXp: 100 }, breakdown: [] },
    });

    expect(fixture.nativeElement.querySelector('.favorite-topic-empty')?.textContent).toContain('Not enough data yet');
  });

  it('shows the daily goal progress and remaining XP', () => {
    const fixture = setup({ dailyGoal: { earnedToday: 12, goal: 30 } });

    expect(fixture.nativeElement.textContent).toContain('12 / 30 XP today');
    expect(fixture.nativeElement.textContent).toContain('18 XP to go');
    expect(fixture.componentInstance.dailyGoalPercent()).toBe(40);
  });

  it('shows a "goal reached" message once the daily goal is met', () => {
    const fixture = setup({ dailyGoal: { earnedToday: 30, goal: 30 } });

    expect(fixture.nativeElement.textContent).toContain('Goal reached');
  });

  it('does not render the Daily Goal card until data has loaded', () => {
    const fixture = setup({ dailyGoal: null });

    const cardTitles = Array.from(
      fixture.nativeElement.querySelectorAll('.section-title') as NodeListOf<Element>,
    ).map((el) => el.textContent);
    expect(cardTitles).not.toContain('Daily Goal');
  });

  it('does not render a Leaderboard card (moved to its own public /leaderboard page)', () => {
    const fixture = setup();

    const cardTitles = Array.from(
      fixture.nativeElement.querySelectorAll('.section-title') as NodeListOf<Element>,
    ).map((el) => el.textContent);
    expect(cardTitles).not.toContain('Leaderboard');
  });
});
