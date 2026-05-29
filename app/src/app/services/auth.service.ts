import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { tap } from 'rxjs';
import { User } from '../models/auth.model';

const STORAGE_KEY = 'ocp-user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  currentUser = signal<User | null>(this.readStoredUser());

  login(displayName: string) {
    return this.http.post<User>('/api/auth/login', { displayName }).pipe(
      tap((user) => this.setUser(user)),
    );
  }

  signup(displayName: string) {
    return this.http.post<User>('/api/auth/signup', { displayName }).pipe(
      tap((user) => this.setUser(user)),
    );
  }

  logout(): void {
    this.currentUser.set(null);
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  }

  headers(): { headers?: HttpHeaders } {
    const user = this.currentUser();
    return user ? { headers: new HttpHeaders({ 'X-User-Id': String(user.id) }) } : {};
  }

  private setUser(user: User): void {
    this.currentUser.set(user);
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
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
