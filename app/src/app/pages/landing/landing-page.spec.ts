import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LeaderboardEntry } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { LandingPage } from './landing-page';

function setup(loggedIn: boolean, leaderboard: LeaderboardEntry[] = []) {
  TestBed.configureTestingModule({
    imports: [LandingPage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{ path: 'dashboard', component: LandingPage }]),
      { provide: AuthService, useValue: { currentUser: signal(loggedIn ? { id: 1, displayName: 'Ana' } : null) } },
      {
        provide: XpService,
        useValue: { leaderboard: signal(leaderboard), loadLeaderboard: () => {} },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LandingPage);
  fixture.detectChanges();
  return fixture;
}

describe('LandingPage', () => {
  it('redirects a logged-in visitor straight to /dashboard instead of rendering', async () => {
    const fixture = setup(true);
    await fixture.whenStable();
    const router = TestBed.inject(Router);

    expect(router.url).toBe('/dashboard');
  });

  it('renders the Complementary Studies topic cards for a logged-out visitor', () => {
    const fixture = setup(false);

    expect(fixture.nativeElement.textContent).toContain('Java Concepts');
    expect(fixture.nativeElement.textContent).toContain('Spring');

    const cards: HTMLAnchorElement[] = fixture.nativeElement.querySelectorAll('.topic-card');
    expect(cards.length).toBeGreaterThan(0);

    const javaCard = Array.from(cards).find((c) => c.textContent?.includes('Java Concepts'));
    expect(javaCard?.getAttribute('href')).toBe('/java/java-concepts');
  });

  it('links to the Computer Science roadmap', () => {
    const fixture = setup(false);

    const banner: HTMLAnchorElement = fixture.nativeElement.querySelector('.cs-banner');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('href')).toBe('/computer-science');
  });

  it('hides the "Learners on the platform" section when the leaderboard is empty', () => {
    const fixture = setup(false, []);

    expect(fixture.nativeElement.querySelector('.community-grid')).toBeNull();
  });

  it('shows up to 4 real leaderboard entries once loaded, never fabricated ones', () => {
    const entries: LeaderboardEntry[] = Array.from({ length: 6 }, (_, i) => ({
      userId: i + 1,
      displayName: `Learner ${i + 1}`,
      avatarUrl: `https://example.com/${i + 1}.png`,
      total: 100 - i,
      levelNumber: 2,
    }));
    const fixture = setup(false, entries);

    const cards = fixture.nativeElement.querySelectorAll('.community-card');
    expect(cards.length).toBe(4);
    expect(fixture.nativeElement.textContent).toContain('Learner 1');
    expect(fixture.nativeElement.textContent).not.toContain('Learner 5');
  });
});
