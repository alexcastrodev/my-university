import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AreaXpBreakdownEntry } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { MobileHome } from './mobile-home';

const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

const AREAS: AreaXpBreakdownEntry[] = [
  { module: 'java-concepts', xp: 60, lastActivityAt: ago(0) },
  { module: 'computer-science', xp: 10, lastActivityAt: ago(21) },
  { module: 'spring-concepts', xp: 250, lastActivityAt: ago(2) },
];

function setup(options: { loading?: boolean } = {}) {
  const { loading = false } = options;

  TestBed.configureTestingModule({
    imports: [MobileHome],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal({ id: 1, displayName: 'Alexandro Castro' }) } },
      {
        provide: XpService,
        useValue: {
          summary: signal(loading ? null : { total: 340, level: { number: 3, title: 'Compiler Whisperer', minXp: 300, nextLevelXp: 600 }, breakdown: [] }),
          streak: signal(loading ? null : { current: 0, longest: 4 }),
          dailyGoal: signal(loading ? null : { earnedToday: 10, goal: 30 }),
          areas: signal(loading ? [] : AREAS),
          areasLoaded: signal(!loading),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(MobileHome);
  fixture.detectChanges();
  return { fixture };
}

describe('MobileHome', () => {
  it('greets by first name', () => {
    const { fixture } = setup();
    const headline = (fixture.nativeElement as HTMLElement).querySelector('.headline')!;

    expect(headline.textContent).toContain('Alexandro');
    expect(headline.textContent).not.toContain('Castro');
  });

  it('shows placeholders, not zeros or an empty box, while everything is still loading', () => {
    const { fixture } = setup({ loading: true });
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.headline')!.textContent).toContain('Alexandro');
    expect(el.querySelector('.ring')).toBeNull();
    expect(el.querySelectorAll('.stats .mu-skeleton').length).toBeGreaterThan(0);
    expect(el.textContent).not.toContain('record 0');
    expect(el.querySelectorAll('.areas .mu-skeleton').length).toBeGreaterThan(0);
    expect(el.querySelector('.areas-empty')).toBeNull();
  });

  it('shows level, streak record and goal', () => {
    const { fixture } = setup();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.ring-num')!.textContent).toContain('3');
    expect(el.querySelector('.stat-level')!.textContent).toContain('340/600');
    expect(el.textContent).toContain('record 4');
    expect((el.querySelector('.goal-fill') as HTMLElement).style.width).toBe('33%');
  });

  it('links the tracks page', () => {
    const { fixture } = setup();
    const shortcut: HTMLElement = fixture.nativeElement.querySelector('.shortcut');
    expect(shortcut.getAttribute('href')).toBe('/tracks');
    expect(shortcut.textContent).toContain('Tracks');
  });

  it('lists areas by recency, with depth from how much was read there', () => {
    const { fixture } = setup();
    const rows = fixture.nativeElement.querySelectorAll('.area');

    const titles = Array.from(rows as NodeListOf<HTMLElement>).map((r) => r.querySelector('.area-title')!.textContent);
    expect(titles).toEqual(['Java Concepts', 'Spring', 'Computer Science']);
    // 6 reads light 3 segments, 25 light all 5, a single read lights 1.
    expect(rows[0].querySelectorAll('.seg.lit').length).toBe(3);
    expect(rows[1].querySelectorAll('.seg.lit').length).toBe(5);
    expect(rows[2].querySelectorAll('.seg.lit').length).toBe(1);
    expect(rows[0].querySelector('.recency').textContent).toContain('today');
    expect(rows[2].classList).toContain('stale');
    expect(rows[2].getAttribute('href')).toBe('/computer-science');
  });
});
