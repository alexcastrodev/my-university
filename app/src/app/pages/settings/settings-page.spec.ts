import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { User } from '../../models/auth.model';
import { AuthService } from '../../services/auth.service';
import { SettingsPage } from './settings-page';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 1, displayName: 'Ana', githubLogin: 'ana-gh', avatarUrl: '', ...overrides };
}

describe('SettingsPage', () => {
  function setup(user: User | null, updateDisplayName?: (name: string | null) => Observable<User>) {
    const authStub = {
      currentUser: signal(user),
      updateDisplayName: updateDisplayName ?? ((name: string | null) => of(makeUser({ displayName: name || 'Ana' }))),
    };

    TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AuthService, useValue: authStub },
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
});
