import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { User } from '../../models/auth.model';
import { DailyGoalStatus, StreakInfo, XpHistoryEntry, XpSummary } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
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
} = {}) {
  const { loggedIn = true, summary = SUMMARY, history = [], streak = null, dailyGoal = null } = options;

  TestBed.configureTestingModule({
    imports: [ProfilePage],
    providers: [
      provideZonelessChangeDetection(),
      { provide: AuthService, useValue: { currentUser: signal(loggedIn ? USER : null) } },
      {
        provide: XpService,
        useValue: {
          summary: signal(summary),
          history: signal(history),
          streak: signal(streak),
          dailyGoal: signal(dailyGoal),
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

    expect(fixture.nativeElement.querySelector('.favorite-topic-value')?.textContent).toContain('Java Concepts');
    expect(fixture.nativeElement.querySelector('.favorite-topic-sub')?.textContent).toContain('150 XP earned');
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
