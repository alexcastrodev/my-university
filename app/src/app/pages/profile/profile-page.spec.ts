import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { User } from '../../models/auth.model';
import {
  DailyGoalStatus,
  LeaderboardEntry,
  StreakInfo,
  XpHistoryEntry,
  XpSummary,
} from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { ProfilePage } from './profile-page';

const USER: User = { id: 1, displayName: 'Ana', githubLogin: 'ana', avatarUrl: 'https://example.com/ana.png' };

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
  leaderboard?: LeaderboardEntry[];
} = {}) {
  const {
    loggedIn = true,
    summary = SUMMARY,
    history = [],
    streak = null,
    dailyGoal = null,
    leaderboard = [],
  } = options;

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
          leaderboard: signal(leaderboard),
          loadSummary: () => {},
          loadHistory: () => {},
          loadStreak: () => {},
          loadDailyGoal: () => {},
          loadLeaderboard: () => {},
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

  it('hides the streak badge when no streak data has loaded yet', () => {
    const fixture = setup({ streak: null });

    expect(fixture.nativeElement.querySelector('.streak-badge')).toBeNull();
  });

  it('shows the current streak count once loaded', () => {
    const fixture = setup({ streak: { current: 4, longest: 9 } });

    const badge = fixture.nativeElement.querySelector('.streak-badge');
    expect(badge?.textContent).toContain('4 days streak');
    expect(badge?.getAttribute('title')).toBe('Longest streak: 9 days');
  });

  it('uses singular wording for a 1-day streak', () => {
    const fixture = setup({ streak: { current: 1, longest: 1 } });

    expect(fixture.nativeElement.querySelector('.streak-badge')?.textContent).toContain('1 day streak');
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

  it('shows an empty state when the leaderboard has no entries', () => {
    const fixture = setup({ leaderboard: [] });

    expect(fixture.nativeElement.textContent).toContain("No one's earned XP yet");
  });

  it('renders leaderboard rows ranked in the order given, highlighting the current user', () => {
    const leaderboard: LeaderboardEntry[] = [
      { userId: 2, displayName: 'Bea', avatarUrl: 'https://example.com/bea.png', total: 500, levelNumber: 3 },
      { userId: 1, displayName: 'Ana', avatarUrl: 'https://example.com/ana.png', total: 150, levelNumber: 2 },
    ];
    const fixture = setup({ leaderboard });

    const rows: HTMLElement[] = fixture.nativeElement.querySelectorAll('.leaderboard-item');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.leaderboard-rank')?.textContent).toContain('#1');
    expect(rows[0].querySelector('.leaderboard-name')?.textContent).toContain('Bea');
    expect(rows[1].querySelector('.leaderboard-name')?.textContent).toContain('Ana');
    expect(rows[1].classList.contains('leaderboard-item-self')).toBe(true);
    expect(rows[0].classList.contains('leaderboard-item-self')).toBe(false);
  });
});
