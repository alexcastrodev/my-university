import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { User } from '../models/auth.model';
import { Language } from '../models/language.model';

const STORAGE_KEY = 'ocp-user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  currentUser = signal<User | null>(this.readStoredUser());

  /** Client-only: resolves the current session against the server and syncs the cached user. */
  bootstrap(): void {
    if (typeof localStorage === 'undefined') return;

    this.http.get<User>('/api/auth/me').subscribe({
      next: (user) => this.setUser(user),
      error: () => this.clearUser(),
    });
  }

  /** Non-production only: reports whether the GitHub-less dev-login shortcut is available. */
  isDevModeEnabled(): Observable<boolean> {
    return this.http.get<{ enabled: boolean }>('/api/auth/dev-mode').pipe(map((res) => res.enabled));
  }

  /** Dev-only: logs in as a stable local account without going through GitHub. */
  devLogin(): Observable<User> {
    return this.http.post<User>('/api/auth/dev-login', {}).pipe(tap((user) => this.setUser(user)));
  }

  logout(): void {
    this.http.post('/api/auth/logout', {}).subscribe({ error: () => {} });
    this.clearUser();
  }

  /** Sets (or, given `null`/empty, clears) the display name override and syncs the cached user on success. */
  updateDisplayName(displayName: string | null): Observable<User> {
    return this.http
      .put<User>('/api/auth/settings', { displayName })
      .pipe(tap((user) => this.setUser(user)));
  }

  /** Sets the caller's saved content-language preference and syncs the cached user on success. */
  updateLanguage(language: Language): Observable<User> {
    return this.http
      .put<User>('/api/auth/settings', { language })
      .pipe(tap((user) => this.setUser(user)));
  }

  private setUser(user: User): void {
    this.currentUser.set(user);
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }

  private clearUser(): void {
    this.currentUser.set(null);
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  }

  private readStoredUser(): User | null {
    if (typeof localStorage === 'undefined') return null;

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as User;
      return parsed?.id && parsed?.displayName ? parsed : null;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }
}
