import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

const profileId = (userId: number) => `01a14000-0000-7000-8000-00000000000${userId}`;

function makeEntry(userId: number, displayName: string, total: number): LeaderboardEntry {
  return { userId, publicProfileId: profileId(userId), displayName, avatarUrl: 'https://example.com/a.png', total, levelNumber: 1 };
}

function setup(loggedIn: boolean, leaderboard: LeaderboardEntry[] = []) {
  TestBed.configureTestingModule({
    imports: [LeaderboardPage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
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

  describe('opening a profile', () => {
    it('links every row to that user\'s public profile, by profile id', () => {
      const fixture = setup(false, [makeEntry(1, 'Ana', 100), makeEntry(2, 'Bruno', 40)]);
      const links = Array.from(fixture.nativeElement.querySelectorAll('.leaderboard-link') as NodeListOf<HTMLAnchorElement>);
      expect(links.map((a) => a.getAttribute('href'))).toEqual([`/u/${profileId(1)}`, `/u/${profileId(2)}`]);
    });

    it('puts the avatar and the name inside the link, so either one opens the profile', () => {
      const fixture = setup(false, [makeEntry(2, 'Bruno', 40)]);
      const link = fixture.nativeElement.querySelector('.leaderboard-link') as HTMLElement;
      expect(link.querySelector('img.avatar-sm')).not.toBeNull();
      expect(link.querySelector('.leaderboard-name')!.textContent).toBe('Bruno');
    });

    it('never uses the internal user id in a link', () => {
      const fixture = setup(true, [makeEntry(1, 'Ana', 100)]);
      const href = (fixture.nativeElement.querySelector('.leaderboard-link') as HTMLAnchorElement).getAttribute('href')!;
      expect(href).not.toMatch(/\/u\/1$/);
    });
  });
});
