import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { AchievementsView, AwardView } from '../../models/achievements.model';
import { User } from '../../models/auth.model';
import { StreakInfo, XpSummary } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { ProfileLayout } from './profile-layout';

const ID = '01a144df-4132-7737-aacd-4f9655f10d37';
const USER: User = {
  id: 1, displayName: 'Ana', githubLogin: 'ana-gh', avatarUrl: 'https://example.com/ana.png',
  preferredLanguage: null, profilePublic: true, publicProfileId: ID,
};
const SUMMARY: XpSummary = {
  total: 150, level: { number: 2, title: 'Syntax Sprout', minXp: 100, nextLevelXp: 300 }, breakdown: [],
};
const award = (type: 'badge' | 'trophy', title: string): AwardView => ({
  type, id: `${type}-${title}`, title, trackTitle: 'K', iconSlug: 'read', exp: 10,
  awardedAt: '2026-10-01T00:00:00.000Z', retired: false, passed: false,
});

interface Options {
  user?: User | null;
  summary?: XpSummary | null;
  streak?: StreakInfo | null;
  achievements?: AchievementsView | null;
  updateDisplayName?: (name: string | null) => Observable<User>;
  updateProfilePublic?: (value: boolean) => Observable<User>;
  updateProfileSlug?: (slug: string | null) => Observable<User>;
}

function setup(o: Options = {}) {
  const { user = USER, summary = SUMMARY, streak = null, achievements = null } = o;
  const updateDisplayName = jasmine.createSpy('updateDisplayName').and.callFake(o.updateDisplayName ?? (() => of({ ...USER, displayName: 'Ada Lovelace' })));
  const updateProfilePublic = jasmine.createSpy('updateProfilePublic').and.callFake(o.updateProfilePublic ?? ((v: boolean) => of({ ...USER, profilePublic: v })));
  const xp = {
    summary: signal(summary), streak: signal(streak), achievements: signal(achievements),
    loadSummary: jasmine.createSpy('loadSummary'), loadStreak: jasmine.createSpy('loadStreak'),
    loadDailyGoal: jasmine.createSpy('loadDailyGoal'), loadAreas: jasmine.createSpy('loadAreas'),
    syncAchievements: jasmine.createSpy('syncAchievements').and.resolveTo(),
  };
  const currentUser = signal(user);
  // Like the real service: a saved slug lands in the cached user, so the link and the field follow it.
  const updateProfileSlug = jasmine.createSpy('updateProfileSlug').and.callFake(o.updateProfileSlug ?? ((slug: string | null) => {
    const next = { ...USER, profileSlug: slug };
    currentUser.set(next);
    return of(next);
  }));
  TestBed.configureTestingModule({
    imports: [ProfileLayout],
    providers: [
      provideZonelessChangeDetection(), provideRouter([]),
      { provide: AuthService, useValue: { currentUser, updateDisplayName, updateProfilePublic, updateProfileSlug } },
      { provide: XpService, useValue: xp },
    ],
  });
  const fixture = TestBed.createComponent(ProfileLayout);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
  const click = (sel: string) => { q<HTMLButtonElement>(sel)!.click(); fixture.detectChanges(); };
  const type = (sel: string, value: string) => {
    const input = q<HTMLInputElement>(sel)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  return { fixture, el, q, click, type, xp, updateDisplayName, updateProfilePublic, updateProfileSlug };
}

describe('ProfileLayout', () => {
  describe('without a session', () => {
    it('asks to log in and loads nothing', () => {
      const { el, xp } = setup({ user: null });
      expect(el.textContent).toContain('Log in with GitHub');
      expect(el.querySelector('app-profile-banner')).toBeNull();
      expect(xp.loadSummary).not.toHaveBeenCalled();
      expect(xp.syncAchievements).not.toHaveBeenCalled();
    });
  });

  describe('the banner', () => {
    it('loads what the tabs show, and syncs achievements silently', () => {
      const { xp } = setup();
      expect(xp.loadSummary).toHaveBeenCalled();
      expect(xp.loadStreak).toHaveBeenCalled();
      expect(xp.loadDailyGoal).toHaveBeenCalled();
      expect(xp.loadAreas).toHaveBeenCalled();
      expect(xp.syncAchievements).toHaveBeenCalledOnceWith(false);
    });

    it('shows the name, the GitHub handle, the level, and the numbers', () => {
      const { q, el } = setup({
        streak: { current: 4, longest: 9 },
        achievements: { awards: [award('badge', 'A'), award('badge', 'B'), award('trophy', 'T')], progress: [] },
      });
      expect(q('.display-name')!.textContent).toBe('Ana');
      expect(q('.handle')!.textContent).toContain('ana-gh');
      expect(q('.level-line')!.textContent).toContain('Level 2');
      expect(q('.level-line')!.textContent).toContain('Syntax Sprout');
      expect(q('[data-testid="badge-count"]')!.textContent).toBe('2');
      expect(q('[data-testid="trophy-count"]')!.textContent).toBe('1');
      expect(q('[data-testid="xp-total"]')!.textContent).toBe('150');
      expect(q('[data-testid="streak-days"]')!.textContent).toBe('4');
      expect(el.querySelector('.avatar')!.getAttribute('src')).toBe('https://example.com/ana.png');
    });

    it('shows how far the next level is', () => {
      const { q } = setup();
      expect(q('.level-note')!.textContent).toContain('150 XP to next level');
      expect(q('.level-fill')!.getAttribute('style')).toContain('25%');
    });

    it('says so at the top level', () => {
      const { q } = setup({ summary: { ...SUMMARY, level: { ...SUMMARY.level, nextLevelXp: null } } });
      expect(q('.level-note')!.textContent).toContain('Max level reached');
    });

    it('leaves out the streak and the XP until they are known', () => {
      const { q } = setup({ summary: null, streak: null });
      expect(q('[data-testid="streak-days"]')).toBeNull();
      expect(q('[data-testid="xp-total"]')).toBeNull();
    });

    it('marks a public profile with a Public chip', () => {
      expect(setup().q('[data-testid="visibility-chip"]')!.textContent!.trim()).toBe('Public');
    });

    it('marks a private profile with a Private chip', () => {
      expect(setup({ user: { ...USER, profilePublic: false } }).q('[data-testid="visibility-chip"]')!.textContent!.trim()).toBe('Private');
    });
  });

  describe('tabs', () => {
    it('offers Overview, Achievements and Activity', () => {
      const { q } = setup();
      expect(q('[data-testid="tab-overview"]')!.getAttribute('href')).toBe('/profile');
      expect(q('[data-testid="tab-achievements"]')!.getAttribute('href')).toBe('/profile/achievements');
      expect(q('[data-testid="tab-activity"]')!.getAttribute('href')).toBe('/profile/activity');
    });
  });

  describe('Edit profile', () => {
    it('is one button, and the panel is closed until it is used', () => {
      const { q } = setup();
      expect(q('[data-testid="edit-profile"]')).not.toBeNull();
      expect(q('#edit-panel')).toBeNull();
      expect(q('[data-testid="edit-profile"]')!.getAttribute('aria-expanded')).toBe('false');
    });

    it('opens a panel pre-filled with the current name, and closes again', () => {
      const { q, click } = setup();
      click('[data-testid="edit-profile"]');
      expect(q('#edit-panel')).not.toBeNull();
      expect(q<HTMLInputElement>('#display-name')!.value).toBe('Ana');
      expect(q('[data-testid="edit-profile"]')!.getAttribute('aria-expanded')).toBe('true');
      click('[data-testid="close-edit"]');
      expect(q('#edit-panel')).toBeNull();
    });

    it('saves what was typed, keeps the panel open and says it was saved', () => {
      const { q, click, updateDisplayName, fixture } = setup();
      click('[data-testid="edit-profile"]');
      const input = q<HTMLInputElement>('#display-name')!;
      input.value = 'Ada Lovelace';
      input.dispatchEvent(new Event('input'));
      click('[data-testid="save-name"]');
      expect(updateDisplayName).toHaveBeenCalledOnceWith('Ada Lovelace');
      expect(q('#edit-panel')).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Saved.');
    });

    it('goes back to the GitHub name by sending null', () => {
      const { click, updateDisplayName } = setup();
      click('[data-testid="edit-profile"]');
      click('[data-testid="reset-name"]');
      expect(updateDisplayName).toHaveBeenCalledOnceWith(null);
    });

    it('shows an error and keeps the controls usable when saving fails', () => {
      const { q, click, fixture } = setup({ updateDisplayName: () => throwError(() => new Error('boom')) });
      click('[data-testid="edit-profile"]');
      click('[data-testid="save-name"]');
      expect(fixture.nativeElement.querySelector('.feedback.error')!.textContent).toContain('Something went wrong');
      expect(q<HTMLButtonElement>('[data-testid="save-name"]')!.disabled).toBe(false);
    });

    it('does not carry an old message into the next time the panel opens', () => {
      const { q, click } = setup();
      click('[data-testid="edit-profile"]');
      click('[data-testid="save-name"]');
      expect(q('.feedback')).not.toBeNull();
      click('[data-testid="close-edit"]');
      click('[data-testid="edit-profile"]');
      expect(q('.feedback')).toBeNull();
    });
  });

  describe('who can see the profile', () => {
    const open = (o: Options = {}) => { const s = setup(o); s.click('[data-testid="edit-profile"]'); return s; };

    it('is public by default, even for a user cached before the setting existed', () => {
      const { q } = open({ user: { ...USER, profilePublic: undefined, publicProfileId: undefined } });
      expect(q('[data-testid="profile-public"]')!.getAttribute('aria-pressed')).toBe('true');
      expect(q('[data-testid="profile-private"]')!.getAttribute('aria-pressed')).toBe('false');
    });

    it('says exactly what becomes visible, and what never does', () => {
      const text = open().el.textContent!;
      expect(text).toContain('name, avatar, level, total XP, badges and trophies');
      expect(text).toContain('not your GitHub login, history, streak or activity');
    });

    it('goes private on click and reports it', () => {
      const { click, updateProfilePublic, fixture } = open();
      click('[data-testid="profile-private"]');
      expect(updateProfilePublic).toHaveBeenCalledOnceWith(false);
      expect(fixture.nativeElement.textContent).toContain('Saved.');
    });

    it('sends nothing when the chosen option is already active', () => {
      const { click, updateProfilePublic } = open();
      click('[data-testid="profile-public"]');
      expect(updateProfilePublic).not.toHaveBeenCalled();
    });

    it('shows an error when changing it fails', () => {
      const { click, fixture } = open({ updateProfilePublic: () => throwError(() => new Error('boom')) });
      click('[data-testid="profile-private"]');
      expect(fixture.nativeElement.querySelector('.feedback.error')!.textContent).toContain('Something went wrong');
    });

    it('shows the link, built from the id and never from the GitHub login, and copies it', async () => {
      const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      const { q, fixture } = open();
      const link = q<HTMLInputElement>('[data-testid="profile-link"]')!.value;
      expect(link).toMatch(new RegExp(`/u/${ID}$`));
      expect(link).not.toContain('ana-gh');
      await (fixture.componentInstance as unknown as { copyLink(): Promise<void> }).copyLink();
      expect(write).toHaveBeenCalledOnceWith(link);
    });

    it('offers no link and no visitor view when the profile is private', () => {
      const { q } = open({ user: { ...USER, profilePublic: false } });
      expect(q('[data-testid="profile-link"]')).toBeNull();
      expect(q('[data-testid="copy-link"]')).toBeNull();
      expect(q('[data-testid="view-as-visitor"]')).toBeNull();
    });

    it('offers "View as visitor" on the banner when the profile is public', () => {
      expect(setup().q('[data-testid="view-as-visitor"]')!.getAttribute('href')).toBe(`/u/${ID}`);
    });
  });
  describe('custom link', () => {
    const open = (o: Options = {}) => { const s = setup(o); s.click('[data-testid="edit-profile"]'); return s; };
    const failWith = (status: number, code?: string) => () => throwError(() => new HttpErrorResponse({ status, error: code ? { code } : null }));

    it('is offered in the edit panel, empty until one is chosen', () => {
      const { q } = open();
      expect(q<HTMLInputElement>('#profile-slug')!.value).toBe('');
      expect(q('[data-testid="slug-prefix"]')!.textContent).toBe('/u/');
      expect(q('[data-testid="remove-slug"]')).toBeNull();
    });

    it('is not offered while the profile is private, because the link is not live', () => {
      expect(open({ user: { ...USER, profilePublic: false } }).q('#profile-slug')).toBeNull();
    });

    it('is pre-filled with the slug already chosen, with a way back to the default link', () => {
      const { q } = open({ user: { ...USER, profileSlug: 'lekitoonrails' } });
      expect(q<HTMLInputElement>('#profile-slug')!.value).toBe('lekitoonrails');
      expect(q('[data-testid="remove-slug"]')).not.toBeNull();
    });

    it('saves what was typed, and the link, the copy field and "View as visitor" all follow it', () => {
      const { q, click, type, updateProfileSlug, fixture } = open();
      type('#profile-slug', 'lekitoonrails');
      click('[data-testid="save-slug"]');
      expect(updateProfileSlug).toHaveBeenCalledOnceWith('lekitoonrails');
      expect(q<HTMLInputElement>('[data-testid="profile-link"]')!.value).toMatch(/\/u\/lekitoonrails$/);
      expect(q('[data-testid="view-as-visitor"]')!.getAttribute('href')).toBe('/u/lekitoonrails');
      expect(q('[data-testid="remove-slug"]')).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Saved.');
    });

    it('saves with Enter as well', () => {
      const { q, fixture, updateProfileSlug } = open();
      const input = q<HTMLInputElement>('#profile-slug')!;
      input.value = 'ada';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
      expect(updateProfileSlug).toHaveBeenCalledOnceWith('ada');
    });

    it('goes back to the id link by sending null, and the link follows', () => {
      const { q, click, updateProfileSlug } = open({ user: { ...USER, profileSlug: 'lekitoonrails' } });
      click('[data-testid="remove-slug"]');
      expect(updateProfileSlug).toHaveBeenCalledOnceWith(null);
      expect(q<HTMLInputElement>('[data-testid="profile-link"]')!.value).toMatch(new RegExp(`/u/${ID}$`));
      expect(q<HTMLInputElement>('#profile-slug')!.value).toBe('');
      expect(q('[data-testid="remove-slug"]')).toBeNull();
    });

    it('says the name is taken, and keeps what was typed so it can be fixed', () => {
      const { q, click, type } = open({ updateProfileSlug: failWith(409, 'taken') });
      type('#profile-slug', 'lekitoonrails');
      click('[data-testid="save-slug"]');
      expect(q('[data-testid="slug-error"]')!.textContent).toContain('already taken');
      expect(q<HTMLInputElement>('#profile-slug')!.value).toBe('lekitoonrails');
      expect(q('#profile-slug')!.getAttribute('aria-invalid')).toBe('true');
      expect(q<HTMLButtonElement>('[data-testid="save-slug"]')!.disabled).toBe(false);
    });

    it('says which rule was broken', () => {
      const messages: [string, string][] = [['length', 'between 3 and 30'], ['format', 'lowercase letters, numbers and single hyphens'], ['reserved', 'reserved']];
      for (const [code, text] of messages) {
        TestBed.resetTestingModule();
        const { q, click, type } = open({ updateProfileSlug: failWith(400, code) });
        type('#profile-slug', 'x');
        click('[data-testid="save-slug"]');
        expect(q('[data-testid="slug-error"]')!.textContent).withContext(code).toContain(text);
      }
    });

    it('falls back to the generic message for anything unexpected', () => {
      const { q, click } = open({ updateProfileSlug: failWith(500) });
      click('[data-testid="save-slug"]');
      expect(q('[data-testid="slug-error"]')!.textContent).toContain('Something went wrong');
    });

    it('clears the error as soon as the user types again, and when the panel is reopened', () => {
      const { q, click, type } = open({ updateProfileSlug: failWith(409, 'taken') });
      click('[data-testid="save-slug"]');
      expect(q('[data-testid="slug-error"]')).not.toBeNull();
      type('#profile-slug', 'other');
      expect(q('[data-testid="slug-error"]')).toBeNull();
      click('[data-testid="save-slug"]');
      click('[data-testid="close-edit"]');
      click('[data-testid="edit-profile"]');
      expect(q('[data-testid="slug-error"]')).toBeNull();
    });
  });
});
