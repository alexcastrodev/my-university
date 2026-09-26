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

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 1, displayName: 'Ana', githubLogin: 'ana-gh', avatarUrl: '', preferredLanguage: null, ...overrides };
}

describe('SettingsPage', () => {
  let setLanguage: jasmine.Spy;
  let logout: jasmine.Spy;

  function setup(user: User | null, updateDisplayName?: (name: string | null) => Observable<User>) {
    setLanguage = jasmine.createSpy('setLanguage');
    logout = jasmine.createSpy('logout');
    const authStub = {
      currentUser: signal(user),
      updateDisplayName: updateDisplayName ?? ((name: string | null) => of(makeUser({ displayName: name || 'Ana' }))),
      logout,
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
    expect(hrefs).toEqual(['/profile', '/review', '/leaderboard']);

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
});
