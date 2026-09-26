import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DailySession } from '../../models/daily.model';
import { AreaXpBreakdownEntry } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { DailySessionService } from '../../services/daily-session.service';
import { XpService } from '../../services/xp.service';
import { MobileHome } from './mobile-home';

const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

const SESSION: DailySession = {
  estimatedMinutes: 4,
  summary: { headline: '', tomorrow: { title: '', body: '' } },
  cards: [
    { type: 'recall', xp: 20, previewTitle: 'Set', previewSubtitle: '', recap: '', kicker: '', title: 'Set', sourceType: 'concept-read', sourceId: 'set' },
    { type: 'write', xp: 20, previewTitle: 'Docker', previewSubtitle: '', recap: '', kicker: '', title: 'Docker', maxLength: 240, sourceId: 'docker' },
  ],
};

const AREAS: AreaXpBreakdownEntry[] = [
  { module: 'java-concepts', xp: 60, lastActivityAt: ago(0) },
  { module: 'computer-science', xp: 10, lastActivityAt: ago(21) },
  { module: 'spring-concepts', xp: 250, lastActivityAt: ago(2) },
];

function setup(options: { expired?: number; mobile?: boolean } = {}) {
  const { expired = 27, mobile = true } = options;
  spyOn(window, 'matchMedia').and.returnValue({ matches: mobile } as MediaQueryList);
  const build = jasmine.createSpy('build').and.returnValue(of(SESSION));

  TestBed.configureTestingModule({
    imports: [MobileHome],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal({ id: 1, displayName: 'Alexandro Castro' }) } },
      { provide: DailySessionService, useValue: { build } },
      {
        provide: XpService,
        useValue: {
          summary: signal({ total: 340, level: { number: 3, title: 'Compiler Whisperer', minXp: 300, nextLevelXp: 600 }, breakdown: [] }),
          streak: signal({ current: 0, longest: 4 }),
          dailyGoal: signal({ earnedToday: 10, goal: 30 }),
          areas: signal(AREAS),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(MobileHome);
  fixture.componentRef.setInput('markCounts', { active: 3, expired });
  fixture.detectChanges();
  return { fixture, build };
}

describe('MobileHome', () => {
  it("greets by first name and previews today's session", () => {
    const { fixture } = setup();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.greeting')!.textContent).toContain('Alexandro');
    expect(el.querySelector('.greeting')!.textContent).not.toContain('Castro');
    expect(el.querySelector('.headline')!.textContent).toContain('Your 4 minutes today');
    expect(el.querySelectorAll('.chip').length).toBe(2);
    expect(el.querySelector('.start')!.textContent).toContain('+40 XP');
    expect(el.querySelector('.start')!.getAttribute('href')).toBe('/daily/session');
  });

  it('does not build a session on wide screens, where it is never shown', () => {
    const { build } = setup({ mobile: false });

    expect(build).not.toHaveBeenCalled();
  });

  it('shows level, streak record and goal', () => {
    const { fixture } = setup();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.ring-num')!.textContent).toContain('3');
    expect(el.querySelector('.stat-level')!.textContent).toContain('340/600');
    expect(el.textContent).toContain('record 4');
    expect((el.querySelector('.goal-fill') as HTMLElement).style.width).toBe('33%');
  });

  it('links the review backlog, offering a small first bite', () => {
    const { fixture } = setup();
    const marks: HTMLElement = fixture.nativeElement.querySelector('.marks');

    expect(marks.getAttribute('href')).toBe('/review');
    expect(marks.querySelector('.marks-num')!.textContent).toContain('27');
    expect(marks.textContent).toContain('Review 5 now');
  });

  it('hides the review row when nothing is due', () => {
    const { fixture } = setup({ expired: 0 });

    expect(fixture.nativeElement.querySelector('.marks')).toBeNull();
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
