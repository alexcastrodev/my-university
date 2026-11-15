import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { User } from '../models/auth.model';
import { AuthService, STORED_USER_KEY } from './auth.service';

const user = (id: number, permissions?: string[]): User => ({
  id,
  displayName: 'u',
  githubLogin: 'u',
  avatarUrl: '',
  preferredLanguage: null,
  ...(permissions ? { permissions } : {}),
});

describe('AuthService permissions', () => {
  beforeEach(() => localStorage.removeItem(STORED_USER_KEY));
  afterEach(() => localStorage.removeItem(STORED_USER_KEY));

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    return { auth: TestBed.inject(AuthService), http: TestBed.inject(HttpTestingController) };
  }

  it('holds what /auth/me says, and nothing for someone signed out', () => {
    const { auth, http } = setup();
    expect(auth.can('admin.access')).toBeFalse();
    auth.bootstrap();
    http.expectOne('/api/auth/me').flush(user(1, ['admin.access']));
    expect(auth.can('admin.access')).toBeTrue();
    expect(auth.can('roles.manage')).toBeFalse();
  });

  it('keeps them when a settings call answers with the bare user', () => {
    const { auth, http } = setup();
    auth.bootstrap();
    http.expectOne('/api/auth/me').flush(user(1, ['admin.access']));
    auth.updateDisplayName('New name').subscribe();
    http.expectOne('/api/auth/settings').flush({ ...user(1), displayName: 'New name' });
    expect(auth.currentUser()?.displayName).toBe('New name');
    expect(auth.can('admin.access')).toBeTrue();
  });

  it('does not hand them to a different account', () => {
    const { auth, http } = setup();
    auth.bootstrap();
    http.expectOne('/api/auth/me').flush(user(1, ['admin.access']));
    auth.devLogin().subscribe();
    http.expectOne('/api/auth/dev-login').flush(user(2));
    expect(auth.can('admin.access')).toBeFalse();
  });
});
