import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { AchievementsView, AwardView } from '../../models/achievements.model';
import { User } from '../../models/auth.model';
import { AreaXpBreakdownEntry, DailyGoalStatus, StreakInfo, XpSummary } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { COMPLEMENTARY_AREAS } from '../computer-science/complementary-studies.data';
import { ProfilePage } from './profile-page';

const ID = '01a144df-4132-7737-aacd-4f9655f10d37';
const USER: User = {
  id: 1, displayName: 'Ana', githubLogin: 'ana-gh', avatarUrl: 'https://example.com/ana.png',
  preferredLanguage: null, profilePublic: true, publicProfileId: ID,
};
const SUMMARY: XpSummary = {
  total: 150,
  level: { number: 2, title: 'Syntax Sprout', minXp: 100, nextLevelXp: 300 },
  breakdown: [{ sourceType: 'lesson', total: 150 }],
};
const award = (type: 'badge' | 'trophy', title: string): AwardView => ({
  type, id: `${type}-${title}`, title, trackTitle: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts',
  exp: 10, awardedAt: '2026-10-01T00:00:00.000Z', retired: false, passed: false,
});

interface Options {
  user?: User | null;
  summary?: XpSummary | null;
  streak?: StreakInfo | null;
  dailyGoal?: DailyGoalStatus | null;
  areas?: AreaXpBreakdownEntry[];
  achievements?: AchievementsView | null;
  updateDisplayName?: (name: string | null) => Observable<User>;
  updateProfilePublic?: (value: boolean) => Observable<User>;
}

function setup(options: Options = {}) {
  const { user = USER, summary = SUMMARY, streak = null, dailyGoal = null, areas = [], achievements = null } = options;
  const updateDisplayName = jasmine.createSpy('updateDisplayName').and.callFake(options.updateDisplayName ?? (() => of(USER)));
  const updateProfilePublic = jasmine.createSpy('updateProfilePublic').and.callFake(options.updateProfilePublic ?? ((v: boolean) => of({ ...USER, profilePublic: v })));
  const xp = {
    summary: signal(summary), streak: signal(streak), dailyGoal: signal(dailyGoal), areas: signal(areas), achievements: signal(achievements),
    loadSummary: jasmine.createSpy('loadSummary'), loadStreak: jasmine.createSpy('loadStreak'),
    loadDailyGoal: jasmine.createSpy('loadDailyGoal'), loadAreas: jasmine.createSpy('loadAreas'),
    syncAchievements: jasmine.createSpy('syncAchievements').and.resolveTo(),
  };
  TestBed.configureTestingModule({
    imports: [ProfilePage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal(user), updateDisplayName, updateProfilePublic } },
      { provide: XpService, useValue: xp },
    ],
  });
  const fixture = TestBed.createComponent(ProfilePage);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
  const click = (sel: string) => { q<HTMLButtonElement>(sel)!.click(); fixture.detectChanges(); };
  return { fixture, el, q, click, xp, updateDisplayName, updateProfilePublic };
}

describe('ProfilePage', () => {
  describe('without a session', () => {
    it('asks to log in and loads nothing', () => {
      const { el, xp } = setup({ user: null });
      expect(el.textContent).toContain('Log in with GitHub');
      expect(el.querySelector('app-profile-header')).toBeNull();
      expect(xp.loadSummary).not.toHaveBeenCalled();
      expect(xp.syncAchievements).not.toHaveBeenCalled();
    });
  });

  describe('as the owner', () => {
    it('loads what it shows, and syncs achievements silently', () => {
      const { xp } = setup();
      expect(xp.loadSummary).toHaveBeenCalled();
      expect(xp.loadStreak).toHaveBeenCalled();
      expect(xp.loadDailyGoal).toHaveBeenCalled();
      expect(xp.loadAreas).toHaveBeenCalled();
      expect(xp.syncAchievements).toHaveBeenCalledOnceWith(false);
    });

    it('shows the same header a visitor sees: name, handle, level, XP and counters', () => {
      const { el, q } = setup({ achievements: { awards: [award('badge', 'Workloads'), award('badge', 'Networking'), award('trophy', 'Kubernetes')], progress: [] } });
      expect(q('.display-name')!.textContent).toBe('Ana');
      expect(q('.github-login')!.textContent).toContain('ana-gh');
      expect(q('.level')!.textContent).toContain('Level 2');
      expect(q('.level')!.textContent).toContain('Syntax Sprout');
      expect(q('.xp')!.textContent).toContain('150 XP');
      expect(q('[data-testid="badge-count"]')!.textContent).toBe('2');
      expect(q('[data-testid="trophy-count"]')!.textContent).toBe('1');
      expect(el.querySelector('.avatar')!.getAttribute('src')).toBe('https://example.com/ana.png');
    });

    it('shows trophies and badges as cards, trophies first', () => {
      const { el } = setup({ achievements: { awards: [award('badge', 'Workloads'), award('trophy', 'Kubernetes')], progress: [] } });
      expect(Array.from(el.querySelectorAll('.award-title')).map((n) => n.textContent)).toEqual(['Kubernetes', 'Workloads']);
    });

    it('explains how to earn the first one when there are no awards yet', () => {
      const { el } = setup({ achievements: { awards: [], progress: [] } });
      expect(el.querySelector('.empty-state')!.textContent).toContain('Finish every concept in a session to earn a badge');
      expect(el.querySelector('app-awards-sections')).toBeNull();
    });

    it('shows level progress and the XP still missing for the next level', () => {
      const { q, fixture } = setup();
      expect(q('.level-card')).not.toBeNull();
      expect(q('.level-card .progress-label')!.textContent).toContain('150 XP to next level');
      expect(fixture.componentInstance.progressPercent()).toBe(25);
    });

    it('keeps the XP breakdown and the activity list off this page, and links to them', () => {
      const { el, q } = setup();
      expect(el.querySelector('.breakdown-item')).toBeNull();
      expect(el.querySelector('.history-item')).toBeNull();
      expect(q('[data-testid="link-activity"]')!.getAttribute('href')).toBe('/profile/activity');
      expect(q('[data-testid="link-progress"]')!.getAttribute('href')).toBe('/profile/achievements');
    });
  });

  describe('streak, favorite topic and daily goal', () => {
    it('hides the Streak card until streak data has loaded', () => {
      expect(setup({ streak: null }).q('.streak-card')).toBeNull();
    });

    it('shows the current and longest streak side by side', () => {
      const { el } = setup({ streak: { current: 4, longest: 9 } });
      const values = el.querySelectorAll('.streak-stat-value');
      expect(values[0].textContent).toContain('4');
      expect(values[1].textContent).toContain('9');
      expect(values[0].classList.contains('streak-zero')).toBe(false);
    });

    it('uses singular wording for a 1-day streak', () => {
      expect(setup({ streak: { current: 1, longest: 1 } }).el.querySelector('.streak-stat-unit')!.textContent).toBe('day');
    });

    it('dims a zero current streak', () => {
      expect(setup({ streak: { current: 0, longest: 9 } }).el.querySelector('.streak-stat-value')!.classList.contains('streak-zero')).toBe(true);
    });

    it('names the favorite topic from the XP breakdown', () => {
      const { q } = setup({ summary: { ...SUMMARY, breakdown: [{ sourceType: 'lesson', total: 50 }, { sourceType: 'concept-read', total: 150 }] } });
      expect(q('.favorite-topic-value')!.textContent!.trim()).toBe('Concepts');
      expect(q('.favorite-topic-sub')!.textContent).toContain('150 XP earned');
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
      expect(fixture.componentInstance.dailyGoalPercent()).toBe(40);
    });

    it('says so when the daily goal is met', () => {
      expect(setup({ dailyGoal: { earnedToday: 30, goal: 30 } }).el.textContent).toContain('Goal reached');
    });

    it('does not draw the Daily Goal card until data has loaded', () => {
      const titles = Array.from(setup({ dailyGoal: null }).el.querySelectorAll('.section-title')).map((e) => e.textContent);
      expect(titles).not.toContain('Daily Goal');
    });
  });

  describe('renaming', () => {
    it('opens an editor pre-filled with the current name', () => {
      const { q, click } = setup();
      click('[data-testid="edit-name"]');
      expect(q<HTMLInputElement>('.name-input')!.value).toBe('Ana');
      expect(q('[data-testid="edit-name"]')).toBeNull();
    });

    it('saves what was typed, closes the editor and says it was saved', () => {
      const { q, click, updateDisplayName, fixture } = setup();
      click('[data-testid="edit-name"]');
      const input = q<HTMLInputElement>('.name-input')!;
      input.value = 'Ada Lovelace';
      input.dispatchEvent(new Event('input'));
      click('[data-testid="save-name"]');
      expect(updateDisplayName).toHaveBeenCalledOnceWith('Ada Lovelace');
      expect(q('.name-input')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Saved.');
    });

    it('cancels without sending anything', () => {
      const { q, click, updateDisplayName, fixture } = setup();
      click('[data-testid="edit-name"]');
      const cancel = Array.from(q('.edit-form')!.querySelectorAll('button')).find((b) => b.textContent!.includes('Cancel'))!;
      cancel.click();
      fixture.detectChanges();
      expect(updateDisplayName).not.toHaveBeenCalled();
      expect(q('.name-input')).toBeNull();
    });

    it('goes back to the GitHub name by sending null', () => {
      const { q, click, updateDisplayName } = setup();
      click('[data-testid="edit-name"]');
      const reset = Array.from(q('.edit-form')!.querySelectorAll('button')).find((b) => b.textContent!.includes('Reset to GitHub name'))!;
      reset.click();
      expect(updateDisplayName).toHaveBeenCalledOnceWith(null);
    });

    it('keeps the editor open and shows an error when saving fails', () => {
      const { q, click, fixture } = setup({ updateDisplayName: () => throwError(() => new Error('boom')) });
      click('[data-testid="edit-name"]');
      click('[data-testid="save-name"]');
      expect(q('.name-input')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.feedback.error')!.textContent).toContain('Something went wrong');
      expect(q<HTMLButtonElement>('[data-testid="save-name"]')!.disabled).toBe(false);
    });
  });

  describe('who can see the profile', () => {
    it('is public by default, even for a user cached before the setting existed', () => {
      const { q } = setup({ user: { ...USER, profilePublic: undefined, publicProfileId: undefined } });
      expect(q('[data-testid="profile-public"]')!.getAttribute('aria-pressed')).toBe('true');
    });

    it('offers to view as a visitor and to copy the link, built from the id', () => {
      const { q } = setup();
      expect(q('[data-testid="view-as-visitor"]')!.getAttribute('href')).toBe(`/u/${ID}`);
      expect(q('[data-testid="copy-link"]')).not.toBeNull();
    });

    it('copies the absolute link', async () => {
      const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      const { fixture } = setup();
      await fixture.componentInstance.copyLink();
      expect(write).toHaveBeenCalledOnceWith(jasmine.stringMatching(new RegExp(`/u/${ID}$`)));
    });

    it('goes private on click, and the visitor link goes away once the user says so', () => {
      const { q, click, updateProfilePublic, fixture } = setup({ user: { ...USER, profilePublic: false } });
      expect(q('[data-testid="view-as-visitor"]')).toBeNull();
      expect(q('[data-testid="profile-private"]')!.getAttribute('aria-pressed')).toBe('true');
      click('[data-testid="profile-public"]');
      expect(updateProfilePublic).toHaveBeenCalledOnceWith(true);
      expect(fixture.nativeElement.textContent).toContain('Saved.');
    });

    it('sends nothing when the chosen option is already active', () => {
      const { click, updateProfilePublic } = setup();
      click('[data-testid="profile-public"]');
      expect(updateProfilePublic).not.toHaveBeenCalled();
    });

    it('shows an error when changing it fails', () => {
      const { click, fixture } = setup({ updateProfilePublic: () => throwError(() => new Error('boom')) });
      click('[data-testid="profile-private"]');
      expect(fixture.nativeElement.querySelector('.feedback.error')!.textContent).toContain('Something went wrong');
    });
  });
});
