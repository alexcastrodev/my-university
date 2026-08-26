import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { User } from '../../models/auth.model';
import { LeaderboardEntry } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { LeaderboardPage } from './leaderboard-page';

const USER: User = {
  id: 1,
  displayName: 'Ana',
  githubLogin: 'ana',
  avatarUrl: 'https://example.com/ana.png',
  preferredLanguage: null,
};

function makeEntry(userId: number, displayName: string, total: number): LeaderboardEntry {
  return { userId, displayName, avatarUrl: 'https://example.com/a.png', total, levelNumber: 1 };
}

function setup(loggedIn: boolean, leaderboard: LeaderboardEntry[] = []) {
  TestBed.configureTestingModule({
    imports: [LeaderboardPage],
    providers: [
      provideZonelessChangeDetection(),
      { provide: AuthService, useValue: { currentUser: signal(loggedIn ? USER : null) } },
      { provide: XpService, useValue: { leaderboard: signal(leaderboard), loadLeaderboard: () => {} } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LeaderboardPage);
  fixture.detectChanges();
  return fixture;
}

describe('LeaderboardPage', () => {
  it('is visible to logged-out visitors (public page)', () => {
    const fixture = setup(false, [makeEntry(2, 'Bruno', 40)]);
    expect(fixture.nativeElement.textContent).toContain('Bruno');
  });

  it('shows the empty state when no one has earned XP yet', () => {
    const fixture = setup(true, []);
    expect(fixture.nativeElement.textContent).toContain("No one's earned XP yet");
  });

  it('highlights the current user\'s own row when logged in', () => {
    const fixture = setup(true, [makeEntry(1, 'Ana', 100), makeEntry(2, 'Bruno', 40)]);
    const selfRow = fixture.nativeElement.querySelector('.leaderboard-item-self');
    expect(selfRow?.textContent).toContain('Ana');
  });

  it('does not highlight any row when logged out', () => {
    const fixture = setup(false, [makeEntry(2, 'Bruno', 40)]);
    expect(fixture.nativeElement.querySelector('.leaderboard-item-self')).toBeNull();
  });
});
