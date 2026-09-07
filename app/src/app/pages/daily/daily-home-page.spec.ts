import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { DailySession } from '../../models/daily.model';
import { XpSummary, StreakInfo } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { DailySessionService } from '../../services/daily-session.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { DailyHomePage } from './daily-home-page';

const SESSION: DailySession = {
  estimatedMinutes: 5,
  summary: { headline: 'Done', tomorrow: { title: 'T', body: 'B' } },
  cards: [
    {
      type: 'recall',
      xp: 20,
      previewTitle: 'Reference reachability',
      previewSubtitle: 'Marked in March',
      recap: 'Recall',
      kicker: 'RECALL',
      title: 'Q?',
      sourceType: 'concept-read',
      sourceId: 'reference-reachability',
    },
    {
      type: 'write',
      xp: 20,
      previewTitle: 'One line',
      previewSubtitle: 'Kept next to March',
      recap: 'Write',
      kicker: 'WRITE',
      title: 'In your own words?',
      maxLength: 240,
      sourceId: 'reference-reachability',
    },
  ],
};

const EMPTY_SESSION: DailySession = {
  estimatedMinutes: 1,
  summary: { headline: 'Nothing to review yet', tomorrow: { title: 'Read one concept first', body: 'B' } },
  cards: [],
};

const SUMMARY: XpSummary = {
  total: 280,
  level: { number: 2, title: 'Syntax Sprout', minXp: 100, nextLevelXp: 300 },
  breakdown: [],
};

const STREAK: StreakInfo = { current: 3, longest: 9 };

function setup(options: { loggedIn?: boolean; session?: DailySession } = {}) {
  const { loggedIn = true, session = SESSION } = options;

  TestBed.configureTestingModule({
    imports: [DailyHomePage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal(loggedIn ? { id: 1, displayName: 'Ana' } : null) } },
      { provide: DailySessionService, useValue: { build: () => of(session) } },
      { provide: SeoService, useValue: { set: () => {} } },
      {
        provide: XpService,
        useValue: {
          summary: signal<XpSummary | null>(loggedIn ? SUMMARY : null),
          streak: signal<StreakInfo | null>(loggedIn ? STREAK : null),
          loadSummary: () => {},
          loadStreak: () => {},
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DailyHomePage);
  fixture.detectChanges();
  return fixture;
}

describe('DailyHomePage', () => {
  it('renders a preview row per session card', () => {
    const fixture = setup();

    const rows = fixture.nativeElement.querySelectorAll('.preview-card');
    expect(rows.length).toBe(SESSION.cards.length);
    expect(fixture.nativeElement.textContent).toContain('Reference reachability');
  });

  it('sums the potential XP across the cards', () => {
    const fixture = setup();

    expect(fixture.nativeElement.querySelector('.hero-xp').textContent).toContain('+40');
  });

  it('shows the card count and estimate in the hero', () => {
    const fixture = setup();

    const title = fixture.nativeElement.querySelector('.hero-title').textContent;
    expect(title).toContain('2 cards');
    expect(title).toContain('5 minutes');
  });

  it('shows the level badge and streak when logged in', () => {
    const fixture = setup({ loggedIn: true });

    expect(fixture.nativeElement.querySelector('.hero-badge').textContent).toContain('LV 2');
    expect(fixture.nativeElement.textContent).toContain('day 3');
  });

  it('hides the badge and streak when logged out', () => {
    const fixture = setup({ loggedIn: false });

    expect(fixture.nativeElement.querySelector('.hero-badge')).toBeNull();
  });

  it('starts the session on the start button', () => {
    const fixture = setup();
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate');

    fixture.nativeElement.querySelector('.start-btn').click();

    expect(navigate).toHaveBeenCalledWith(['/daily/session']);
  });

  it('links to the sources explainer', () => {
    const fixture = setup();

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.sources-link');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/daily/sources');
  });

  it('shows an honest empty state instead of a fake 4-card promise', () => {
    const fixture = setup({ session: EMPTY_SESSION });

    expect(fixture.nativeElement.textContent).toContain('Nothing to review yet');
    expect(fixture.nativeElement.querySelector('.preview-card')).toBeNull();
    expect(fixture.nativeElement.querySelector('.start-btn').getAttribute('href')).toBe('/computer-science');
  });
});
