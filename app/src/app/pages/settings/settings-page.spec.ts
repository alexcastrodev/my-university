import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { User } from '../../models/auth.model';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { XpService } from '../../services/xp.service';
import { SettingsPage } from './settings-page';

@Component({ template: '' })
class Dummy {}

const PROFILE_ID = '01a144df-4132-7737-aacd-4f9655f10d37';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 1, displayName: 'Ana', githubLogin: 'ana-gh', avatarUrl: '', preferredLanguage: null, ...overrides };
}

describe('SettingsPage', () => {
  let setLanguage: jasmine.Spy;
  let logout: jasmine.Spy;

  function setup(
    user: User | null,
    updateDisplayName?: (name: string | null) => Observable<User>,
    updateProfilePublic?: (value: boolean) => Observable<User>,
  ) {
    setLanguage = jasmine.createSpy('setLanguage');
    logout = jasmine.createSpy('logout');
    const authStub = {
      currentUser: signal(user),
      updateDisplayName: updateDisplayName ?? ((name: string | null) => of(makeUser({ displayName: name || 'Ana' }))),
      logout,
      updateProfilePublic: updateProfilePublic ?? ((value: boolean) => of(makeUser({ profilePublic: value, publicProfileId: PROFILE_ID }))),
    };

    TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: '**', component: Dummy }]),
        { provide: AuthService, useValue: authStub },
        { provide: LanguageService, useValue: { language: 'en', setLanguage } },
        { provide: XpService, useValue: { summary: signal(null), xp: signal(120) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    return fixture;
  }

  it('prompts to log in when there is no session', () => {
    const fixture = setup(null);

    expect(fixture.nativeElement.textContent).toContain('Log in with GitHub');
  });

  it('renders the current effective display name pre-filled', () => {
    const fixture = setup(makeUser({ displayName: 'Custom Name' }));

    const input: HTMLInputElement = fixture.nativeElement.querySelector('.name-input');
    expect(input.value).toBe('Custom Name');
  });

  it('saves successfully and shows a success message', () => {
    const updateDisplayName = (name: string | null) => of(makeUser({ displayName: name ?? 'Ana' }));
    const fixture = setup(makeUser(), updateDisplayName);

    const input: HTMLInputElement = fixture.nativeElement.querySelector('.name-input');
    input.value = 'New Name';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const saveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.primary-btn');
    saveBtn.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.feedback').textContent).toContain('Saved.');
    expect(fixture.nativeElement.querySelector('.feedback').classList.contains('error')).toBe(false);
  });

  it('shows an error message when saving fails', () => {
    const updateDisplayName = () => throwError(() => new Error('boom'));
    const fixture = setup(makeUser(), updateDisplayName);

    const saveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.primary-btn');
    saveBtn.click();
    fixture.detectChanges();

    const feedback: HTMLElement = fixture.nativeElement.querySelector('.feedback');
    expect(feedback.textContent).toContain('Something went wrong');
    expect(feedback.classList.contains('error')).toBe(true);
  });

  it('resets to the GitHub name by submitting a null override', () => {
    let received: string | null | undefined;
    const updateDisplayName = (name: string | null) => {
      received = name;
      return of(makeUser({ displayName: 'ana-gh' }));
    };
    const fixture = setup(makeUser({ displayName: 'Custom Name' }), updateDisplayName);

    const resetBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.secondary-btn');
    resetBtn.click();
    fixture.detectChanges();

    expect(received).toBeNull();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.name-input');
    expect(input.value).toBe('ana-gh');
  });

  it('shows the account with its links and logs out', () => {
    const fixture = setup(makeUser({ displayName: 'Ana Souza' }));

    const account: HTMLElement = fixture.nativeElement.querySelector('.account');
    expect(account.textContent).toContain('Ana Souza');
    expect(account.textContent).toContain('@ana-gh');
    expect(account.textContent).toContain('120 XP');
    const hrefs = Array.from(account.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/profile', '/leaderboard']);

    (account.querySelector('.logout') as HTMLButtonElement).click();
    expect(logout).toHaveBeenCalled();
  });

  it('switches language, also without a session', () => {
    const fixture = setup(null);

    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.language-toggle button'),
    );
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['English', 'Português (Brasil)']);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');

    buttons[1].click();
    expect(setLanguage).toHaveBeenCalledWith('pt-BR');
  });

  describe('public profile', () => {
    const publicUser = () => makeUser({ profilePublic: true, publicProfileId: PROFILE_ID });
    const button = (fixture: ReturnType<typeof setup>, id: 'profile-public' | 'profile-private') =>
      fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

    it('is public by default, even for a user cached before the setting existed', () => {
      const fixture = setup(makeUser());

      expect(button(fixture, 'profile-public').getAttribute('aria-pressed')).toBe('true');
      expect(button(fixture, 'profile-private').getAttribute('aria-pressed')).toBe('false');
    });

    it('says exactly what becomes visible, and what never does', () => {
      const fixture = setup(publicUser());
      const text = fixture.nativeElement.textContent as string;

      expect(text).toContain('name, avatar, level, total XP, badges and trophies');
      expect(text).toContain('leaderboard');
      expect(text).toContain('not your GitHub login, history, streak or activity');
    });

    it('shows the link, built from the id and never from the GitHub login', () => {
      const fixture = setup(publicUser());
      const input = fixture.nativeElement.querySelector('[data-testid="profile-link"]') as HTMLInputElement;

      expect(input.value).toMatch(new RegExp(`/u/${PROFILE_ID}$`));
      expect(input.value).not.toContain('ana-gh');
    });

    it('shows the link with the slug the user chose, once there is one', () => {
      const fixture = setup(makeUser({ profilePublic: true, publicProfileId: PROFILE_ID, profileSlug: 'lekitoonrails' }));
      const input = fixture.nativeElement.querySelector('[data-testid="profile-link"]') as HTMLInputElement;

      expect(input.value).toMatch(/\/u\/lekitoonrails$/);
    });

    it('goes private on click and reports it', () => {
      const calls: boolean[] = [];
      const fixture = setup(publicUser(), undefined, (value) => {
        calls.push(value);
        return of(makeUser({ profilePublic: value, publicProfileId: PROFILE_ID }));
      });

      button(fixture, 'profile-private').click();
      fixture.detectChanges();

      expect(calls).toEqual([false]);
      expect(fixture.nativeElement.textContent).toContain('Saved.');
    });

    it('does not send anything when the chosen option is already active', () => {
      const calls: boolean[] = [];
      const fixture = setup(publicUser(), undefined, (value) => {
        calls.push(value);
        return of(publicUser());
      });

      button(fixture, 'profile-public').click();

      expect(calls).toEqual([]);
    });

    it('hides the link for a private profile', () => {
      const fixture = setup(makeUser({ profilePublic: false, publicProfileId: PROFILE_ID }));

      expect(fixture.nativeElement.querySelector('[data-testid="profile-link"]')).toBeNull();
      expect(button(fixture, 'profile-private').getAttribute('aria-pressed')).toBe('true');
    });

    it('shows an error and keeps the controls usable when saving fails', () => {
      const fixture = setup(publicUser(), undefined, () => throwError(() => new Error('boom')));

      button(fixture, 'profile-private').click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.feedback.error')?.textContent).toContain('Something went wrong');
      expect(button(fixture, 'profile-private').disabled).toBe(false);
    });

    it('copies the link to the clipboard', async () => {
      const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      const fixture = setup(publicUser());

      await fixture.componentInstance.copyProfileLink();

      expect(write).toHaveBeenCalledOnceWith(jasmine.stringMatching(new RegExp(`/u/${PROFILE_ID}$`)));
    });
  });
});
